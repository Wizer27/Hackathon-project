// Вход в игру: Google, код на почту или гостевой режим. Работает с API бэкенда (api/main.py).
// Вошедший игрок хранит прогресс на сервере (/game/save, /game/load), гость — в браузере.
window.SkazkaAuth = (() => {
  // Через Caddy API доступен на том же домене по /api. При локальной разработке (http.server на :8000)
  // бэкенд запущен отдельно на :47813. Можно переопределить: localStorage['skazka-api'] = 'https://...'.
  const API = (() => {
    try { if (localStorage.getItem('skazka-api')) return localStorage.getItem('skazka-api'); } catch {}
    // локально (localhost / 127.0.0.1 с портом) API запущен отдельно на :47813, на сервере — /api через Caddy
    const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.port && location.port !== '47813';
    return local ? `${location.protocol}//${location.hostname}:47813` : '/api';
  })();
  const KEY = 'skazka-session';
  const GUEST = 'skazka-guest';
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let session = store.get(KEY); // { access_token, refresh_token, user_id }
  let refreshing = null;

  async function call(path, { method = 'GET', body, auth = false } = {}) {
    const send = () => fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth && session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let r = await send();
    // access-токен живёт недолго: при 401 обновляем пару токенов и повторяем запрос
    if (r.status === 401 && auth && session) {
      if (await refresh()) r = await send();
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.detail || `Ошибка ${r.status}`), { status: r.status });
    return data;
  }
  function refresh() {
    refreshing ??= fetch(`${API}/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }),
    }).then(async (r) => {
      if (!r.ok) { logout(); return false; }
      session = await r.json();
      store.set(KEY, session);
      return true;
    }).catch(() => false).finally(() => { refreshing = null; });
    return refreshing;
  }
  function signedIn(data) {
    session = data;
    store.set(KEY, session);
    store.set(GUEST, null);
  }
  function logout() {
    session = null;
    store.set(KEY, null);
  }

  // ---------- экран входа ----------
  function screen(serverOk, googleId) {
    const box = document.createElement('div');
    box.className = 'auth';
    box.innerHTML = `
      <div class="auth-card glass">
        <div class="auth-logo">${window.Icons ? Icons.svg('ferris-wheel') : ''}</div>
        <b class="auth-title">Парк «Сказка»</b>
        <p class="auth-sub">Войдите, чтобы прогресс сохранялся<br>и был доступен на любом устройстве</p>
        ${serverOk && googleId && location.hostname === '127.0.0.1' ? '<p class="auth-note">Google не пускает с 127.0.0.1 — откройте сайт по адресу localhost.</p>' : ''}
        ${serverOk ? `
          ${googleId ? '<div id="g-btn" class="g-btn"></div><div class="auth-or">или по почте</div>' : ''}
          <form id="auth-email" class="auth-form">
            <input id="auth-mail" type="email" placeholder="email@example.ru" autocomplete="email" required>
            <button class="btn primary">Получить код</button>
          </form>
          <form id="auth-code" class="auth-form" hidden>
            <input id="auth-num" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="Код из письма" autocomplete="one-time-code" required>
            <button class="btn primary">Войти</button>
          </form>` : `<p class="auth-note">Сервер входа недоступен (${esc(API)}) — можно играть как гость.</p>`}
        <p id="auth-msg" class="auth-msg"></p>
        <div class="auth-or">или</div>
        <button id="auth-guest" class="auth-guest">Играть как гость</button>
        <small class="auth-hint">Прогресс гостя хранится в этом браузере<br>и перенесётся в аккаунт при входе</small>
      </div>`;
    document.body.append(box);
    const $ = (id) => box.querySelector('#' + id);
    const msg = (t, bad = true) => { $('auth-msg').textContent = t; $('auth-msg').classList.toggle('bad', bad); };
    const busy = (form, on) => form.querySelectorAll('button, input').forEach((el) => { el.disabled = on; });

    return new Promise((resolve) => {
      const done = (mode) => { box.classList.add('out'); setTimeout(() => box.remove(), 400); resolve(mode); };
      $('auth-guest').onclick = () => { store.set(GUEST, true); done('guest'); };
      if (!serverOk) return;
      let email = '';
      $('auth-email').onsubmit = async (e) => {
        e.preventDefault();
        email = $('auth-mail').value.trim();
        busy(e.target, true); msg('');
        try {
          await call('/send/code', { method: 'POST', body: { email } });
          $('auth-email').hidden = true; $('auth-code').hidden = false; $('auth-num').focus();
          msg(`Код отправлен на ${email}`, false);
        } catch (err) {
          msg(err.message === 'Code already sent' ? 'Код уже отправлен — проверьте почту или подождите 2 минуты' : 'Не удалось отправить код');
        } finally { busy(e.target, false); }
      };
      $('auth-code').onsubmit = async (e) => {
        e.preventDefault();
        busy(e.target, true); msg('');
        try {
          signedIn(await call('/check/code', { method: 'POST', body: { email, code: Number($('auth-num').value) } }));
          done('user');
        } catch {
          msg('Неверный или просроченный код');
          busy(e.target, false);
        }
      };
      if (googleId) {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.onload = () => {
          google.accounts.id.initialize({
            client_id: googleId,
            callback: async ({ credential }) => {
              msg('Входим…', false);
              try { signedIn(await call('/auth/google', { method: 'POST', body: { id_token: credential } })); done('user'); } catch { msg('Не удалось войти через Google'); }
            },
          });
          // кнопка Google — во всю ширину карточки, как остальные кнопки
          const w = Math.round(Math.min(400, Math.max(200, $('g-btn').clientWidth)));
          google.accounts.id.renderButton($('g-btn'), { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', locale: 'ru', width: w });
        };
        s.onerror = () => { $('g-btn').remove(); box.querySelector('.auth-or')?.remove(); };
        document.head.append(s);
      }
    });
  }

  // Запуск: вошедший игрок попадает в игру сразу, гость — если уже выбирал гостевой режим, иначе экран входа
  async function start({ ask = false } = {}) {
    let cfg = null;
    try { cfg = await call('/config'); } catch {}
    if (session && cfg) {
      try {
        session.user = await call('/me', { auth: true });
        return api();
      } catch { logout(); }
    }
    if (!ask && store.get(GUEST)) return api();
    const mode = await screen(!!cfg, cfg?.google_client_id);
    if (mode === 'user') { try { session.user = await call('/me', { auth: true }); } catch {} }
    return api();
  }

  function api() {
    return {
      user: session?.user ?? null,
      async load() {
        if (!session) return null;
        const r = await call('/game/load', { auth: true });
        return r.state && Object.keys(r.state).length ? r.state : null;
      },
      async save(state) {
        if (!session) return;
        await call('/game/save', { method: 'POST', body: { state }, auth: true });
      },
      logout() { logout(); store.set(GUEST, null); },
      esc,
    };
  }

  return { start };
})();
