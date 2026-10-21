(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;

  // Заголовок появляется по словам
  document.querySelectorAll('.split').forEach((el) => {
    let i = 0;
    const wrap = (node) => {
      if (node.nodeType === 3) {
        const frag = document.createDocumentFragment();
        node.textContent.split(/(\s+)/).forEach((part) => {
          if (!part.trim()) { frag.append(part); return; }
          const s = document.createElement('span');
          s.className = 'w';
          s.style.animationDelay = `${0.1 + i++ * 0.08}s`;
          s.textContent = part;
          frag.append(s);
        });
        node.replaceWith(frag);
      } else if (node.classList?.contains('grad')) {
        node.classList.add('w');
        node.style.animationDelay = `${0.1 + i++ * 0.08}s`;
      } else {
        [...node.childNodes].forEach(wrap);
      }
    };
    [...el.childNodes].forEach(wrap);
  });

  // Появление блоков при прокрутке
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in');
    e.target.querySelectorAll('[data-count]').forEach(countUp);
    io.unobserve(e.target);
  }), { threshold: 0.15 });
  const observe = () => document.querySelectorAll('.reveal:not(.in)').forEach((el) => io.observe(el));

  function countUp(el) {
    const to = +el.dataset.count;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 1400);
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Блик на стекле и свечение за курсором
  const glow = document.querySelector('.cursor-glow');
  addEventListener('pointermove', (e) => {
    glow.style.setProperty('--cx', `${e.clientX}px`);
    glow.style.setProperty('--cy', `${e.clientY}px`);
    const g = e.target.closest?.('.glass');
    if (g) {
      const r = g.getBoundingClientRect();
      g.style.setProperty('--mx', `${e.clientX - r.left}px`);
      g.style.setProperty('--my', `${e.clientY - r.top}px`);
    }
  }, { passive: true });

  if (!reduce && fine) {
    // Параллакс сцены на первом экране
    const scene = document.querySelector('[data-parallax]');
    addEventListener('pointermove', (e) => {
      const x = e.clientX / innerWidth - 0.5;
      const y = e.clientY / innerHeight - 0.5;
      scene.querySelectorAll('[data-depth]').forEach((el) => {
        const d = +el.dataset.depth;
        el.style.transform = `translate3d(${-x * d}px, ${-y * d}px, 0) rotateY(${x * 10}deg) rotateX(${-y * 10}deg)`;
      });
    }, { passive: true });

    // Магнитные кнопки
    document.querySelectorAll('[data-magnet]').forEach((b) => {
      b.addEventListener('pointermove', (e) => {
        const r = b.getBoundingClientRect();
        b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.25}px, ${(e.clientY - r.top - r.height / 2) * 0.35}px)`;
      });
      b.addEventListener('pointerleave', () => { b.style.transform = ''; });
    });
  }

  // 3D-наклон карточек
  function tilt(el) {
    if (reduce || !fine) return;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(900px) rotateY(${x * 14}deg) rotateX(${-y * 14}deg) translateY(-6px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  }

  // Контент из каталога игры
  const I = window.Icons;
  I.hydrate();
  const fx = (v, icon, suffix = '') => v ? `<span class="${v < 0 ? 'neg' : ''}">${v > 0 ? '+' : ''}${v}${suffix} ${I.svg(icon)}</span>` : '';
  const plural = (n) => (n === 1 ? 'отметка' : n < 5 ? 'отметки' : 'отметок');

  fetch('catalog.json').then((r) => r.json()).then((c) => {
    const heroes = document.getElementById('heroes-grid');
    heroes.innerHTML = c.heroes.map((h, i) => `
      <div class="glass hcard reveal" style="--d:${i * 0.07}s"><div class="avatar"><img src="${h.photo}" alt=""></div>
        <span class="role">${h.role}</span><h3>${h.name}</h3><p>${h.text}</p></div>`).join('');
    heroes.querySelectorAll('.hcard').forEach(tilt);

    const items = Object.fromEntries(window.PARK.items.map((it) => [it.id, it]));
    const card = (id) => {
      const it = items[id];
      const cat = c.categories[it.cats.find((x) => c.categories[x])];
      const o = { ...cat, ...(c.overrides[id] || {}) };
      return `
      <a class="glass bcard" href="map/?id=${id}"><img src="map/${it.photo}" alt="${it.name}" loading="lazy">
        <div class="in"><span class="tag" style="background:${cat.color}">${I.svg(cat.icon)}${cat.label}</span><h3>${it.name}</h3>
          <div class="fx">${fx(-o.cost, 'coins')}${fx(o.income, 'ticket', ' за билет')}</div>
          <span class="find">${I.svg('map-pin')} Найти в парке ${I.svg('arrow-right')}</span></div></a>`;
    };
    const half = Math.ceil(c.featured.length / 2);
    const a = c.featured.slice(0, half);
    const b = c.featured.slice(half);
    // дублируем ленту, чтобы прокрутка была бесконечной
    document.getElementById('track-1').innerHTML = [...a, ...a].map(card).join('');
    document.getElementById('track-2').innerHTML = [...b, ...b].map(card).join('');

    document.getElementById('codes').innerHTML = c.promo.map((p) =>
      `<div class="code-row"><b>${p.need} ${plural(p.need)}</b><span>${p.title}</span></div>`).join('');
    observe();
  });
  observe();
})();
