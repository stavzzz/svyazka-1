// Golden-тесты рендера: побайтовое соответствие шаблонам ТЗ §6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/render.js';

const DIV = '━━━━━━━━━━━━━━━━━━━━';

test('разделитель — ровно 20 символов ━', () => {
  assert.equal(R.DIV.length, 20);
  assert.equal(R.DIV, DIV);
});

test('esc экранирует & < >', () => {
  assert.equal(R.esc('<b>&x</b>'), '&lt;b&gt;&amp;x&lt;/b&gt;');
});

test('6.1 создана: полный набор с альт-зоной, участниками и двумя ссылками', () => {
  const v = {
    title: 'Тест-А', dateRu: '28 мая 2026',
    clock: '🕚', t1: '11:00', t2: '12:00', zone: 'МСК',
    alt: { clock: '🕑', t1: '14:00', t2: '15:00', zone: 'Тбилиси' },
    attendees: ['vasya@mail.com', 'petya@mail.com'],
    location: 'Офис', description: 'Обсудить план',
    links: [
      { label: 'Подключиться: Google Meet', url: 'https://meet.google.com/abc' },
      { label: 'Подключиться: Zoom', url: 'https://zoom.us/j/1' },
    ],
    htmlLink: 'https://calendar.google.com/event?eid=x',
  };
  // Группы разделены пустой строкой (правка Стаса 2026-07-22)
  assert.equal(R.rCreated(v),
    '<b>✅ Встреча добавлена в календарь!</b>\n' + DIV + '\n\n' +
    '📌 <b>Тест-А</b>\n' +
    '🗓 28 мая 2026\n' +
    '🕚 <b>11:00 – 12:00 МСК</b>\n' +
    '🕑 14:00 – 15:00 Тбилиси\n\n' +
    '👥 vasya@mail.com, petya@mail.com\n' +
    '📍 Офис\n' +
    '📝 Обсудить план\n\n' +
    '💻 <a href="https://meet.google.com/abc">Подключиться: Google Meet</a>\n' +
    '💻 <a href="https://zoom.us/j/1">Подключиться: Zoom</a>\n\n' +
    '👉 <a href="https://calendar.google.com/event?eid=x">Открыть в Google Календаре</a>');
});

test('6.1 без опциональных строк — строки не выводятся', () => {
  const v = {
    title: 'Иван', dateRu: '23 июля 2026',
    clock: '🕒', t1: '15:00', t2: '16:00', zone: 'МСК',
    alt: null, attendees: [], location: '', description: '',
    links: [], htmlLink: 'https://cal/x',
  };
  assert.equal(R.rCreated(v),
    '<b>✅ Встреча добавлена в календарь!</b>\n' + DIV + '\n\n' +
    '📌 <b>Иван</b>\n🗓 23 июля 2026\n🕒 <b>15:00 – 16:00 МСК</b>\n\n' +
    '👉 <a href="https://cal/x">Открыть в Google Календаре</a>');
});

test('6.2 расписание на день: две строки, вторая с альт-зоной', () => {
  const out = R.rDaySchedule('на сегодня', 'ПН, 13 июля 2026', [
    { clock: '🕙', t1: '10:00', t2: '11:00', zone: 'МСК', alt: null, url: 'https://l1', title: 'Планёрка' },
    { clock: '🕒', t1: '15:00', t2: '16:00', zone: 'МСК', alt: { clock: '🕔', t1: '17:00', t2: '18:00', zone: 'Тбилиси' }, url: 'https://l2', title: 'Созвон' },
  ]);
  assert.equal(out,
    '🗒 <b>Расписание на сегодня</b>\n' + DIV + '\n\n' +
    '🗓 <b>ПН, 13 июля 2026</b>\n\n' +
    '🕙 <b>10:00 – 11:00 МСК</b> • <a href="https://l1">Планёрка</a>\n' +
    '🕒 <b>15:00 – 16:00 МСК</b> 🕔 17:00 – 18:00 Тбилиси • <a href="https://l2">Созвон</a>');
});

test('6.2 пусто', () => {
  assert.equal(R.rDaySchedule('на завтра', 'ВТ, 14 июля 2026', []),
    '🗒 <b>Расписание на завтра</b>\n' + DIV + '\n\n🗓 <b>ВТ, 14 июля 2026</b>\n\n<i>Встреч нет.</i>');
});

