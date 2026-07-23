// Тесты команд меню: все отрабатывают ЧИСТЫМ кодом.
// Классификатор-бомба кидает исключение при любом вызове — доказательство «ноль токенов».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { createRouter } from '../src/router.js';
import { freeSlots, fmtDur } from '../src/slots.js';
import { makeDeps, msg, cb, rawEvent, NOW } from './helpers.js';

function bombDeps(opts = {}) {
  const deps = makeDeps(opts);
  deps.classifier = {
    async classify() { throw new Error('КЛАССИФИКАТОР ВЫЗВАН — команда сожгла токены!'); },
    async freeAnswer() { throw new Error('freeAnswer вызван!'); },
  };
  return deps;
}

// ── slots.js юниты ──────────────────────────────────────────────
test('freeSlots: вычитание, слияние пересечений, фильтр <30 мин', () => {
  const H = 3600_000;
  // окно 0..12ч, занято 2-3 и 2.5-4 (сливаются), 11.8-12 (хвост <30мин отсекает конец)
  const busy = [
    { startMs: 2 * H, endMs: 3 * H },
    { startMs: 2.5 * H, endMs: 4 * H },
    { startMs: 11.8 * H, endMs: 12 * H },
  ];
  const slots = freeSlots(busy, 0, 12 * H);
  assert.deepEqual(slots, [
    { startMs: 0, endMs: 2 * H },
    { startMs: 4 * H, endMs: 11.8 * H },
  ]);
  assert.deepEqual(freeSlots([], 5 * H, 5 * H), []); // from==to
});

test('fmtDur', () => {
  assert.equal(fmtDur(90 * 60_000), '1 ч 30 мин');
  assert.equal(fmtDur(120 * 60_000), '2 ч');
  assert.equal(fmtDur(45 * 60_000), '45 мин');
});

// ── команды ─────────────────────────────────────────────────────
test('/today работает без классификатора', async () => {
  const ev = rawEvent('t1', 'Планёрка', '2026-07-22T14:00:00', '2026-07-22T15:00:00');
  const deps = bombDeps({ gcalOpts: { events: [ev] } });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('/today'));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('🗒 <b>Расписание на сегодня</b>'));
  assert.ok(out.includes('Планёрка'));
});

test('/tomorrow, /week, /tz — код, без модели', async () => {
  const deps = bombDeps({});
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('/tomorrow'));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('🗒 <b>Расписание на завтра</b>'));
  await router.handleUpdate(msg('/week'));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('🗒 <b>Расписание на 20–26 июля 2026</b>'));
  await router.handleUpdate(msg('/tz'));
  assert.ok(deps.tg.sent.at(-1).html.includes('Твоя текущая таймзона'));
});

test('/free: рабочее окно 09–21, от «сейчас» (12:00), занято 15–16', async () => {
  const ev = rawEvent('b1', 'Созвон', '2026-07-22T15:00:00', '2026-07-22T16:00:00');
  const deps = bombDeps({ gcalOpts: { events: [ev] } });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('/free'));
  const out = deps.tg.sent.at(-1).html;
  assert.equal(out,
    '🗒 <b>Свободные окна на сегодня</b>\n━━━━━━━━━━━━━━━━━━━━\n\n' +
    '🗓 <b>СР, 22 июля 2026</b>\n\n' +
    '🕛 <b>12:00 – 15:00</b> · 3 ч\n' +
    '🕓 <b>16:00 – 21:00</b> · 5 ч' +
    '\n\n<i>Занять окно: /add или просто скажи голосом.</i>');
});

