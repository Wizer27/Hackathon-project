(async () => {
  const C = await fetch('catalog.json').then((r) => r.json());
  window.SkazkaCatalog = C;
  const B = Object.fromEntries(C.buildings.map((b) => [b.id, b]));
  const H = Object.fromEntries(C.heroes.map((h) => [h.id, h]));
  const $ = (id) => document.getElementById(id);

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  let game = store.get('skazka-game') || newGame();
  function newGame() {
    return {
      state: { day: 1, ...structuredClone(C.start), heroes: [], promos: [] },
      history: [], log: [], turn: null, over: false,
    };
  }
  const save = () => store.set('skazka-game', game);

  // ---------- Отрисовка ----------
  const fxHTML = (o) => [
    [o.coins, '🪙'], [o.guests, '👥'], [o.mood, '😊'],
  ].filter(([v]) => v).map(([v, i]) => `<span class="${v < 0 ? 'neg' : ''}">${v > 0 ? '+' : ''}${v} ${i}</span>`).join('');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const avatar = (h) => `<div class="avatar"><img src="assets/heroes/${h.id}.png" alt="" onerror="this.replaceWith(document.createTextNode('${h.icon}'))"></div>`;

  let prev = {};
  function renderHUD() {
    const s = game.state;
    $('day').textContent = `${Math.min(s.day, C.days)} / ${C.days}`;
    for (const k of ['coins', 'guests', 'mood']) {
      const el = $(k);
      el.textContent = s[k];
      el.classList.toggle('up', prev[k] !== undefined && s[k] > prev[k]);
      el.classList.toggle('down', prev[k] !== undefined && s[k] < prev[k]);
      prev[k] = s[k];
    }
    $('mood-bar').style.width = `${s.mood}%`;
    $('park').innerHTML = s.buildings.map((id) => B[id])
      .map((b) => `<a href="map/?id=${b.mapId}" title="Найти в настоящем парке">${b.icon} ${b.name}</a>`).join('')
      + s.heroes.map((id) => `<a href="index.html#heroes">${H[id].icon} ${H[id].name}</a>`).join('');
    $('log').innerHTML = game.log.map((l) => `<div class="log-item">${l}</div>`).join('');
  }

  function renderTurn() {
    const t = game.turn;
    if (!t) return;
    const host = H[t.speaker] || H.feya;
    const s = game.state;
    const final = game.over;
    $('turn').innerHTML = `
      <div class="host">
        ${avatar(H.feya)}
        <div>
          <div class="host-name">Фея Сказки <small>· ведущая${host.id !== 'feya' ? ` · сегодня в центре событий ${host.icon} ${host.name}` : ''}</small></div>
          <div class="say">
            ${t.consequence ? `<p class="conseq">${esc(t.consequence)}</p>` : ''}
            <h3>${esc(t.event_title)}</h3>
            <p>${esc(t.situation)}</p>
          </div>
        </div>
      </div>
      ${final ? resultHTML() : `<div class="options">${t.options.map((o, i) => {
        const b = B[o.build];
        const poor = s.coins + o.coins < 0;
        return `<button class="opt ${b ? 'build' : ''}" data-i="${i}" ${poor ? 'disabled title="Не хватает монет"' : ''}>
          ${b ? `<img src="${b.photo}" alt="">` : ''}
          <span class="t">${b ? '<span class="tag">Постройка</span>' : ''}${esc(o.title)}</span>
          <span class="d">${esc(o.description)}</span>
          <span class="fx">${fxHTML(o)}</span>
        </button>`;
      }).join('')}</div>`}`;
  }

  function resultHTML() {
    const s = game.state;
    const win = s.guests >= C.goal.guests && s.mood >= C.goal.mood;
    return `<div class="card result">
      <div class="big">${win ? '🏆' : '🌱'}</div>
      <h2>${win ? 'Лучший парк Москвы!' : 'Парк растёт!'}</h2>
      <p>${s.guests} гостей · настроение ${s.mood} · ${s.coins} монет · ${s.buildings.length} построек</p>
      <p>${win ? 'Вы выполнили цель. Фея Сказки гордится вами!' : `До цели: ${Math.max(0, C.goal.guests - s.guests)} гостей и ${Math.max(0, C.goal.mood - s.mood)} настроения. Попробуйте другую стратегию!`}</p>
      <div class="cta">
        <button class="btn primary" id="again">↻ Сыграть ещё</button>
        <a class="btn" href="map/">🗺️ Найти героев в настоящем парке</a>
      </div></div>`;
  }

  function thinking() {
    $('turn').insertAdjacentHTML('beforeend',
      `<div class="thinking"><span class="dots"><i></i><i></i><i></i></span>Фея Сказки думает…</div>`);
    $('turn').querySelectorAll('.opt').forEach((b) => (b.disabled = true));
  }

  // ---------- Ходы ----------
  // Пределы, в которых ведущий может менять ресурсы за один ход
  const LIMITS = { coins: [-600, 500], guests: [-60, 120], mood: [-20, 20] };
  const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

  // Ведущий (сценарий или ИИ) предлагает эффекты, а игра приводит их к правилам
  function sanitizeTurn(t, final) {
    const owned = new Set(game.state.buildings);
    const options = (final ? [] : t.options || []).slice(0, 3).flatMap((o) => {
      const b = B[o.build];
      if (b) return owned.has(b.id) ? [] : [{ ...o, coins: -b.cost, guests: b.guests, mood: b.mood }];
      return [{ ...o, build: 'none', coins: clamp(o.coins, LIMITS.coins), guests: clamp(o.guests, LIMITS.guests), mood: clamp(o.mood, LIMITS.mood) }];
    });
    return { ...t, speaker: H[t.speaker] ? t.speaker : 'feya', options };
  }

  async function requestTurn(choice) {
    thinking();
    try {
      const s = game.state;
      const data = await window.SkazkaHost.nextTurn({
        day: s.day, days_total: C.days, final: game.over,
        state: { coins: s.coins, guests: s.guests, mood: s.mood, buildings: [...s.buildings], heroes: [...s.heroes] },
        last_choice: choice, history: game.history.slice(-6),
      });
      game.turn = sanitizeTurn(data, game.over);
      game.pending = null;
      save();
      renderTurn();
    } catch (e) {
      $('turn').querySelector('.thinking')?.remove();
      $('turn').insertAdjacentHTML('beforeend',
        `<div class="error">⚠️ ${esc(e.message)} <button class="btn small" id="retry">Повторить</button></div>`);
      $('retry').onclick = () => { $('turn').querySelector('.error').remove(); requestTurn(choice); };
    }
  }

  function choose(o) {
    const s = game.state;
    s.coins += o.coins;
    s.guests = Math.max(0, s.guests + o.guests);
    s.mood = Math.max(0, Math.min(100, s.mood + o.mood));
    if (B[o.build] && !s.buildings.includes(o.build)) s.buildings.push(o.build);
    // вечерняя выручка: гости × 2 монеты, с поправкой на настроение
    const income = Math.round(s.guests * 2 * (0.5 + s.mood / 100));
    s.coins += income;
    game.log.push(`<b>День ${s.day}:</b> ${esc(game.turn.event_title)} → ${esc(o.title)} · вечерняя выручка +${income} 🪙`);
    game.history.push({ day: s.day, event: game.turn.event_title, choice: o.title });
    s.day += 1;
    game.over = s.day > C.days;
    // ход уже применён: если страница перезагрузится до ответа ведущего, запрос повторится
    game.pending = { title: o.title, description: o.description, coins: o.coins, guests: o.guests, mood: o.mood, build: o.build };
    game.turn = null;
    save();
    renderHUD();
    requestTurn(game.pending);
  }

  $('turn').addEventListener('click', (e) => {
    const b = e.target.closest('.opt');
    if (b && !b.disabled) choose(game.turn.options[+b.dataset.i]);
    if (e.target.id === 'again') restart();
  });

  function restart() {
    game = newGame();
    prev = {};
    save();
    $('turn').innerHTML = '';
    renderHUD();
    requestTurn(null);
  }
  $('restart').addEventListener('click', () => { if (confirm('Начать игру заново?')) restart(); });

  // ---------- Коды из «Сказочного паспорта» ----------
  $('promo').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('promo-in').value.trim().toUpperCase();
    const p = C.promo.find((x) => x.code === code);
    const s = game.state;
    const msg = $('promo-msg');
    if (!p) { msg.textContent = 'Такого кода нет. Коды выдаёт «Сказочный паспорт» в карте парка.'; return; }
    if (s.promos.includes(code)) { msg.textContent = 'Этот код уже использован.'; return; }
    s.promos.push(code);
    if (p.coins) s.coins += p.coins;
    if (p.guests) s.guests += p.guests;
    if (p.mood) s.mood = Math.min(100, s.mood + p.mood);
    if (p.hero && !s.heroes.includes(p.hero)) s.heroes.push(p.hero);
    if (p.build && !s.buildings.includes(p.build)) {
      s.buildings.push(p.build);
      s.guests += B[p.build].guests;
      s.mood = Math.min(100, s.mood + B[p.build].mood);
    }
    game.log.push(`<b>🎟️ Бонус за визит в «Сказку»:</b> ${p.title}`);
    msg.textContent = `Готово: ${p.title}!`;
    $('promo-in').value = '';
    save();
    renderHUD();
    renderTurn();
  });

  renderHUD();
  if (game.turn) renderTurn();
  else requestTurn(game.pending || null);
})();
