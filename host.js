// Утренние события: управляющая парком сообщает о ситуации и предлагает варианты решений.
// Сейчас работают по сценарию; чтобы подключить своего ИИ-ассистента, замените nextTurn — например, на fetch к вашему боту.
//
// nextTurn(request) → Promise<turn>
//   request: { day, state: { coins, mood, buildings: [id объекта на карте...], guests_yesterday, heroes },
//              last_choice: { title, coins, guests, mood } | null, history: [{ day, event, choice }] }
//   turn: { consequence, event_title, situation, speaker, options: [{ title, description, coins, guests, mood }] }
//   speaker — id сотрудника из catalog.json (heroes).
//   Эффекты действуют на один день: coins — сразу, guests — сколько гостей сверх обычного придёт
//   (может быть отрицательным), mood — бонус к настроению гостей. Игра ограничивает значения (game.js, LIMITS).
window.SkazkaHost = (() => {
  const EVENTS = [
    { title: 'Наплыв школьников', speaker: 'timosha',
      text: 'К входу подъехали три автобуса со школьными группами. Очередь на кассах растёт.',
      options: [
        { title: 'Открыть дополнительную кассу', description: 'Вывести второго кассира на время наплыва.', coins: -150, guests: 20, mood: 5 },
        { title: 'Организовать экскурсию', description: 'Провести группы по парку с сопровождающим.', coins: -80, guests: 12, mood: 10 },
        { title: 'Работать в обычном режиме', description: 'Гости подождут в очереди.', coins: 0, guests: 6, mood: -12 },
      ] },
    { title: 'Сбой терминала оплаты', speaker: 'timosha', needs: 50,
      text: 'В Стране ЕНОТиЯ перестал работать терминал: посетители не могут оплатить вход картой.',
      options: [
        { title: 'Поставить временную кассу', description: 'Принимать оплату на соседней точке.', coins: -100, guests: 10, mood: 5 },
        { title: 'Срочный ремонт', description: 'Вызвать техника из сервисной компании.', coins: -200, guests: 0, mood: 2 },
        { title: 'Закрыть зону до вечера', description: 'Без затрат, но часть гостей уйдёт.', coins: 0, guests: -8, mood: -8 },
      ] },
    { title: 'Дождь с утра', speaker: 'feya',
      text: 'Прогноз обещает дождь до обеда. Уличные аттракционы будут пустовать.',
      options: [
        { title: 'Раздать дождевики', description: 'Фирменные дождевики на входе.', coins: -180, guests: 5, mood: 12 },
        { title: 'Скидка в кафе', description: 'Скидка на горячие напитки до конца дождя.', coins: -100, guests: 0, mood: 10 },
        { title: 'Без дополнительных мер', description: 'Не тратить бюджет на погоду.', coins: 0, guests: -12, mood: -10 },
      ] },
    { title: 'Альпаке нужен ветеринар', speaker: 'pako', needs: 49,
      text: 'У одной из альпак признаки простуды. Посетители спрашивают, почему её нет в вольере.',
      options: [
        { title: 'Вызвать ветеринара', description: 'Осмотр и лечение сегодня же.', coins: -250, guests: 0, mood: 8 },
        { title: 'Утеплить вольер', description: 'Утеплить вольер и поставить информационную табличку.', coins: -150, guests: 5, mood: 12 },
        { title: 'Наблюдать', description: 'Ничего не предпринимать сегодня.', coins: 0, guests: -10, mood: -15 },
      ] },
    { title: 'Собакам нужен выгул', speaker: 'buran', needs: 53,
      text: 'В Хаски Лэнде не хватает персонала: собак сегодня не успевают выгуливать.',
      options: [
        { title: 'Прогулка с гостями', description: 'Платная прогулка с хаски для посетителей.', coins: -60, guests: 12, mood: 12 },
        { title: 'Нанять сотрудника', description: 'Временный кинолог на смену.', coins: -200, guests: 3, mood: 6 },
        { title: 'Перенести прогулку', description: 'Выгулять собак вечером.', coins: 0, guests: -6, mood: -10 },
      ] },
    { title: 'Визит блогера', speaker: 'feya',
      text: 'Парк посетил популярный блогер и планирует снять обзор.',
      options: [
        { title: 'Экскурсия без очередей', description: 'Показать главные аттракционы.', coins: -150, guests: 25, mood: 4 },
        { title: 'Интервью с сотрудниками', description: 'Рассказать, как устроен парк.', coins: -80, guests: 18, mood: 8 },
        { title: 'Без особого внимания', description: 'Блогер осмотрит парк самостоятельно.', coins: 0, guests: 5, mood: 0 },
      ] },
    { title: 'Санитарная проверка', speaker: 'yaga',
      text: 'Сегодня плановая проверка чистоты. Её результаты повлияют на репутацию парка.',
      options: [
        { title: 'Генеральная уборка', description: 'Весь персонал на уборку территории.', coins: -200, guests: 2, mood: 10 },
        { title: 'Обычная уборка', description: 'Усилить уборку только на главных аллеях.', coins: -60, guests: 0, mood: 4 },
        { title: 'Без подготовки', description: 'Работать в обычном режиме.', coins: 0, guests: -12, mood: -8 },
      ] },
    { title: 'Неисправность в Дино парке', speaker: 'rex', needs: 57,
      text: 'У аниматронного динозавра неисправна звуковая система: звук слишком громкий.',
      options: [
        { title: 'Ремонт', description: 'Вызвать инженера по аниматронике.', coins: -180, guests: 0, mood: 10 },
        { title: 'Отключить звук', description: 'Работать без звука до ремонта.', coins: -30, guests: -3, mood: -2 },
        { title: 'Оставить как есть', description: 'Часть посетителей останется недовольна.', coins: 0, guests: -8, mood: -5 },
      ] },
    { title: 'Корпоративный заказ', speaker: 'feya',
      text: 'Компания хочет провести в парке праздник для сотрудников и их семей.',
      options: [
        { title: 'Праздник под ключ', description: 'Аниматоры, сцена и питание.', coins: 400, guests: 15, mood: -4 },
        { title: 'Аренда площадки', description: 'Остальное компания организует сама.', coins: 200, guests: 8, mood: 0 },
        { title: 'Отказать', description: 'Парк остаётся открытым для всех посетителей.', coins: 0, guests: 0, mood: 5 },
      ] },
    { title: 'Солнечные выходные', speaker: 'feya',
      text: 'Тёплая погода: ожидается много семей с детьми.',
      options: [
        { title: 'Семейный фестиваль', description: 'Музыка, конкурсы и аквагрим.', coins: -250, guests: 30, mood: 12 },
        { title: 'Летние кафе', description: 'Открыть дополнительные точки питания.', coins: -120, guests: 10, mood: 10 },
        { title: 'Работать как обычно', description: 'Без дополнительных расходов.', coins: 0, guests: 12, mood: -6 },
      ] },
  ];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  function consequence(c) {
    if (!c) return 'Сводка на начало дня.';
    if (c.mood < 0) return `Вчерашнее решение «${c.title}» сэкономило бюджет, но снизило удовлетворённость гостей.`;
    return `Вчерашнее решение «${c.title}» гости оценили положительно.`;
  }

  async function nextTurn({ state, last_choice, history }) {
    await new Promise((r) => setTimeout(r, 400));
    const used = new Set(history.map((h) => h.event));
    const fits = EVENTS.filter((e) => !used.has(e.title) && (!e.needs || state.buildings.includes(e.needs)));
    const ev = pick(fits.length ? fits : EVENTS);
    return { consequence: consequence(last_choice), event_title: ev.title, situation: ev.text, speaker: ev.speaker, options: ev.options };
  }

  return { nextTurn };
})();
