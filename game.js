import { createWorld, loadAssets } from './world3d.js';

{
  const C = await fetch('catalog.json').then((r) => r.json());
  const { PARK, WALK, Icons: I } = window;
  const HERO = Object.fromEntries(C.heroes.map((h) => [h.id, h]));
  const $ = (id) => document.getElementById(id);
  I.hydrate();

  // ---------- Константы ----------
  const DAY = C.dayLength;
  const OPEN = 9, CLOSE = 21;
  const MAX_GUESTS = 90;
  const FEED_COST = 15;
  const BUILD_TIME = 4;
  const REACH = 55; // на каком расстоянии (в пикселях карты) директор может что-то сделать
  // Пределы для эффектов утренних событий (ведущий может быть ИИ — не доверяем ему вслепую)
  const LIMITS = { coins: [-600, 500], guests: [-30, 40], mood: [-20, 20] };
  const clampN = (v, [lo, hi]) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fine = matchMedia('(pointer: fine)').matches;

  // ---------- Объекты настоящего парка ----------
  const pad = (n) => String(n).padStart(3, '0');
  const SERVICE_ICON = [[/Туалет/, 'bath'], [/матери/, 'baby'], [/Касса/, 'ticket'], [/Остановка/, 'bus'], [/Парковка/, 'square-parking'], [/Инфоцентр|Администрация|Отдел продаж|Закажи/, 'info']];
  const RIDES = [];
  const SERVICES = [];
  const KASSAS = [];
  for (const it of PARK.items) {
    const cat = it.cats.find((c) => C.categories[c]);
    const base = { id: it.id, name: it.name, x: it.x, y: it.y, photo: it.photo, thumb: it.photo && `assets/thumbs/${pad(it.id)}.jpg` };
    if (cat && !/Отдел продаж|Закажи праздник/.test(it.name)) {
      RIDES.push({ ...base, cat, ...C.categories[cat], ...(C.overrides[it.id] || {}) });
    } else {
      const icon = SERVICE_ICON.find(([re]) => re.test(it.name))?.[1];
      if (icon) SERVICES.push({ ...base, icon });
      if (/Касса/.test(it.name)) KASSAS.push(base);
    }
  }
  const RIDE = Object.fromEntries(RIDES.map((r) => [r.id, r]));
  const CATS = C.categories;

  // ---------- Сетка дорожек ----------
  const CELL = WALK.cell, GW = WALK.w, GH = WALK.h;
  const walk = new Uint8Array(GW * GH);
  WALK.rows.forEach((row, y) => { for (let x = 0; x < GW; x++) walk[y * GW + x] = row.charCodeAt(x) === 49 ? 1 : 0; });
  const cellAt = (x, y) => clamp(Math.floor(y / CELL), 0, GH - 1) * GW + clamp(Math.floor(x / CELL), 0, GW - 1);
  const isWalkXY = (x, y) => x >= 0 && y >= 0 && x < GW * CELL && y < GH * CELL && walk[cellAt(x, y)] === 1;
  const cx = (c) => (c % GW) * CELL + CELL / 2;
  const cy = (c) => Math.floor(c / GW) * CELL + CELL / 2;
  function nearestWalk(x, y, maxR = 40) {
    const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
    for (let r = 0; r <= maxR; r++) {
      let best = -1, bd = 1e9;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH || !walk[ny * GW + nx]) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = ny * GW + nx; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  // Поле расстояний (BFS от целевых клеток). Гости идут «под горку» по нему — путь к аттракциону
  // считается один раз на аттракцион, а не для каждого гостя.
  const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const queue = new Int32Array(GW * GH);
  function makeField(sources) {
    const dist = new Int32Array(GW * GH).fill(-1);
    let qh = 0, qt = 0;
    for (const s of sources) if (s >= 0 && dist[s] < 0) { dist[s] = 0; queue[qt++] = s; }
    while (qh < qt) {
      const c = queue[qh++], x = c % GW, y = (c / GW) | 0;
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const k = ny * GW + nx;
        if (!walk[k] || dist[k] >= 0) continue;
        if (dx && dy && (!walk[y * GW + nx] || !walk[ny * GW + x])) continue; // не срезаем углы
        dist[k] = dist[c] + 1;
        queue[qt++] = k;
      }
    }
    return dist;
  }
  function goalCells(o, r = 3) {
    const c = nearestWalk(o.x, o.y);
    if (c < 0) return [];
    const gx = c % GW, gy = (c / GW) | 0, out = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const k = (gy + dy) * GW + gx + dx;
      if (gx + dx >= 0 && gx + dx < GW && gy + dy >= 0 && gy + dy < GH && walk[k]) out.push(k);
    }
    return out;
  }
  const fields = new Map();
  const fieldFor = (o) => { if (!fields.has(o.id)) fields.set(o.id, makeField(goalCells(o))); return fields.get(o.id); };
  const EXIT = makeField(KASSAS.flatMap((k) => goalCells(k, 2)));
  const ENTRANCES = KASSAS.map((k) => nearestWalk(k.x, k.y)).filter((c) => c >= 0);
  const reachable = (f, x, y) => f[cellAt(x, y)] >= 0 || f[nearestWalk(x, y, 6)] >= 0;
  // каждый объект «смотрит» входом на ближайшую дорожку
  for (const r of RIDES) {
    const c = nearestWalk(r.x, r.y, 12);
    r.face = c >= 0 ? Math.atan2(cx(c) - r.x, cy(c) - r.y) : 0;
  }

  // ---------- Состояние ----------
  const KEY = 'skazka-real-v2';
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  let S = store.get(KEY) || newState();
  function newState() {
    // директор начинает у Колеса обозрения
    const c = nearestWalk(RIDE[28]?.x ?? 1900, (RIDE[28]?.y ?? 900) + 60);
    return {
      coins: C.start.coins, day: 1, time: 0,
      built: Object.fromEntries(C.start.built.map((id) => [id, { food: 100, broken: false, rides: 0 }])),
      building: null,
      player: { x: cx(c), y: cy(c) },
      stats: { served: 0, servedToday: 0, incomeToday: 0, earned: 0, built: 0, fed: 0, cleaned: 0, repaired: 0 },
      quest: 0, moodBonus: 0, heroBonus: 0, dayGuests: 0, extraGuests: 0,
      promos: [], heroes: [], free: [], history: [], lastChoice: null, eventPending: false, introSeen: false,
    };
  }
  const save = () => { S.player = { x: player.x, y: player.y }; store.set(KEY, S); };
  const builtRides = () => RIDES.filter((r) => S.built[r.id]);

  // ---------- Сущности ----------
  const player = { x: S.player.x, y: S.player.y, field: null, dir: -Math.PI / 2, moving: false, sprint: false, goal: null };
  let guests = [];
  let litter = [];
  const floats = [];
  const SKIN = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524'];
  const SHIRT = ['#c0392b', '#2e86de', '#e1b12c', '#44bd32', '#8c7ae6', '#e58e26', '#dcdde1', '#353b48', '#b33939', '#227093', '#ffffff', '#6d214f'];

  // шаг по полю расстояний: следующая клетка «под горку»
  function stepField(e, field, dt, speed) {
    const here = cellAt(e.x, e.y);
    if (field[here] === 0) return 'arrived';
    if (field[here] < 0) {
      const c = nearestWalk(e.x, e.y, 6); // стоим вне дорожки — сначала выходим на ближайшую
      if (c < 0 || field[c] < 0) return 'stuck';
      e.wp = c;
    } else if (e.wp == null || here === e.wp || field[e.wp] >= field[here]) {
      let best = -1, bd = field[here];
      const x = here % GW, y = (here / GW) | 0;
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const k = ny * GW + nx;
        if (field[k] >= 0 && field[k] < bd && (!dx || !dy || (walk[y * GW + nx] && walk[ny * GW + x]))) { bd = field[k]; best = k; }
      }
      if (best < 0) return 'stuck';
      e.wp = best;
    }
    const tx = cx(e.wp) + (e.ox || 0), ty = cy(e.wp) + (e.oy || 0);
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy), st = speed * dt;
    if (d <= st) { e.x = tx; e.y = ty; } else { e.x += (dx / d) * st; e.y += (dy / d) * st; }
    if (d > 0.1) e.dir = Math.atan2(dy, dx);
    return 'moving';
  }

  // гость входит через кассу; inside — сразу оказаться на аллее рядом с работающим аттракционом (утро, старт)
  function spawnGuest(inside = false) {
    if (guests.length >= MAX_GUESTS || !ENTRANCES.length) return;
    let c = pick(ENTRANCES);
    if (inside && builtRides().length) {
      const o = pick(builtRides());
      const n = nearestWalk(o.x + rand(-60, 60), o.y + rand(-60, 60), 8);
      if (n >= 0 && fieldFor(o)[n] >= 0) c = n;
    }
    const g = {
      x: cx(c), y: cy(c), field: null, state: 'walk', target: null, last: null, t: 0,
      happy: rand(55, 75), rides: 0, maxRides: 2 + Math.floor(Math.random() * 4),
      skin: pick(SKIN), shirt: pick(SHIRT), kid: Math.random() < 0.2, speed: rand(4.5, 6.5),
      ox: rand(-3.5, 3.5), oy: rand(-3.5, 3.5), emote: null, emoteT: 0, dir: 0,
    };
    nextTarget(g);
    guests.push(g);
  }
  function nextTarget(g) {
    const closing = hour() >= CLOSE - 0.6;
    const opts = builtRides().filter((r) => r.id !== g.last);
    if (closing || g.rides >= g.maxRides || g.happy < 20 || !opts.length) return leave(g);
    let r = Math.random() * opts.reduce((s, o) => s + o.appeal, 0), o = opts[0];
    for (const x of opts) { r -= x.appeal; if (r <= 0) { o = x; break; } }
    const f = fieldFor(o);
    if (!reachable(f, g.x, g.y)) return leave(g);
    Object.assign(g, { field: f, target: o.id, state: 'walk', wp: null });
  }
  function leave(g) { Object.assign(g, { state: 'leave', field: EXIT, wp: null }); }
  function emote(e, icon, color) { e.emote = icon; e.emoteC = color; e.emoteT = 1.6; }

  function updateGuest(g, dt) {
    g.emoteT -= dt;
    if (g.state === 'ride') {
      g.t -= dt;
      if (g.t > 0) return true;
      const o = RIDE[g.target], b = S.built[g.target];
      if (o && b) {
        b.rides++;
        addCoins(o.income, o);
        g.happy = clamp(g.happy + o.joy * (o.animals ? 0.5 + b.food / 200 : 1), 0, 100);
        emote(g, 'heart', '#f06595');
      }
      g.rides++;
      g.last = g.target;
      nextTarget(g);
      return true;
    }
    g.happy = clamp(g.happy - dt * 0.12, 0, 100);
    if (Math.random() < dt * 0.01 && litter.length < 50) litter.push({ x: g.x + rand(-5, 5), y: g.y + rand(-5, 5), r: rand(0, 3), c: pick(['#fff', '#ffe066', '#ff8787', '#74c0fc']) });
    const res = stepField(g, g.field, dt, g.speed);
    if (res === 'stuck') {
      if (g.state === 'leave') return false;
      leave(g);
      return true;
    }
    if (res !== 'arrived') return true;
    if (g.state === 'leave') { S.stats.served++; S.stats.servedToday++; return false; }
    const o = RIDE[g.target], b = S.built[g.target];
    if (!o || !b) { nextTarget(g); return true; }
    if (b.broken || (o.animals && b.food < 20)) {
      g.happy -= 15;
      emote(g, 'frown', '#f03e3e');
      g.last = o.id;
      nextTarget(g);
      return true;
    }
    g.state = 'ride';
    g.t = rand(1.8, 3);
    return true;
  }

  // ---------- Экономика ----------
  function addCoins(v, at) {
    S.coins += v;
    if (v > 0) { S.stats.earned += v; S.stats.incomeToday += v; }
    if (at) floats.push({ x: at.x, y: at.y, text: `${v > 0 ? '+' : ''}${v}`, icon: 'coins', tone: v > 0 ? 'gold' : 'red', t: 0 });
    bump('coins');
  }
  const hour = () => OPEN + (CLOSE - OPEN) * (S.time / DAY);
  const appealSum = () => builtRides().reduce((s, r) => s + (S.built[r.id].broken ? 0 : r.appeal), 0);
  let moodShown = C.start.mood;
  function mood() {
    const inPark = guests.filter((g) => g.state !== 'leave');
    const base = inPark.length ? inPark.reduce((s, g) => s + g.happy, 0) / inPark.length : C.start.mood;
    const broken = Object.values(S.built).filter((b) => b.broken).length;
    return clamp(base + S.moodBonus + S.heroBonus - litter.length * 1.1 - broken * 4, 0, 100);
  }
  function stars() {
    const score = (moodShown / 100) * 2.5 + Math.min(1, S.stats.servedToday / (40 + S.day * 15)) * 1.5 + Math.min(1, builtRides().length / 20);
    return clamp(Math.round(score), 1, 5);
  }

  // ---------- Задания ----------
  const countBuilt = (pred = () => true) => builtRides().filter(pred).length;
  const QUESTS = [
    { text: 'Постройте первый аттракцион', goal: 1, prog: () => S.stats.built, reward: 300 },
    { text: 'Примите 30 гостей', goal: 30, prog: () => S.stats.served, reward: 300 },
    { text: 'Откройте зону с животными', goal: 1, prog: () => countBuilt((r) => r.animals), reward: 400 },
    { text: 'Покормите животных 3 раза', goal: 3, prog: () => S.stats.fed, reward: 300 },
    { text: 'Уберите 10 бумажек', goal: 10, prog: () => S.stats.cleaned, reward: 250 },
    { text: 'Почините сломанный аттракцион', goal: 1, prog: () => S.stats.repaired, reward: 300 },
    { text: 'Постройте 3 экстремальных аттракциона', goal: 3, prog: () => countBuilt((r) => r.cat === 'extreme'), reward: 700 },
    { text: 'Откройте 15 объектов парка', goal: 15, prog: () => builtRides().length, reward: 800 },
    { text: 'Заработайте 10 000 монет', goal: 10000, prog: () => S.stats.earned, reward: 1000 },
    { text: 'Поднимите рейтинг до 5 звёзд', goal: 5, prog: () => stars(), reward: 1500 },
    { text: 'Восстановите всю «Сказку»', goal: RIDES.length, prog: () => builtRides().length, reward: 5000 },
  ];
  function checkQuest() {
    const q = QUESTS[S.quest];
    if (!q || q.prog() < q.goal) return;
    S.quest++;
    addCoins(q.reward);
    toast(`Задание выполнено! +${q.reward} монет`, 'trophy');
    confetti(innerWidth - 140, 120);
    $('quest').classList.remove('done'); void $('quest').offsetWidth; $('quest').classList.add('done');
  }
  let questKey = '';
  function renderQuest() {
    const q = QUESTS[S.quest];
    const key = q ? `${S.quest}:${q.prog()}` : 'done';
    if (key === questKey) return;
    questKey = key;
    $('quest').innerHTML = q
      ? `<h4>Задание ${S.quest + 1} из ${QUESTS.length}</h4><div class="q">${q.text}</div>
         <div class="bar"><em style="width:${Math.min(100, (q.prog() / q.goal) * 100)}%"></em></div>`
      : `<h4>Все задания</h4><div class="q">Все задания выполнены</div>`;
  }

  // ---------- Стройка и уход ----------
  // Каждая следующая постройка дороже на INFLATION: материалы и подрядчики дорожают вместе с парком
  const INFLATION = 1.15;
  const priceOf = (o) => (S.free.includes(o.id) ? 0 : Math.round((o.cost * INFLATION ** S.stats.built) / 10) * 10);
  // Содержание в день: зарплаты персонала + обслуживание каждой постройки
  const STAFF = 150;
  const upkeepOf = (o) => Math.round(o.cost * 0.05);
  const upkeep = () => STAFF + builtRides().reduce((s, o) => s + upkeepOf(o), 0);
  const canAfford = (o) => S.coins >= priceOf(o);
  const near = (o) => Math.hypot(player.x - o.x, player.y - o.y) < REACH;
  function orderBuild(o) {
    if (S.built[o.id]) return toast('Уже построено');
    if (S.building) return toast('Сначала закончите текущую стройку', 'hammer');
    if (!canAfford(o)) return toast('Не хватает монет', 'coins');
    closeInfo();
    if (near(o)) return startBuild(o);
    if (!walkTo(o)) return toast('Туда не пройти');
    player.goal = { type: 'build', id: o.id };
    toast(`Директор идёт на участок «${o.name}»`, 'footprints');
  }
  function startBuild(o) {
    player.goal = null;
    if (S.built[o.id] || S.building || !canAfford(o)) return;
    const price = priceOf(o);
    if (S.free.includes(o.id)) S.free.splice(S.free.indexOf(o.id), 1);
    else addCoins(-price, o);
    S.building = { id: o.id, t: 0, paid: price };
    save();
  }
  function finishBuild() {
    const o = RIDE[S.building.id];
    S.built[o.id] = { food: 100, broken: false, rides: 0, paid: S.building.paid ?? o.cost, born: performance.now() };
    S.building = null;
    S.stats.built++;
    toast(`«${o.name}» открыт для гостей!`, 'party-popper');
    const p = world.screenOf(o.x, o.y, 6);
    confetti(p.x, p.y);
    save();
  }
  function demolish(o) {
    const refund = Math.round((S.built[o.id].paid ?? o.cost) / 2);
    delete S.built[o.id];
    addCoins(refund, o);
    toast(`«${o.name}» закрыт, возвращено 50%`);
    closeInfo();
    save();
  }
  function nearbyTask() {
    let best = null, bd = REACH;
    for (const o of builtRides()) {
      const b = S.built[o.id];
      if (!b.broken && !(o.animals && b.food < 85)) continue;
      const d = Math.hypot(player.x - o.x, player.y - o.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  function interact(o = nearbyTask()) {
    if (!o || !S.built[o.id]) return;
    const b = S.built[o.id];
    if (!near(o)) { if (walkTo(o)) player.goal = { type: 'task', id: o.id }; return; }
    if (b.broken) {
      b.broken = false;
      S.stats.repaired++;
      floats.push({ x: o.x, y: o.y, text: 'Починено', icon: 'wrench', tone: 'green', t: 0 });
    } else if (o.animals) {
      if (S.coins < FEED_COST) return toast('Не хватает монет на корм', 'coins');
      addCoins(-FEED_COST);
      b.food = 100;
      S.stats.fed++;
      floats.push({ x: o.x, y: o.y, text: 'Накормлены', icon: 'carrot', tone: 'green', t: 0 });
    }
    refreshInfo();
  }
  function walkTo(o) {
    const f = makeField(goalCells(o, 2));
    if (!reachable(f, player.x, player.y)) return false;
    player.field = f; player.wp = null; focus = null;
    return true;
  }

  // ---------- Игровой цикл ----------
  let paused = false;
  let spawnAcc = 0;
  let lastSave = 0;
  const keys = new Set();

  function update(dt) {
    // вперёд — туда, куда смотрит камера; ввод с клавиатуры или джойстика
    const k = (...ks) => ks.some((x) => keys.has(x));
    let f = (k('w', 'ц', 'arrowup') ? 1 : 0) - (k('s', 'ы', 'arrowdown') ? 1 : 0) + stick.y;
    let r = (k('d', 'в', 'arrowright') ? 1 : 0) - (k('a', 'ф', 'arrowleft') ? 1 : 0) + stick.x;
    const yaw = world.cam.yaw;
    let mx = -Math.sin(yaw) * f + Math.cos(yaw) * r;
    let my = -Math.cos(yaw) * f - Math.sin(yaw) * r;
    player.moving = false;
    player.sprint = keys.has('shift') || Math.hypot(stick.x, stick.y) > 0.92;
    const SPEED = player.sprint ? 30 : 17; // пикселей карты в секунду: 7 и 12 м/с
    if (Math.hypot(mx, my) > 0.05) {
      player.field = null; player.goal = null; focus = null;
      const l = Math.max(1, Math.hypot(mx, my)), st = SPEED * dt;
      const nx = player.x + (mx / l) * st, ny = player.y + (my / l) * st;
      if (isWalkXY(nx, ny)) { player.x = nx; player.y = ny; }
      else if (isWalkXY(nx, player.y)) player.x = nx;
      else if (isWalkXY(player.x, ny)) player.y = ny;
      player.dir = Math.atan2(my, mx);
      player.moving = true;
    } else if (player.field) {
      const r = stepField(player, player.field, dt, SPEED);
      player.moving = r === 'moving';
      if (r !== 'moving') {
        player.field = null;
        const g = player.goal;
        if (g?.type === 'build' && Math.hypot(player.x - RIDE[g.id].x, player.y - RIDE[g.id].y) < REACH * 1.6) startBuild(RIDE[g.id]);
        if (g?.type === 'task') { player.goal = null; if (near(RIDE[g.id])) interact(RIDE[g.id]); }
      }
    }
    litter = litter.filter((l) => {
      if (Math.hypot(l.x - player.x, l.y - player.y) > 18) return true;
      S.stats.cleaned++;
      floats.push({ x: l.x, y: l.y, text: '', icon: 'sparkles', tone: 'gold', t: 0 });
      return false;
    });

    if (S.building) {
      S.building.t += dt;
      if (S.building.t >= BUILD_TIME) finishBuild();
    }
    if (paused) return;
    S.time += dt;

    if (hour() < CLOSE - 1.2) {
      const rate = (0.3 + appealSum() * 0.06) * (0.4 + moodShown / 100) * Math.max(0.2, 1 + S.dayGuests / 40);
      spawnAcc += rate * dt;
      if (S.extraGuests > 0 && Math.random() < dt * 0.6) { S.extraGuests--; spawnAcc++; }
      while (spawnAcc >= 1) { spawnAcc--; spawnGuest(); }
    }
    guests = guests.filter((g) => updateGuest(g, dt));

    for (const o of builtRides()) {
      const b = S.built[o.id];
      if (o.animals) {
        const before = b.food;
        b.food = Math.max(0, b.food - dt * 1.1);
        if (before >= 25 && b.food < 25) toast(`${o.name}: животные голодны!`, 'carrot');
      }
      if (o.breaks && !b.broken && Math.random() < dt * 0.002) { b.broken = true; toast(`«${o.name}» сломался — подойдите и почините`, 'wrench'); }
    }
    moodShown += (mood() - moodShown) * Math.min(1, dt * 1.5);
    checkQuest();
    if (S.coins < 0) return bankrupt();
    if (S.time >= DAY) endDay();
    if (performance.now() - lastSave > 3000) { lastSave = performance.now(); save(); }
  }

  // ---------- Смена дней и события ----------
  const starsHTML = (n) => Array.from({ length: 5 }, (_, i) => I.svg('star', i < n ? 'on' : '')).join('');
  function endDay() {
    paused = true;
    S.stats.served += guests.length; // кто не дошёл до выхода, всё равно побывал в парке
    S.stats.servedToday += guests.length;
    guests = [];
    const cost = upkeep();
    addCoins(-cost);
    if (S.coins < 0) return bankrupt(cost);
    const net = S.stats.incomeToday - cost;
    showModal(`
      <div class="host-row"><div class="av">${I.svg('moon')}</div><div><h2>День ${S.day} окончен</h2><small>Парк закрылся, гости разошлись по домам</small></div></div>
      <div class="summary">
        <div><b>${S.stats.servedToday}</b><span>гостей принято</span></div>
        <div><b>+${S.stats.incomeToday}</b><span>выручка за день</span></div>
        <div><b class="neg-v">−${cost}</b><span>зарплаты и обслуживание</span></div>
        <div><b class="${net < 0 ? 'neg-v' : 'pos-v'}">${net >= 0 ? '+' : '−'}${Math.abs(net)}</b><span>итог дня</span></div>
        <div><b>${Math.round(moodShown)}</b><span>настроение гостей</span></div>
        <div><b class="stars">${starsHTML(stars())}</b><span>рейтинг парка</span></div>
      </div>
      ${S.coins < cost ? `<p class="warn">${I.svg('coins')} В кассе ${S.coins} — меньше, чем расходы на завтра (${upkeep()}). Если деньги кончатся, парк обанкротится.</p>` : ''}
      <div class="cta"><button class="btn primary" id="next-day">${I.svg('sun')} Новый день</button></div>`);
    $('next-day').onclick = () => {
      Object.assign(S, { day: S.day + 1, time: 0, moodBonus: 0, dayGuests: 0, eventPending: true });
      S.stats.servedToday = 0; S.stats.incomeToday = 0;
      litter = litter.slice(0, 10);
      for (let i = 0; i < 20; i++) spawnGuest(true);
      save();
      morningEvent();
    };
  }

  // Деньги кончились — парк закрыт, игра окончена
  let bankruptShown = false;
  function bankrupt(lastCost) {
    if (bankruptShown) return;
    bankruptShown = true;
    S.over = true;
    paused = true;
    guests = [];
    save();
    showModal(`
      <div class="host-row"><div class="av over">${I.svg('frown')}</div><div><h2>Банкротство</h2><small>В кассе не осталось денег — «Сказка» закрывается</small></div></div>
      <p>${lastCost ? `Вечером нужно было заплатить персоналу и за обслуживание аттракционов ${lastCost} монет, а денег не хватило.` : 'Расходы оказались больше, чем было денег в кассе.'} Следите за балансом: каждая постройка стоит всё дороже и требует денег на содержание каждый день.</p>
      <div class="summary">
        <div><b>${S.day}</b><span>дней продержался парк</span></div>
        <div><b>${builtRides().length}</b><span>объектов работало</span></div>
        <div><b>${S.stats.served}</b><span>гостей всего</span></div>
        <div><b>${S.stats.earned}</b><span>монет заработано</span></div>
      </div>
      <div class="cta"><button class="btn primary" id="restart">${I.svg('play')} Начать заново</button></div>`);
    $('restart').onclick = () => { store.set(KEY, null); location.reload(); };
  }

  async function morningEvent() {
    paused = true;
    showModal(`<div class="host-row"><div class="av"><img src="${HERO.feya.photo}" alt=""></div><div><h2>Утро в «Сказке»</h2><small>Готовим сводку на день…</small></div></div>`);
    let ev = null;
    try {
      ev = await window.SkazkaHost.nextTurn({
        day: S.day,
        state: { coins: S.coins, mood: Math.round(moodShown), buildings: builtRides().map((r) => r.id), guests_yesterday: S.stats.served, heroes: S.heroes },
        last_choice: S.lastChoice, history: S.history.slice(-6),
      });
    } catch { /* ведущий недоступен — день начинается без события */ }
    if (!ev || !Array.isArray(ev.options) || !ev.options.length) { closeModal(); S.eventPending = false; paused = false; return; }
    const host = HERO[ev.speaker] || HERO.feya;
    const opts = ev.options.slice(0, 3).map((o) => ({
      title: String(o.title || ''), description: String(o.description || ''),
      coins: clampN(o.coins, LIMITS.coins), guests: clampN(o.guests, LIMITS.guests), mood: clampN(o.mood, LIMITS.mood),
    }));
    const fx = (o) => [[o.coins, 'coins'], [o.guests, 'users'], [o.mood, 'smile']].filter(([v]) => v)
      .map(([v, i]) => `<span class="${v < 0 ? 'neg' : ''}">${v > 0 ? '+' : ''}${v} ${I.svg(i)}</span>`).join('');
    showModal(`
      <div class="host-row"><div class="av"><img src="${host.photo}" alt=""></div><div><small>День ${S.day} · ${esc(host.name)}</small><h2>${esc(ev.event_title)}</h2></div></div>
      ${ev.consequence ? `<p class="conseq">${esc(ev.consequence)}</p>` : ''}
      <p>${esc(ev.situation)}</p>
      <div class="choices">${opts.map((o, i) => `
        <button class="choice" data-i="${i}" ${S.coins + o.coins < 0 ? 'disabled title="Не хватает денег"' : ''}><b>${esc(o.title)}</b><small>${esc(o.description)}</small><span class="fx">${fx(o)}</span></button>`).join('')}</div>`);
    $('modal-card').querySelectorAll('.choice').forEach((btn) => btn.onclick = () => {
      if (btn.disabled) return;
      const o = opts[+btn.dataset.i];
      if (o.coins) addCoins(o.coins);
      Object.assign(S, { dayGuests: o.guests, moodBonus: o.mood, lastChoice: o, eventPending: false });
      S.history.push({ day: S.day, event: ev.event_title, choice: o.title });
      save();
      closeModal();
      paused = false;
      toast(o.title, 'check');
    });
  }

  // ---------- 3D-мир ----------
  const mobileGPU = matchMedia('(pointer: coarse)').matches;
  await loadAssets((k) => { $('load-bar').style.width = `${Math.round(k * 100)}%`; }, { mobile: mobileGPU });
  $('loading').classList.add('done');
  setTimeout(() => $('loading').remove(), 700);
  const world = createWorld({
    canvas: $('world'), rides: RIDES, services: SERVICES, kassas: KASSAS, Icons: I,
    quality: mobileGPU ? 'low' : 'high',
  });
  let selected = null;
  let buildMode = false;
  let focus = null; // объект, к которому временно повёрнута камера
  let lastT = performance.now();
  const TONE = { gold: '#ffd43b', red: '#ff8787', green: '#8ce99a' };
  const floatLayer = $('floats');

  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    update(dt);
    const busy = new Set();
    for (const g of guests) if (g.state === 'ride') busy.add(g.target);
    const camTarget = focus || player;
    world.sync(dt, {
      hour: hour(),
      buildMode,
      selected: selected?.id ?? null,
      guests,
      litter,
      player: { x: camTarget.x, y: camTarget.y, dir: player.dir, moving: player.moving, sprint: player.sprint, px: player.x, py: player.y },
      rides(id) {
        const b = S.built[id];
        const isB = S.building?.id === id;
        return {
          built: !!b, building: isB, progress: isB ? S.building.t / BUILD_TIME : 0,
          broken: !!b?.broken, food: b?.food ?? 100, hungry: !!(b && RIDE[id].animals && b.food < 35), busy: busy.has(id),
        };
      },
    });
    // всплывающие надписи над объектами
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.t += dt;
      if (!f.el) {
        f.el = document.createElement('div');
        f.el.className = 'float';
        f.el.style.color = TONE[f.tone];
        f.el.innerHTML = `${f.text ? `<b>${esc(f.text)}</b>` : ''}${I.svg(f.icon)}`;
        floatLayer.append(f.el);
      }
      const p = world.screenOf(f.x, f.y, f.h ?? 5);
      if (f.t > 1.4 || !p.visible) { f.el.remove(); floats.splice(i, 1); continue; }
      f.el.style.transform = `translate(${p.x}px, ${p.y - f.t * 40}px) translate(-50%, -100%)`;
      f.el.style.opacity = String(1 - f.t / 1.4);
    }
    renderHUD(now);
    requestAnimationFrame(frame);
  }

  // ---------- Интерфейс ----------
  const shown = {};
  function bump(id) { const el = $(id); el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 250); }
  let hudT = 0;
  function renderHUD(now) {
    if (now - hudT < 150) return;
    hudT = now;
    const set = (id, v, html) => { if (shown[id] !== v) { shown[id] = v; if (html) $(id).innerHTML = v; else $(id).textContent = v; } };
    set('coins', S.coins.toLocaleString('ru-RU'));
    set('guests', String(guests.length));
    set('mood', String(Math.round(moodShown)));
    $('mood-bar').style.width = `${moodShown}%`;
    set('stars', starsHTML(stars()), true);
    const h = hour(), hh = Math.min(21, Math.floor(h)), mm = Math.floor((h - Math.floor(h)) * 6) * 10;
    set('clock', `День ${S.day} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
    set('sun', I.svg(h >= 18 ? 'moon' : h >= 16 ? 'sunset' : 'sun'), true);
    renderQuest();
    const task = nearbyTask();
    const act = $('act');
    if (task) {
      const b = S.built[task.id];
      const html = (b.broken ? `${I.svg('wrench')}Починить` : `${I.svg('carrot')}Покормить · ${FEED_COST}`) + (fine ? ' <kbd>E</kbd>' : '');
      if (act.hidden || act.dataset.k !== html + task.id) { act.hidden = false; act.dataset.k = html + task.id; act.dataset.id = task.id; act.innerHTML = html; }
    } else act.hidden = true;
    if (selected && now - (refreshInfo.t || 0) > 500) { refreshInfo.t = now; refreshInfo(); }
  }
  $('act').onclick = () => interact(RIDE[+$('act').dataset.id]);

  function toast(text, icon) {
    const el = document.createElement('div');
    el.className = 'toast glass';
    el.innerHTML = (icon ? I.svg(icon) : '') + `<span>${esc(text)}</span>`;
    $('toasts').append(el);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
    setTimeout(() => el.remove(), 3100);
  }
  function confetti(x, y) {
    for (let i = 0; i < 30; i++) {
      const el = document.createElement('i');
      el.style.cssText = `position:fixed;z-index:70;left:${x}px;top:${y}px;width:8px;height:12px;border-radius:2px;pointer-events:none;background:${pick(['#ff5a2c', '#ffd43b', '#4dabf7', '#ff4fa3', '#69db7c'])}`;
      document.body.append(el);
      el.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${rand(-160, 160)}px, ${rand(80, 260)}px) rotate(${rand(-540, 540)}deg)`, opacity: 0 }],
        { duration: rand(900, 1500), easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => el.remove();
    }
  }
  function showModal(html) { $('modal-card').innerHTML = html; $('modal').hidden = false; }
  function closeModal() { $('modal').hidden = true; }

  // Свободные участки
  let shopCat = null;
  function openShop() {
    closeInfo();
    buildMode = true;
    $('panel-build').hidden = false;
    document.querySelector('[data-open="build"]').classList.add('on');
    const free = RIDES.filter((r) => !S.built[r.id]);
    $('cats').innerHTML = `<button class="${!shopCat ? 'on' : ''}" data-c="">Все · ${free.length}</button>` + Object.entries(CATS)
      .filter(([id]) => free.some((r) => r.cat === id))
      .map(([id, c]) => `<button class="${shopCat === id ? 'on' : ''}" data-c="${id}">${I.svg(c.icon)}${c.label}</button>`).join('');
    const list = free.filter((r) => !shopCat || r.cat === shopCat).sort((a, b) => priceOf(a) - priceOf(b));
    $('shop').innerHTML = list.length ? list.map((r) => `
      <button class="item" data-id="${r.id}" ${canAfford(r) ? '' : 'disabled'}>
        <img src="${r.thumb || ''}" alt="" loading="lazy">
        <b>${esc(r.name)}</b>
        <div class="meta"><span class="price">${S.free.includes(r.id) ? 'Бесплатно' : `${I.svg('coins')} ${priceOf(r)}`}</span><span>билет ${r.income}</span></div>
        <div class="meta"><span>содержание ${upkeepOf(r)}/день</span></div>
        <div class="meta"><span class="tag" style="background:${r.color}">${I.svg(r.icon)}${r.label}</span></div>
      </button>`).join('') : `<div class="empty-shop">Все участки этой категории уже застроены</div>`;
  }
  function closeShop() { buildMode = false; $('panel-build').hidden = true; document.querySelector('[data-open="build"]').classList.remove('on'); }
  $('cats').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { shopCat = b.dataset.c || null; openShop(); } });
  $('shop').addEventListener('click', (e) => {
    const it = e.target.closest('.item');
    if (!it) return;
    const o = RIDE[+it.dataset.id];
    closeShop();
    flyTo(o);
    openInfo(o);
  });
  function flyTo(o) { focus = { x: o.x, y: o.y }; }

  // Карточка объекта
  function openInfo(o) { selected = o; refreshInfo(); $('info').hidden = false; }
  function closeInfo() { selected = null; focus = null; $('info').hidden = true; }
  function refreshInfo() {
    const o = selected;
    if (!o) return;
    const b = S.built[o.id];
    const close = near(o);
    const cat = `<span class="cat" style="background:${o.color}">${I.svg(o.icon)}${o.label}</span>`;
    let body;
    if (!b) {
      const isB = S.building?.id === o.id;
      body = `
        <p>${isB ? 'Идёт строительство…' : 'Свободный участок на настоящем месте в парке. Директор придёт сюда и построит объект.'}</p>
        ${isB ? `<div class="progress"><em style="width:${(S.building.t / BUILD_TIME) * 100}%"></em></div>` : ''}
        <div class="stats">
          <div>Цена: <b class="cost">${S.free.includes(o.id) ? 'бесплатно' : priceOf(o)}</b></div>
          <div>Содержание: <b>${upkeepOf(o)}/день</b></div>
          <div>Билет: <b>${o.income}</b></div>
          <div>Радость: <b>+${o.joy}</b></div>
          <div>Интерес: <b>${o.appeal}</b></div>
        </div>
        ${isB ? '' : `<div class="row"><button class="btn primary" data-a="build" ${canAfford(o) && !S.building ? '' : 'disabled'}>${I.svg('hammer')} ${close ? 'Построить' : 'Идти и построить'}</button></div>`}`;
    } else {
      let action = '';
      if (b.broken) action = `<button class="btn primary" data-a="do">${I.svg('wrench')} ${close ? 'Починить' : 'Подойти и починить'}</button>`;
      else if (o.animals) action = `<button class="btn primary" data-a="do">${I.svg('carrot')} ${close ? `Покормить · ${FEED_COST}` : 'Подойти покормить'}</button>`;
      body = `
        <div class="stats">
          <div>Билет: <b>${o.income}</b></div>
          <div>Катаний: <b>${b.rides}</b></div>
          <div>Радость: <b>+${o.joy}</b></div>
          <div>${b.broken ? '<b style="color:#ff8787">Сломан</b>' : '<b style="color:#8ce99a">Работает</b>'}</div>
        </div>
        ${o.animals ? `<small>Сытость животных</small><div class="meter"><em style="width:${b.food}%;background:${b.food > 50 ? '#51cf66' : b.food > 25 ? '#ffd43b' : '#ff6b6b'}"></em></div>` : ''}
        ${action ? `<div class="row">${action}</div>` : ''}
        <div class="stats"><div>Содержание: <b>${upkeepOf(o)}/день</b></div></div>
        <div class="row" style="margin-top:8px"><button class="btn glass" data-a="sell">Закрыть +${Math.round((b.paid ?? o.cost) / 2)}</button></div>`;
    }
    const html = `
      <button class="x info-x" data-a="close" aria-label="Закрыть">${I.svg('x')}</button>
      ${o.photo ? `<img src="map/${o.photo}" alt="">` : ''}
      <div class="in">
        ${cat}
        <h3>${esc(o.name)}</h3>
        ${body}
        <div class="row" style="margin-top:8px"><a class="btn glass" href="map/?id=${o.id}" target="_blank">${I.svg('map-pin')} В настоящем парке</a></div>
      </div>`;
    // перерисовываем только при изменениях, иначе клик по кнопке может «потеряться»
    if ($('info').dataset.html !== html) { $('info').dataset.html = html; $('info').innerHTML = html; }
  }
  $('info').addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    const o = selected;
    if (!a || !o) return;
    if (a === 'close') closeInfo();
    if (a === 'build') orderBuild(o);
    if (a === 'do') interact(o);
    if (a === 'sell' && confirm(`Закрыть «${o.name}»?`)) demolish(o);
  });

  document.querySelector('.dock').addEventListener('click', (e) => {
    const k = e.target.closest('[data-open]')?.dataset.open;
    if (k === 'build') $('panel-build').hidden ? openShop() : closeShop();
    if (k === 'quests') showQuests();
    if (k === 'promo') showPromo();
    if (k === 'help') showHelp();
  });
  $('panel-build').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeShop(); });
  $('modal').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || (e.target === $('modal') && !S.eventPending && !S.over && S.introSeen && S.time < DAY)) { closeModal(); paused = false; }
  });

  function showQuests() {
    paused = true;
    showModal(`<h2>Задания директора</h2><p>Выполняйте по порядку и получайте награды.</p>
      <div class="qlist">${QUESTS.map((q, i) => `<div class="${i < S.quest ? 'ok' : ''}">${I.svg(i < S.quest ? 'check' : i === S.quest ? 'arrow-right' : 'lock')} ${q.text}<small>+${q.reward}</small></div>`).join('')}</div>
      <div class="cta"><button class="btn primary" data-close>Понятно</button></div>`);
  }
  function showPromo() {
    paused = true;
    showModal(`<div class="host-row"><div class="av">${I.svg('ticket')}</div><div><h2>Сказочный паспорт</h2><small>Бонусы за визиты в настоящий парк</small></div></div>
      <p>Отмечайтесь на аттракционах в <a href="map/" target="_blank" style="text-decoration:underline">карте парка</a> и вводите полученные коды.</p>
      <form class="promo-form" id="promo-form"><input id="promo-in" placeholder="SKAZKA-…" autocomplete="off"><button class="btn primary">OK</button></form>
      <p id="promo-msg" style="margin-top:10px"></p>
      <div class="cta"><button class="btn glass" data-close>Закрыть</button></div>`);
    $('promo-form').onsubmit = (e) => {
      e.preventDefault();
      const code = $('promo-in').value.trim().toUpperCase();
      const p = C.promo.find((x) => x.code === code);
      const msg = $('promo-msg');
      if (!p) { msg.textContent = 'Такого кода нет. Коды выдаёт «Сказочный паспорт» в карте парка.'; return; }
      if (S.promos.includes(code)) { msg.textContent = 'Этот код уже использован.'; return; }
      S.promos.push(code);
      if (p.coins) addCoins(p.coins);
      if (p.mood) S.heroBonus += p.mood;
      if (p.hero && !S.heroes.includes(p.hero)) S.heroes.push(p.hero);
      if (p.build && !S.built[p.build]) S.free.push(p.build);
      if (p.guests) S.extraGuests += p.guests;
      save();
      msg.textContent = `Готово: ${p.title}!`;
      confetti(innerWidth / 2, innerHeight / 2);
    };
  }
  function showHelp(first) {
    paused = true;
    showModal(`<div class="host-row"><div class="av"><img src="${HERO.feya.photo}" alt=""></div><div><small>Управляющая парком</small><h2>${first ? 'Добро пожаловать' : 'Как играть'}</h2></div></div>
      <p>Вы стоите в настоящем парке «Сказка» в Крылатском — карта 1 к 1. Пока работают только колесо обозрения, карусель «Вальс» и блинная. Остальные ${RIDES.length - C.start.built.length} объектов — свободные участки на своих реальных местах. Восстановите парк целиком!</p>
      <p><b>Деньги.</b> Каждый вечер платите зарплату персоналу и за обслуживание всех построек. Каждая новая постройка дороже предыдущей на 15%. Если деньги кончатся — банкротство, игра окончена.</p>
      <div class="keys">
        <kbd>WASD</kbd><span>ходить (Shift — бегом). На телефоне — джойстик слева</span>
        <kbd>Мышь / палец</kbd><span>перетаскивайте, чтобы повернуть камеру; клик по дорожке — идти туда</span>
        <kbd>B</kbd><span>свободные участки — выберите и постройте</span>
        <kbd>E</kbd><span>покормить животных или починить аттракцион рядом</span>
        <kbd>Клик по объекту</kbd><span>информация и действия</span>
        <kbd>Колесо / щипок</kbd><span>приблизить или отдалить камеру</span>
        <kbd>Мусор</kbd><span>подбирается сам, когда директор проходит рядом</span>
      </div>
      <div class="cta"><button class="btn primary" data-close>${first ? `${I.svg('play')} Начать` : 'Понятно'}</button></div>`);
    S.introSeen = true;
    save();
  }

  // ---------- Управление ----------
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === 'e' || k === 'у') interact();
    if (k === 'b' || k === 'и') $('panel-build').hidden ? openShop() : closeShop();
    if (k === 'escape') { closeShop(); closeInfo(); }
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());

  // Камера: перетаскивание — поворот, колесо/щипок — приближение, клик/тап — выбрать или идти
  const cam = world.cam;
  const DMIN = 6, DMAX = 160;
  const zoomBy = (k) => { cam.dist = clamp(cam.dist * k, DMIN, DMAX); };
  const pointers = new Map();
  let drag = null, pinch = null;
  const canvas = $('world');
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, moved: false };
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: cam.dist }; drag = null; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      cam.dist = clamp(pinch.dist * pinch.d / Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), DMIN, DMAX);
      return;
    }
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true;
    if (drag.moved) {
      cam.yaw -= (e.clientX - prev.x) * 0.006;
      cam.pitch = clamp(cam.pitch + (e.clientY - prev.y) * 0.004, 0.12, 1.45);
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && !drag.moved && pointers.size === 0) tap(e.clientX, e.clientY);
    if (pointers.size === 0) drag = null;
  });
  canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); drag = null; pinch = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(e.deltaY > 0 ? 1.12 : 0.89); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  $('zin').onclick = () => zoomBy(0.8);
  $('zout').onclick = () => zoomBy(1.25);

  // Джойстик для телефона
  const stick = { x: 0, y: 0 };
  const stickPad = $('stick'), knob = stickPad.querySelector('i');
  let stickId = null;
  const moveStick = (e) => {
    const r = stickPad.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const max = r.width / 2, l = Math.hypot(dx, dy);
    if (l > max) { dx *= max / l; dy *= max / l; }
    stick.x = dx / max; stick.y = -dy / max;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  stickPad.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stickPad.setPointerCapture(e.pointerId); moveStick(e); });
  stickPad.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
  const endStick = () => { stickId = null; stick.x = stick.y = 0; knob.style.transform = ''; };
  stickPad.addEventListener('pointerup', endStick);
  stickPad.addEventListener('pointercancel', endStick);

  function tap(sx, sy) {
    const hit = world.pick(sx, sy);
    if (!hit) return;
    if (hit.ride != null) { openInfo(RIDE[hit.ride]); return; }
    closeInfo();
    const c = nearestWalk(hit.x, hit.y, 4);
    if (c < 0) return;
    const f = makeField([c]);
    if (!reachable(f, player.x, player.y)) return;
    player.field = f; player.wp = null; player.goal = null; focus = null;
    floats.push({ x: cx(c), y: cy(c), h: 0.5, text: '', icon: 'map-pin', tone: 'gold', t: 0 });
  }

  // ---------- Старт ----------
  cam.yaw = 0.35;
  if (matchMedia('(pointer: coarse)').matches) { cam.dist = 50; cam.pitch = 0.75; }
  for (let i = 0; i < 30; i++) spawnGuest(true);
  if (S.over) bankrupt();
  else if (!S.introSeen) showHelp(true);
  else if (S.eventPending) morningEvent();
  requestAnimationFrame(frame);

  window.__skazka = { S, RIDES, get guests() { return guests; }, spawnGuest, endDay, player, orderBuild, interact, startBuild, world };
}