test('/free_week: окна по дням с сегодня до воскресенья, прошедшие дни скрыты', async () => {
  // сейчас СР 22.07 12:00; занято: СР 15–16, ЧТ весь рабочий день
  const wed = rawEvent('w1', 'Созвон', '2026-07-22T15:00:00', '2026-07-22T16:00:00');
  const thu = rawEvent('w2', 'Марафон', '2026-07-23T08:00:00', '2026-07-23T22:00:00');
  const deps = bombDeps({ gcalOpts: { events: [wed, thu] } });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('/free_week'));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('🗒 <b>Свободные окна на этой неделе (20–26 июля 2026)</b>'));
  assert.ok(!out.includes('ПН, 20 июля'));         // прошедший день скрыт
  assert.ok(out.includes('🗓 <b>СР, 22 июля:</b>'));
  assert.ok(out.includes('🕛 <b>12:00 – 15:00</b> · 3 ч'));
  assert.ok(!out.includes('ЧТ, 23 июля'));          // день занят целиком — не показываем
  assert.ok(out.includes('🗓 <b>ПТ, 24 июля:</b>'));
  assert.ok(out.includes('🕘 <b>09:00 – 21:00</b> · 12 ч'));
  assert.ok(out.includes('🗓 <b>ВС, 26 июля:</b>'));
});

test('/free_next: следующая неделя целиком, все дни свободны', async () => {
  const deps = bombDeps({});
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('/free_next'));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('🗒 <b>Свободные окна на следующей неделе (27 июля – 2 августа 2026)</b>'));
  assert.ok(out.includes('🗓 <b>ПН, 27 июля:</b>'));
  assert.ok(out.includes('🗓 <b>ВС, 2 августа:</b>'));
  assert.equal((out.match(/🗓 <b>/g) || []).length, 7); // все 7 дней
});

test('/free: день занят целиком → «не осталось»', async () => {
  const ev = rawEvent('b2', 'Марафон', '2026-07-22T08:00:00', '2026-07-22T22:00:00');
  const deps = bombDeps({ gcalOpts: { events: [ev] } });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('/free'));
  assert.ok(deps.tg.sent.at(-1).html.includes('<i>Свободных окон не осталось.</i>'));
});

test('/next: ближайшая из двух будущих + карточка со ссылками', async () => {
  const near = rawEvent('n1', 'Скоро', '2026-07-22T13:00:00', '2026-07-22T14:00:00', { description: 'Zoom: https://zoom.us/j/9' });
  const far = rawEvent('n2', 'Потом', '2026-07-25T10:00:00', '2026-07-25T11:00:00');
  const deps = bombDeps({ gcalOpts: { events: [far, near] } });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('/next'));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('<b>⏭ Ближайшая встреча</b>'));
  assert.ok(out.includes('📌 <b>Скоро</b>'));
  assert.ok(out.includes('13:00 – 14:00'));
  assert.ok(out.includes('zoom.us/j/9'));
});

test('/next: встреч нет', async () => {
  const deps = bombDeps({});
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('/next'));
  assert.ok(deps.tg.sent.at(-1).html.includes('<i>Впереди встреч нет'));
});

test('/add: forceReply-приглашение без модели; ответ уходит в обычный пайплайн', async () => {
  const deps = bombDeps({});
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('/add'));
  const ask = deps.tg.sent.at(-1);
  assert.ok(ask.html.startsWith('<b>➕ Новая встреча</b>'));
  assert.equal(ask.opts.forceReply, true);
});

test('/new: сбрасывает зависшее ожидание, старая кнопка протухает', async () => {
  const { createRouter: cr } = await import('../src/router.js');
  const { cb, rawEvent: re } = await import('./helpers.js');
  const busy = re('busy1', 'Планёрка', '2026-07-23T15:30:00', '2026-07-23T16:30:00');
  const deps = makeDeps({
    classifierMap: {
      'встреча': { intent: 'create', title: 'Иван', date: '2026-07-23', time_start: '15:00', time_end: '', duration_min: '60', attendees: [], location: '', description: '', city: '' },
    },
    gcalOpts: { events: [busy] },
  });
  const router = cr(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('встреча с Иваном завтра в 15:00'));
  const btn = deps.tg.sent.at(-1).opts.buttons[0][0].callback_data;

  await router.handleUpdate(msg('/new'));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>🧹 Сброшено</b>'));

  await router.handleUpdate(cb(btn)); // кнопка от сброшенного pending
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>⚠️ Кнопка устарела</b>'));
});

