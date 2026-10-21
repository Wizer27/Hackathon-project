// Ведущий игры. Сейчас работает по сценарию; чтобы подключить своего ИИ-ассистента,
// замените nextTurn — например, на fetch к вашему боту. Формат ответа описан ниже.
//
// nextTurn(request) → Promise<turn>
//   request: { day, days_total, final, state: { coins, guests, mood, buildings, heroes },
//              last_choice: { title, description, coins, guests, mood, build } | null,
//              history: [{ day, event, choice }] }
//   turn: { consequence, event_title, situation, speaker,
//           options: [{ title, description, coins, guests, mood, build }] }
//   speaker — id героя из catalog.json, build — id постройки или "none".
//   Эффекты ответа всё равно проверяются в play.js (sanitizeTurn).
window.SkazkaHost = (() => {
  const EVENTS = [
    { title: 'Наплыв школьников', speaker: 'feya',
      text: 'К воротам подъехали три автобуса со школьниками. Очередь на кассы растёт, а дети уже поглядывают на аттракционы.',
      options: [
        { title: 'Открыть доп. кассу', description: 'Поставить ещё одного кассира и пустить всех быстрее.', coins: -150, guests: 40, mood: 5 },
        { title: 'Экскурсия с Феей', description: 'Провести группу по парку с рассказом о героях.', coins: -80, guests: 25, mood: 10 },
        { title: 'Пусть ждут', description: 'Ничего не менять — очередь сама рассосётся.', coins: 120, guests: 10, mood: -12 },
      ] },
    { title: 'Еноты устроили переполох', speaker: 'timosha', needs: 'enotia',
      text: 'Енот Тимоша стащил ключи от кассы и спрятал их где-то в Стране ЕНОТиЯ. Гости смеются, но касса закрыта!',
      options: [
        { title: 'Квест «Найди ключи»', description: 'Превратить поиски в игру для детей с призами.', coins: -100, guests: 30, mood: 15 },
        { title: 'Вызвать слесаря', description: 'Быстро вскрыть кассу и работать дальше.', coins: -200, guests: 0, mood: 2 },
        { title: 'Закрыть зону енотов', description: 'Отправить енотов отдыхать до вечера.', coins: 0, guests: -15, mood: -8 },
      ] },
    { title: 'Дождливое утро', speaker: 'feya',
      text: 'С утра льёт дождь. Гости прячутся под навесами, а уличные аттракционы пустуют.',
      options: [
        { title: 'Раздать дождевики', description: 'Яркие дождевики «Сказки» каждому гостю.', coins: -180, guests: 10, mood: 12 },
        { title: 'Горячие блины', description: 'Скидка в кафе на горячее до конца дождя.', coins: -100, guests: 0, mood: 10 },
        { title: 'Переждать', description: 'Сэкономить и надеяться, что дождь скоро кончится.', coins: 50, guests: -25, mood: -10 },
      ] },
    { title: 'Альпака простудилась', speaker: 'pako', needs: 'alpaka',
      text: 'Одна из альпак чихает и грустит. Смотрители волнуются, а гости спрашивают, почему её не видно.',
      options: [
        { title: 'Вызвать ветеринара', description: 'Лучший ветеринар Москвы приедет через час.', coins: -250, guests: 0, mood: 8 },
        { title: 'Тёплый вольер', description: 'Утеплить вольер и рассказать гостям, как заботятся о животных.', coins: -150, guests: 10, mood: 12 },
        { title: 'Само пройдёт', description: 'Ничего не делать и подождать.', coins: 0, guests: -20, mood: -15 },
      ] },
    { title: 'Хаски заскучали', speaker: 'buran', needs: 'husky',
      text: 'Хаски Буран воет на весь парк: собакам нужна прогулка, а смотрителей не хватает.',
      options: [
        { title: 'Прогулка с гостями', description: 'Пригласить гостей погулять с хаски по парку.', coins: -60, guests: 30, mood: 12 },
        { title: 'Нанять смотрителя', description: 'Ещё один человек, который будет гулять с собаками.', coins: -200, guests: 5, mood: 6 },
        { title: 'Потерпят', description: 'Отложить прогулку до вечера.', coins: 0, guests: -10, mood: -10 },
      ] },
    { title: 'Блогер в парке', speaker: 'feya',
      text: 'В «Сказку» пришёл популярный блогер с миллионом подписчиков. Он ищет, что бы такого снять.',
      options: [
        { title: 'VIP-экскурсия', description: 'Показать лучшие аттракционы без очереди.', coins: -150, guests: 60, mood: 4 },
        { title: 'Знакомство с героями', description: 'Устроить съёмку с жителями парка.', coins: -80, guests: 45, mood: 8 },
        { title: 'Как обычный гость', description: 'Пусть сам всё найдёт.', coins: 0, guests: 10, mood: 0 },
      ] },
    { title: 'Проверка Бабы Яги', speaker: 'yaga',
      text: 'Баба Яга объявила, что проверит чистоту парка. Если найдёт мусор — расскажет всем соседям!',
      options: [
        { title: 'Генеральная уборка', description: 'Вывести всех сотрудников на уборку.', coins: -200, guests: 5, mood: 10 },
        { title: 'Угостить чаем', description: 'Пригласить Бабу Ягу в блинную и задобрить.', coins: -60, guests: 0, mood: 4 },
        { title: 'Не обращать внимания', description: 'Авось обойдётся.', coins: 0, guests: -30, mood: -8 },
      ] },
    { title: 'Динозавр рычит слишком громко', speaker: 'rex', needs: 'dino',
      text: 'Дино Рекс сломался и рычит без остановки. Малыши пугаются, зато подростки в восторге.',
      options: [
        { title: 'Починить звук', description: 'Вызвать мастера и сделать рык тише.', coins: -180, guests: 0, mood: 10 },
        { title: '«Рык-шоу» для смелых', description: 'Объявить аттракцион для самых храбрых.', coins: -50, guests: 35, mood: -2 },
        { title: 'Выключить Рекса', description: 'Пусть динозавр поспит.', coins: 0, guests: -20, mood: -5 },
      ] },
    { title: 'Корпоратив на Белой площади', speaker: 'feya',
      text: 'Крупная компания хочет провести в парке праздник для сотрудников и их детей.',
      options: [
        { title: 'Праздник под ключ', description: 'Аниматоры, сцена и угощения.', coins: 350, guests: 40, mood: -4 },
        { title: 'Только площадка', description: 'Сдать площадку, остальное сделают сами.', coins: 200, guests: 20, mood: 0 },
        { title: 'Отказать', description: 'Парк для всех, а не для одной компании.', coins: 0, guests: 0, mood: 5 },
      ] },
    { title: 'Очередь на «Смерч»', speaker: 'feya', needs: 'smerch',
      text: 'Очередь на «Смерч» растянулась на полпарка. Подростки готовы ждать, но родители нервничают.',
      options: [
        { title: 'Электронная очередь', description: 'Билет со временем катания в телефоне.', coins: -250, guests: 20, mood: 14 },
        { title: 'Аниматоры в очереди', description: 'Развлекать гостей, пока они ждут.', coins: -100, guests: 0, mood: 8 },
        { title: 'Поднять цену', description: 'Меньше желающих — короче очередь.', coins: 250, guests: -25, mood: -10 },
      ] },
    { title: 'Солнечные выходные', speaker: 'feya',
      text: 'Тепло и солнечно — в парк идут семьи со всей Москвы. Главное — всех принять.',
      options: [
        { title: 'Семейный фестиваль', description: 'Музыка, конкурсы и аквагрим весь день.', coins: -250, guests: 70, mood: 12 },
        { title: 'Больше кафе', description: 'Открыть летние точки с мороженым.', coins: -120, guests: 20, mood: 10 },
        { title: 'Работать как обычно', description: 'Гостей и так много.', coins: 100, guests: 30, mood: -6 },
      ] },
  ];

  const REACTIONS = [
    (c) => `«${c.title}» — отличная мысль! Гости обсуждают это весь вечер.`,
    (c) => `Вы выбрали «${c.title}». В парке только об этом и говорят.`,
    (c) => `Решение «${c.title}» принято, и парк зажил по-новому.`,
  ];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  function consequence(c) {
    if (!c) return 'Добро пожаловать в «Сказку»! Я Фея Сказки и буду помогать вам все пять дней.';
    if (c.build && c.build !== 'none') return `«${c.title.replace('Построить: ', '')}» открыт! Гости уже выстроились у входа.`;
    if (c.mood < 0) return `Вы выбрали «${c.title}». Монеты сэкономили, но гости немного расстроились.`;
    return pick(REACTIONS)(c);
  }

  async function nextTurn({ final, state, last_choice, history }) {
    await new Promise((r) => setTimeout(r, 600)); // ведущая «думает»
    if (final) {
      return {
        consequence: consequence(last_choice),
        event_title: 'Пять дней позади',
        situation: `Теперь в вашем парке ${state.buildings.length} построек и ${state.guests} гостей в день. Хотите увидеть их вживую? Приезжайте в настоящую «Сказку» в Крылатском — герои ждут вас!`,
        speaker: 'feya',
        options: [],
      };
    }
    const used = new Set(history.map((h) => h.event));
    const fits = EVENTS.filter((e) => !used.has(e.title) && (!e.needs || state.buildings.includes(e.needs)));
    const ev = pick(fits.length ? fits : EVENTS);
    const options = ev.options.slice(0, 2).map((o) => ({ ...o, build: 'none' }));
    const free = window.SkazkaCatalog.buildings
      .filter((b) => !state.buildings.includes(b.id) && b.cost <= state.coins);
    if (free.length) {
      const b = pick(free);
      options.push({ title: `Построить: ${b.name}`, description: b.text, coins: -b.cost, guests: b.guests, mood: b.mood, build: b.id });
    } else {
      options.push({ ...ev.options[2], build: 'none' });
    }
    return { consequence: consequence(last_choice), event_title: ev.title, situation: ev.text, speaker: ev.speaker, options };
  }

  return { nextTurn };
})();
