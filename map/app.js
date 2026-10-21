(() => {
  const { width: W, height: H, items } = window.PARK;

  const CATS = {
    extreme:   { label: 'Экстрим',      icon: 'zap', color: '#e8461e', stamp: true },
    family:    { label: 'Семейные',     icon: 'ferris-wheel', color: '#f08c00', stamp: true },
    kids:      { label: 'Детские',      icon: 'baby', color: '#e64980', stamp: true },
    animals:   { label: 'Животные',     icon: 'paw-print', color: '#2f9e44', stamp: true },
    locations: { label: 'Локации',      icon: 'castle', color: '#7048e8', stamp: true },
    events:    { label: 'Праздники',    icon: 'party-popper', color: '#1c7ed6', stamp: false },
    food:      { label: 'Еда',          icon: 'utensils', color: '#d9480f', stamp: false },
    shop:      { label: 'Сувениры',     icon: 'shopping-bag', color: '#ae3ec9', stamp: false },
    arcade:    { label: 'Аркады и тир', icon: 'gamepad-2', color: '#c2255c', stamp: false },
    photo:     { label: 'Фото и аквагрим', icon: 'camera', color: '#0c8599', stamp: false },
    service:   { label: 'Сервис',       icon: 'info', color: '#495057', stamp: false },
    transport: { label: 'Как добраться', icon: 'bus', color: '#343a40', stamp: false },
  };
  // Иконки конкретных сервисных объектов понятнее общей иконки категории
  const I = window.Icons;
  const iconName = (it) =>
    /Туалет/.test(it.name) ? 'bath' :
    /матери/.test(it.name) ? 'baby' :
    /Касса/.test(it.name) ? 'ticket' :
    /курения/.test(it.name) ? 'info' :
    /Парковка/.test(it.name) ? 'square-parking' :
    CATS[it.cats[0]].icon;
  const iconFor = (it) => I.svg(iconName(it));
  const catOf = (it) => CATS[it.cats[0]];
  const canStamp = (it) => it.cats.some((c) => CATS[c].stamp);
  const STAMP_TOTAL = items.filter(canStamp).length;

  const REWARDS = [
    { need: 1,  icon: 'coins', title: '500 сказочных монет', text: 'Монеты в тайкуне «Парк Сказка»' },
    { need: 3,  icon: 'paw-print', title: 'Опытный зоотехник', text: '+10 к настроению гостей в игровом парке' },
    { need: 5,  icon: 'castle', title: 'Постройка «Дино Парк»', text: 'Открывается в игре без ожидания и затрат' },
    { need: 10, icon: 'ticket', title: 'Золотой билет', text: 'Толпа гостей в вашем игровом парке' },
  ];

  // ---------- Хранилище ----------
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const visited = new Set(store.get('visited', []));
  const planned = new Set(store.get('planned', []));
  const save = () => { store.set('visited', [...visited]); store.set('planned', [...planned]); };

  // ---------- Карта ----------
  const toLL = (x, y) => L.latLng(H - y, x);
  const map = L.map('map', {
    crs: L.CRS.Simple, minZoom: -2.5, maxZoom: 1, zoomSnap: 0.25, zoomDelta: 0.5,
    zoomControl: false, attributionControl: false, maxBoundsViscosity: 0.8,
  });
  const bounds = L.latLngBounds(toLL(0, H), toLL(W, 0));
  L.imageOverlay('assets/map.webp', bounds).addTo(map);
  map.setMaxBounds(bounds.pad(0.1));
  const PARK_VIEW = L.latLngBounds(toLL(850, 2050), toLL(2950, 250));
  const fitPark = () => map.fitBounds(PARK_VIEW, { paddingTopLeft: [0, 110], paddingBottomRight: [0, 10] });
  fitPark();

  const markers = new Map();
  for (const it of items) {
    const icon = L.divIcon({
      className: 'pin',
      iconSize: [0, 0],
      html: `<div class="pin-dot" style="--c:${catOf(it).color}">${iconFor(it)}</div><div class="pin-lbl">${esc(it.name)}</div>`,
    });
    const m = L.marker(toLL(it.x, it.y), { icon, riseOnHover: true }).addTo(map);
    m.on('click', () => select(it));
    markers.set(it.id, m);
  }

  const mapEl = document.getElementById('map');
  const onZoom = () => {
    const z = map.getZoom();
    mapEl.classList.toggle('z-low', z < -1);
    mapEl.classList.toggle('z-high', z >= -0.25);
  };
  map.on('zoomend', onZoom);
  onZoom();
  map.on('click', () => closeSheet());

  // ---------- Фильтры и поиск ----------
  let activeCat = null;
  let query = '';
  const chips = document.getElementById('chips');
  chips.innerHTML = [`<button class="chip on" data-cat="">Все</button>`]
    .concat(Object.entries(CATS).map(([id, c]) => `<button class="chip" data-cat="${id}">${I.svg(c.icon)} ${c.label}</button>`))
    .join('');
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    activeCat = b.dataset.cat || null;
    chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
    applyFilter();
  });

  const qInput = document.getElementById('q');
  const qClear = document.getElementById('q-clear');
  qInput.addEventListener('input', () => { query = qInput.value.trim().toLowerCase(); applyFilter(); });
  qInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const first = visibleItems()[0];
    if (first) { qInput.blur(); showTab('map'); select(first, true); }
  });
  qClear.addEventListener('click', () => { qInput.value = ''; query = ''; applyFilter(); });

  const matches = (it) =>
    (!activeCat || it.cats.includes(activeCat)) &&
    (!query || it.name.toLowerCase().includes(query) || it.cats.some((c) => CATS[c].label.toLowerCase().includes(query)));
  const visibleItems = () => items.filter(matches);

  function applyFilter() {
    qClear.hidden = !query;
    const vis = visibleItems();
    const ids = new Set(vis.map((i) => i.id));
    for (const [id, m] of markers) m.getElement()?.classList.toggle('dim', !ids.has(id));
    renderList(vis);
    if ((activeCat || query) && vis.length && currentTab === 'map') {
      map.flyToBounds(L.latLngBounds(vis.map((i) => toLL(i.x, i.y))).pad(0.3), { maxZoom: 0, duration: 0.5 });
    }
  }

  // ---------- Карточка объекта ----------
  const sheet = document.getElementById('sheet');
  const sheetBody = document.getElementById('sheet-body');
  let selected = null;

  function select(it, fly) {
    if (selected) markers.get(selected.id).getElement()?.classList.remove('sel');
    selected = it;
    const m = markers.get(it.id);
    m.getElement()?.classList.add('sel');
    m.setZIndexOffset(1000);
    renderSheet();
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    sheet.scrollTop = 0;
    // ставим объект в середину видимой полосы между шапкой и карточкой
    const z = fly ? Math.max(map.getZoom(), -0.25) : map.getZoom();
    const top = document.querySelector('.top').offsetHeight;
    const shift = (mapEl.clientHeight - top - sheet.offsetHeight) / 2 + top - mapEl.clientHeight / 2;
    const center = map.unproject(map.project(toLL(it.x, it.y), z).subtract([0, shift]), z);
    if (fly) map.flyTo(center, z, { duration: 0.6 });
    else map.panTo(center, { duration: 0.4 });
  }

  function closeSheet() {
    if (selected) {
      const m = markers.get(selected.id);
      m.getElement()?.classList.remove('sel');
      m.setZIndexOffset(0);
    }
    selected = null;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
  }
  document.getElementById('sheet-close').addEventListener('click', closeSheet);

  function nearest(from, pred, n = 1) {
    return items
      .filter((i) => i.id !== from.id && pred(i))
      .map((i) => [i, Math.hypot(i.x - from.x, i.y - from.y)])
      .sort((a, b) => a[1] - b[1])
      .slice(0, n)
      .map(([i]) => i);
  }
  const isWC = (i) => /Туалет|матери/.test(i.name);
  const isFood = (i) => i.cats.includes('food');
  const isRide = (i) => canStamp(i);

  function renderSheet() {
    const it = selected;
    if (!it) return;
    const done = visited.has(it.id);
    const inPlan = planned.has(it.id);
    const near = [
      ...nearest(it, isRide, 2),
      ...nearest(it, isFood, 1),
      ...nearest(it, isWC, 1),
    ].filter((v, i, a) => a.indexOf(v) === i);
    sheetBody.innerHTML = `
      ${it.photo ? `<img class="photo" src="${it.photo}" alt="${esc(it.name)}" loading="lazy">` : ''}
      <div class="sheet-in">
        <h2>${iconFor(it)} ${esc(it.name)}</h2>
        <div class="tags">${it.cats.map((c) => `<span class="tag">${CATS[c].label}</span>`).join('')}</div>
        ${it.note ? `<p class="note">${I.svg('map-pin')} ${esc(it.note)}</p>` : ''}
        ${canStamp(it) ? `<div class="hint">${I.svg('ticket')} Отметьтесь здесь в «Сказочном паспорте» и получите бонус в онлайн-игре «Парк Сказка».</div>` : ''}
        <div class="actions">
          ${canStamp(it)
            ? `<button class="btn ${done ? 'ok' : 'primary'} wide" data-act="stamp">${done ? `${I.svg('check')} Вы здесь уже были` : `${I.svg('map-pin')} Я здесь — отметиться`}</button>`
            : ''}
          <button class="btn" data-act="plan">${I.svg('star', inPlan ? 'on' : '')} ${inPlan ? 'В плане' : 'В план дня'}</button>
          <button class="btn" data-act="share">${I.svg('arrow-right')} Поделиться</button>
        </div>
        <div class="near">
          <h4>Рядом</h4>
          ${near.map(rowHTML).join('')}
        </div>
      </div>`;
  }

  sheetBody.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const row = e.target.closest('[data-id]');
    if (row) return select(byId(+row.dataset.id), true);
    if (!act || !selected) return;
    if (act === 'stamp') toggleStamp(selected);
    if (act === 'plan') {
      planned.has(selected.id) ? planned.delete(selected.id) : planned.add(selected.id);
      save();
      toast(planned.has(selected.id) ? 'Добавлено в план дня' : 'Убрано из плана');
    }
    if (act === 'share') share(selected);
    renderSheet();
    renderPassport();
  });

  function toggleStamp(it) {
    if (visited.has(it.id)) return;
    const before = visited.size;
    visited.add(it.id);
    save();
    markers.get(it.id).getElement()?.classList.add('done');
    const reward = REWARDS.find((r) => r.need > before && r.need <= visited.size);
    toast(reward ? `Новая награда: ${reward.title}!` : `Отметка получена: ${it.name}`);
  }

  async function share(it) {
    const url = `${location.origin}${location.pathname}?id=${it.id}`;
    const data = { title: it.name, text: `${it.name} — парк «Сказка»`, url };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); }
    } catch {}
  }

  // ---------- Ближайшие ----------
  document.querySelectorAll('[data-nearest]').forEach((b) =>
    b.addEventListener('click', () => {
      const c = map.getCenter();
      const from = selected || { id: 0, x: c.lng, y: H - c.lat };
      const [it] = nearest(from, b.dataset.nearest === 'food' ? isFood : isWC);
      if (it) select(it, true);
    }),
  );
  document.getElementById('fit').addEventListener('click', () => { closeSheet(); fitPark(); });

  // ---------- Список ----------
  const listEl = document.getElementById('list');
  function rowHTML(it) {
    const st = visited.has(it.id) ? I.svg('check', 'ok') : planned.has(it.id) ? I.svg('star', 'on') : '';
    return `<button class="row" data-id="${it.id}">
      ${it.photo ? `<img src="${it.photo}" alt="" loading="lazy">` : `<span class="ph">${iconFor(it)}</span>`}
      <span class="t"><b>${esc(it.name)}</b><small>${catOf(it).label}${it.note ? ' · ' + esc(it.note) : ''}</small></span>
      <span class="st">${st}</span></button>`;
  }
  function renderList(vis = visibleItems()) {
    if (!vis.length) { listEl.innerHTML = `<div class="empty">Ничего не найдено</div>`; return; }
    listEl.innerHTML = Object.entries(CATS)
      .map(([id, c]) => {
        const g = vis.filter((i) => i.cats[0] === id);
        return g.length ? `<div class="group-h">${I.svg(c.icon)} ${c.label} · ${g.length}</div>${g.map(rowHTML).join('')}` : '';
      })
      .join('');
  }
  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (row) { showTab('map'); select(byId(+row.dataset.id), true); }
  });

  // ---------- Паспорт ----------
  const promo = (r) => 'SKAZKA-' + (r.need * 7919 + 1234).toString(36).toUpperCase();
  function renderPassport() {
    const n = visited.size;
    document.getElementById('pass-bar').style.width = `${Math.min(100, (n / 10) * 100)}%`;
    document.getElementById('pass-count').textContent = `Отметок: ${n} из ${STAMP_TOTAL}`;
    const badge = document.getElementById('badge');
    badge.hidden = !n;
    badge.textContent = n;
    document.getElementById('rewards').innerHTML = REWARDS.map((r) => {
      const got = n >= r.need;
      return `<div class="reward ${got ? 'got' : ''}"><span class="ic">${I.svg(got ? r.icon : 'lock')}</span>
        <span class="t"><b>${r.title}</b><small>${r.text}</small>
        ${got ? `<small>Код для игры: <span class="code">${promo(r)}</span> · <a href="../play.html">ввести в игре</a></small>` : `<small>Нужно отметок: ${r.need}</small>`}</span></div>`;
    }).join('');
    const stamps = [...visited].map(byId).filter(Boolean);
    document.getElementById('stamps').innerHTML = stamps.length
      ? stamps.map((it) => `<button class="stamp" data-id="${it.id}"><div class="s" style="--c:${catOf(it).color}">${iconFor(it)}</div>${esc(it.name)}</button>`).join('')
      : `<div class="empty">Пока нет отметок. Откройте аттракцион на карте и нажмите «Я здесь».</div>`;
    const plan = [...planned].map(byId).filter(Boolean);
    document.getElementById('plan').innerHTML = plan.length
      ? plan.map(rowHTML).join('')
      : `<div class="empty">Добавляйте аттракционы кнопкой «В план дня».</div>`;
  }
  document.getElementById('view-passport').addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (row) { showTab('map'); select(byId(+row.dataset.id), true); }
  });

  // ---------- Вкладки ----------
  let currentTab = 'map';
  function showTab(name) {
    currentTab = name;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    document.body.classList.toggle('passport-open', name === 'passport');
    if (name !== 'map') closeSheet();
    if (name === 'map') map.invalidateSize();
    if (name === 'passport') renderPassport();
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.view)));

  // ---------- Утилиты ----------
  function byId(id) { return items.find((i) => i.id === id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  let toastTimer;
  function toast(text) {
    const t = document.getElementById('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- Старт ----------
  for (const id of visited) markers.get(id)?.getElement()?.classList.add('done');
  renderList();
  renderPassport();

  // ?id=N — открыть объект; ?checkin=N — отметка по QR-коду у аттракциона
  const params = new URLSearchParams(location.search);
  const checkin = byId(+params.get('checkin'));
  const open = checkin || byId(+params.get('id'));
  if (open) {
    setTimeout(() => {
      select(open, true);
      if (checkin && canStamp(checkin)) { toggleStamp(checkin); renderSheet(); renderPassport(); }
    }, 300);
    history.replaceState(null, '', location.pathname);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