test('6.3 неделя с группировкой по дням', () => {
  const out = R.rWeekSchedule('на 13–19 июля 2026', [
    { hdr: 'ПН, 13 июля', lines: [{ clock: '🕙', t1: '10:00', t2: '11:00', zone: 'МСК', alt: null, url: 'https://l1', title: 'Планёрка' }] },
    { hdr: 'СР, 15 июля', lines: [{ clock: '🕒', t1: '15:00', t2: '16:00', zone: 'МСК', alt: null, url: 'https://l2', title: 'Созвон' }] },
  ]);
  assert.equal(out,
    '🗒 <b>Расписание на 13–19 июля 2026</b>\n' + DIV + '\n\n' +
    '🗓 <b>ПН, 13 июля:</b>\n\n🕙 <b>10:00 – 11:00 МСК</b> • <a href="https://l1">Планёрка</a>\n\n' +
    '🗓 <b>СР, 15 июля:</b>\n\n🕒 <b>15:00 – 16:00 МСК</b> • <a href="https://l2">Созвон</a>');
});

test('6.4 конфликт + кнопки с протоколом cal:<action>:<key>', () => {
  const v = { title: 'Тест', dateRu: '13 июля 2026', clock: '🕙', t1: '10:00', t2: '11:00', zone: 'МСК', alt: null };
  const out = R.rConflict(v, [
    { title: 'Планёрка', t1: '10:30', t2: '11:30', zone: 'МСК' },
    { title: 'Ещё встреча', t1: '10:00', t2: '10:45', zone: 'МСК' },
  ]);
  assert.equal(out,
    '<b>⚠️ Конфликт времени</b>\n' + DIV + '\n\n' +
    '📌 <b>Тест</b>\n🗓 13 июля 2026\n🕙 <b>10:00 – 11:00 МСК</b>\n\n' +
    '⛔ Пересекается с:\n• <b>Планёрка</b> 10:30–11:30 МСК\n• <b>Ещё встреча</b> 10:00–10:45 МСК\n\n' +
    'Что делаем?');
  const btns = R.conflictButtons('83494179_a1B2c3D4');
  assert.deepEqual(btns, [[
    { text: '✅ Всё равно', callback_data: 'cal:add:83494179_a1B2c3D4' },
    { text: '🔁 Перенести', callback_data: 'cal:reschedule:83494179_a1B2c3D4' },
    { text: '❌ Отмена', callback_data: 'cal:cancel:83494179_a1B2c3D4' },
  ]]);
  for (const b of btns[0]) assert.ok(Buffer.byteLength(b.callback_data) <= 64);
});

test('6.9 кнопка устарела — не тишина', () => {
  assert.equal(R.rStaleButton(),
    '<b>⚠️ Кнопка устарела</b>\n' + DIV + '\n\nВстреча уже отменена или истекла. Запланируй её заново.');
});

test('6.10 таймзона переключена', () => {
  assert.equal(R.rTzSwitched('Тбилиси', 'Asia/Tbilisi', 'GMT+04:00'),
    '<b>🌍 Таймзона переключена</b>\n' + DIV + '\n\n📍 <b>Тбилиси</b> (Asia/Tbilisi, GMT+04:00)\nВсе будущие сообщения и расписания — в этой зоне.');
});

test('6.12 текущая таймзона', () => {
  assert.equal(R.rTzCurrent('МСК', 'Europe/Moscow', 'GMT+03:00', '15:42'),
    '<b>🌍 Твоя текущая таймзона</b>\n' + DIV + '\n\n📍 <b>МСК</b> (Europe/Moscow, GMT+03:00)\n🕒 Сейчас здесь <b>15:42</b>');
});

test('6.13 удалены несколько + не найдены', () => {
  const v1 = { title: 'Тест-1', dateRu: '13 июля 2026', clock: '🕙', t1: '10:00', t2: '11:00', zone: 'МСК', alt: null };
  const v2 = { title: 'Тест-2', dateRu: '13 июля 2026', clock: '🕒', t1: '15:00', t2: '16:00', zone: 'МСК', alt: null };
  assert.equal(R.rDeleted([v1, v2], ['Тест-3']),
    '<b>✅ Встречи удалены</b>\n' + DIV + '\n\n' +
    '📌 <b>Тест-1</b>\n🗓 13 июля 2026\n🕙 <b>10:00 – 11:00 МСК</b>\n\n' +
    '📌 <b>Тест-2</b>\n🗓 13 июля 2026\n🕒 <b>15:00 – 16:00 МСК</b>\n\n' +
    '📝 Не найдены: Тест-3');
});