test('/new без ожиданий — «чистый лист», без модели', async () => {
  const deps = bombDeps({});
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('/new'));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>🧹 Чистый лист</b>'));
});

test('неизвестная /команда гасится кодом, в модель не проваливается', async () => {
  const deps = bombDeps({});
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('/goal что-то движковое'));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>🤷 Не знаю такую команду</b>'));
  await router.handleUpdate(msg('/approve'));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>🤷 Не знаю такую команду</b>'));
});

test('конфликт: в карточке предлагаются свободные окна дня, куда влезает встреча', async () => {
  const busy = rawEvent('busy1', 'Планёрка', '2026-07-23T15:30:00', '2026-07-23T16:30:00');
  const deps = makeDeps({
    classifierMap: { 'встреча': { intent: 'create', title: 'Иван', date: '2026-07-23', time_start: '15:00', time_end: '', duration_min: '60', attendees: [], location: '', description: '', city: '' } },
    gcalOpts: { events: [busy] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('встреча с Иваном завтра в 15:00'));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.includes('⛔ Пересекается с:'));
  assert.ok(out.includes('🟢 Свободно в этот день:'));
  assert.ok(out.includes('🕘 <b>09:00 – 15:30</b> · 6 ч 30 мин'));
  assert.ok(out.includes('🕓 <b>16:30 – 21:00</b> · 4 ч 30 мин'));
  assert.ok(out.endsWith('Что делаем?'));
});

test('контекст не теряется: «на 25:00» → не понял, следующее «на 23:30 МСК» без reply → создаётся', async () => {
  const busy = rawEvent('busy1', 'Планёрка', '2026-07-23T15:30:00', '2026-07-23T16:30:00');
  const deps = makeDeps({
    classifierMap: { 'встреча': { intent: 'create', title: 'Иван', date: '2026-07-23', time_start: '15:00', time_end: '', duration_min: '60', attendees: [], location: '', description: '', city: '' } },
    gcalOpts: { events: [busy] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('встреча с Иваном завтра в 15:00'));
  const resched = deps.tg.sent.at(-1).opts.buttons[0][1].callback_data;
  await router.handleUpdate(cb(resched));
  const ask = deps.tg.sent.at(-1);

  // «на 25:00 МСК» reply'ем — время невалидное → 6.8, ожидание живо
  await router.handleUpdate(msg('на 25:00 МСК', { reply_to_message: { message_id: ask.message_id, text: ask.html } }));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>⚠️ Не понял время</b>'));

  // «на 23:30 МСК» БЕЗ reply — раньше улетало в модель, теперь это ответ
  await router.handleUpdate(msg('на 23:30 МСК'));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('<b>✅ Встреча добавлена в календарь!</b>'));
  assert.ok(out.includes('23:30'));
});

test('/start и /help — детерминированное приветствие кодом', async () => {
  const deps = bombDeps({});
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('/start'));
  const s = deps.tg.sent.at(-1).html;
  assert.ok(s.startsWith('<b>👋 Привет! Я — твой ИИ-секретарь</b>\n━━━━━━━━━━━━━━━━━━━━'));
  await router.handleUpdate(msg('/help'));
  assert.equal(deps.tg.sent.at(-1).html, s); // /help = тот же байтовый текст
});

// ── Правка Стаса 24.07: /next_week в меню, чистый код без модели ──
test('/next_week: расписание следующей недели без классификатора', async () => {
  const ev = rawEvent('nw1', 'Планёрка', '2026-07-27T10:00:00', '2026-07-27T11:00:00');
  const deps = makeDeps({ gcalOpts: { events: [ev] } });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('/next_week'));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('🗒 <b>Расписание на следующую неделю'));
  assert.ok(out.includes('ПН, 27 июля'));
  assert.ok(out.includes('Планёрка'));
});