test('6.15 не найдена', () => {
  assert.equal(R.rNotFound(['Икс']),
    '<b>❌ Встреча не найдена</b>\n' + DIV + '\n\n📌 <b>Икс</b>\n📝 В календаре нет события с таким названием.');
});

test('6.16 найдено несколько — вопрос по действию + кнопка «Удалить все»', () => {
  const items = [
    { title: 'Созвон с Петей', dayMonth: '13 июля', clock: '🕙', t1: '10:00', zone: 'МСК' },
    { title: 'Созвон с Васей', dayMonth: '14 июля', clock: '🕒', t1: '15:00', zone: 'МСК' },
  ];
  assert.equal(R.rAmbiguous(items, 'delete'),
    '<b>🔍 Найдено несколько встреч</b>\n' + DIV + '\n\n🗑 Какую удалить?\n\n' +
    '1) <b>Созвон с Петей</b> — 13 июля, 🕙 10:00 МСК\n' +
    '2) <b>Созвон с Васей</b> — 14 июля, 🕒 15:00 МСК\n\n' +
    '<i>Жми кнопку с номером или напиши цифру. Все сразу — кнопка «Удалить все».</i>');
  assert.ok(R.rAmbiguous(items, 'update').includes('🔄 Какую изменить?'));
  const btns = R.pickButtons('1_abc', 2, { withAll: true });
  assert.equal(btns.length, 3);                    // 1 кнопка = 1 ряд (правка 23.07) + «Удалить все»
  assert.ok(btns.slice(0, 2).every((r) => r.length === 1));
  assert.equal(btns[2][0].text, '🗑 Удалить все');
  assert.equal(btns[2][0].callback_data, 'cal:pick:1_abc:all');
});

test('6.18 напоминание за 5 минут', () => {
  const v = {
    title: 'Планёрка', dateRu: '13 июля 2026', clock: '🕙', t1: '10:00', t2: '11:00', zone: 'МСК',
    alt: null, location: '', links: [{ label: 'Подключиться к встрече', url: 'https://meet/x' }], htmlLink: 'https://cal/x',
  };
  assert.equal(R.rReminder(v, '5 минут'),
    '<b>🔔 Встреча через 5 минут!</b>\n' + DIV + '\n\n' +
    '📌 <b>Планёрка</b>\n🗓 13 июля 2026\n🕙 <b>10:00 – 11:00 МСК</b>\n\n' +
    '💻 <a href="https://meet/x">Подключиться к встрече</a>\n\n' +
    '👉 <a href="https://cal/x">Открыть в Google Календаре</a>');
});

test('6.19 утро пустое — особый текст', () => {
  assert.equal(R.rMorning('ПН, 13 июля 2026', []),
    '🗒 <b>Расписание на сегодня</b>\n' + DIV + '\n\n🗓 <b>ПН, 13 июля 2026</b>\n\n<i>Встреч нет. Отличный день для глубокой работы.</i>');
});

test('спецсимволы < и & в названии не ломают разметку (п.15 приёмки)', () => {
  const v = { title: 'A<B & C', dateRu: '13 июля 2026', clock: '🕙', t1: '10:00', t2: '11:00', zone: 'МСК', alt: null, attendees: [], location: '', description: '', links: [], htmlLink: '' };
  const out = R.rCreated(v);
  assert.ok(out.includes('📌 <b>A&lt;B &amp; C</b>'));
  assert.ok(!out.includes('<B '));
});

test('детерминизм: один вход → побайтово одинаковый выход ×10 (п.16 приёмки)', () => {
  const v = { title: 'Иван', dateRu: '23 июля 2026', clock: '🕒', t1: '15:00', t2: '16:00', zone: 'МСК', alt: null, attendees: [], location: '', description: '', links: [], htmlLink: 'https://x' };
  const first = R.rCreated(v);
  for (let i = 0; i < 10; i++) assert.equal(R.rCreated(v), first);
});
