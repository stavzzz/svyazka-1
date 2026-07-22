// Интеграционные тесты router: сценарии чек-листа приёмки (ТЗ §14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router.js';
import { makeDeps, msg, cb, rawEvent, NOW, OWNER } from './helpers.js';

const CREATE_IVAN = {
  intent: 'create', title: 'Иван', date: '2026-07-23', time_start: '15:00',
  time_end: '', duration_min: '60', attendees: ['petya@mail.ru'], location: '', description: '', city: 'Москва',
};

test('п.1: создание с временем → карточка 6.1, событие в Google, Meet+Zoom', async () => {
  const deps = makeDeps({ classifierMap: { 'встреча с Иваном': CREATE_IVAN } });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('встреча с Иваном завтра в 15:00 по Москве'));

  assert.equal(deps.gcal.calls.filter((c) => c[0] === 'create').length, 1);
  assert.equal(deps.zoom.calls.length, 1);
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('<b>✅ Встреча добавлена в календарь!</b>\n━━━━━━━━━━━━━━━━━━━━\n\n📌 <b>Иван</b>'));
  assert.ok(out.includes('🕒 <b>15:00 – 16:00 МСК</b>'));
  assert.ok(out.includes('👥 petya@mail.ru'));
  assert.ok(out.includes('Подключиться: Google Meet'));
  assert.ok(out.includes('Подключиться: Zoom'));
  assert.ok(out.includes('Открыть в Google Календаре'));
});

test('п.16: одна фраза ×10 → побайтово одинаковый ответ', async () => {
  let first = null;
  for (let i = 0; i < 10; i++) {
    const deps = makeDeps({ classifierMap: { 'встреча с Иваном': CREATE_IVAN } });
    const router = createRouter(deps);
    await router.refreshCache();
    await router.handleUpdate(msg('встреча с Иваном завтра в 15:00 по Москве'));
    const out = deps.tg.sent.at(-1).html;
    if (first === null) first = out;
    else assert.equal(out, first);
  }
});

test('п.2: создание без времени → forceReply 6.5; ответ временем → создаётся', async () => {
  const deps = makeDeps({
    classifierMap: { 'встреча с Иваном': { ...CREATE_IVAN, time_start: '' } },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('встреча с Иваном завтра'));

  const ask = deps.tg.sent.at(-1);
  assert.ok(ask.html.startsWith('<b>🕒 На какое время поставить встречу?</b>'));
  assert.equal(ask.opts.forceReply, true);

  await router.handleUpdate(msg('в 14:00', { reply_to_message: { message_id: ask.message_id, text: ask.html } }));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('<b>✅ Встреча добавлена в календарь!</b>'));
  assert.ok(out.includes('14:00 – 15:00'));
});

test('п.3+4: конфликт → 6.4 с 3 кнопками; «Всё равно» → создаётся; «Отмена» → 6.7', async () => {
  const busy = rawEvent('busy1', 'Планёрка', '2026-07-23T15:30:00', '2026-07-23T16:30:00');
  const deps = makeDeps({
    classifierMap: { 'встреча с Иваном': CREATE_IVAN },
    gcalOpts: { events: [busy] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('встреча с Иваном завтра в 15:00'));

  const conflictMsg = deps.tg.sent.at(-1);
  assert.ok(conflictMsg.html.startsWith('<b>⚠️ Конфликт времени</b>'));
  assert.ok(conflictMsg.html.includes('• <b>Планёрка</b> 15:30–16:30 МСК'));
  const buttons = conflictMsg.opts.buttons[0];
  assert.equal(buttons.length, 3);
  const addData = buttons[0].callback_data;
  assert.match(addData, /^cal:add:\d+_[A-Za-z0-9_-]{8}$/);

  // «Всё равно»
  await router.handleUpdate(cb(addData));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>✅ Встреча добавлена в календарь!</b>'));

  // Снова конфликт → «Отмена»
  await router.handleUpdate(msg('встреча с Иваном завтра в 15:00'));
  const c2 = deps.tg.sent.at(-1);
  const cancelData = c2.opts.buttons[0][2].callback_data;
  await router.handleUpdate(cb(cancelData));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('<b>❌ Встреча не добавлена</b>'));
  assert.ok(out.includes('📌 <b>Иван</b>'));
});

test('п.4: «Перенести» → 6.6 forceReply; новое время → создаётся без конфликта', async () => {
  const busy = rawEvent('busy1', 'Планёрка', '2026-07-23T15:30:00', '2026-07-23T16:30:00');
  const deps = makeDeps({
    classifierMap: { 'встреча с Иваном': CREATE_IVAN },
    gcalOpts: { events: [busy] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('встреча с Иваном завтра в 15:00'));
  const resched = deps.tg.sent.at(-1).opts.buttons[0][1].callback_data;

  await router.handleUpdate(cb(resched));
  const ask = deps.tg.sent.at(-1);
  assert.equal(ask.html,
    '<b>🕒 На какое время перенести?</b>\n\nНапиши новое время в ответе на это сообщение, например «на 14 МСК» или «в 15:30».' +
    '\n\n<i>⏱ Время без города — в твоей зоне: МСК. Хочешь другую — назови город: «на 20 по Москве».</i>');
  assert.equal(ask.opts.forceReply, true);

  await router.handleUpdate(msg('в 18:00', { reply_to_message: { message_id: ask.message_id, text: ask.html } }));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('<b>✅ Встреча добавлена в календарь!</b>'));
  assert.ok(out.includes('18:00 – 19:00'));
});

test('жизненный цикл кнопок: после нажатия карточка перерисовывается без кнопок, со статусом', async () => {
  const busy = rawEvent('busy1', 'Планёрка', '2026-07-23T15:30:00', '2026-07-23T16:30:00');
  const deps = makeDeps({
    classifierMap: { 'встреча с Иваном': CREATE_IVAN },
    gcalOpts: { events: [busy] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('встреча с Иваном завтра в 15:00'));
  const conflictMsg = deps.tg.sent.at(-1);

  await router.handleUpdate(cb(conflictMsg.opts.buttons[0][2].callback_data)); // ❌ Отмена
  const edit = deps.tg.edits.at(-1);
  assert.equal(edit.messageId, conflictMsg.message_id);
  assert.ok(edit.html.startsWith('<b>⚠️ Конфликт времени</b>'));
  assert.ok(edit.html.endsWith('➡️ ❌ Отмена'));
  assert.ok(!edit.opts.buttons); // кнопки сняты
});

test('п.5: протухшая кнопка → 6.9, не тишина', async () => {
  const deps = makeDeps({});
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(cb('cal:add:111111111_deadbeef'));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>⚠️ Кнопка устарела</b>'));
});

test('п.6: «что сегодня» → 6.2; «на этой неделе» → 6.3', async () => {
  const today = rawEvent('t1', 'Планёрка', '2026-07-22T10:00:00', '2026-07-22T11:00:00');
  const deps = makeDeps({
    classifierMap: {
      'что у меня сегодня': { intent: 'today' },
      'на этой неделе': { intent: 'week' },
    },
    gcalOpts: { events: [today] },
  });
  const router = createRouter(deps);
  await router.refreshCache();

  await router.handleUpdate(msg('что у меня сегодня'));
  const day = deps.tg.sent.at(-1).html;
  assert.ok(day.startsWith('🗒 <b>Расписание на сегодня</b>'));
  assert.ok(day.includes('🗓 <b>СР, 22 июля 2026</b>'));
  assert.ok(day.includes('🕙 <b>10:00 – 11:00 МСК</b> • <a href="https://cal/t1">Планёрка</a>'));

  await router.handleUpdate(msg('на этой неделе'));
  const week = deps.tg.sent.at(-1).html;
  assert.ok(week.startsWith('🗒 <b>Расписание на 20–26 июля 2026</b>'));
  assert.ok(week.includes('🗓 <b>СР, 22 июля:</b>'));
});

test('п.7: встреча в чужой зоне → две строки времени', async () => {
  const tbilisi = rawEvent('z1', 'Созвон', '2026-07-22T17:00:00', '2026-07-22T18:00:00', { tz: 'Asia/Tbilisi' });
  const deps = makeDeps({
    classifierMap: { 'что у меня сегодня': { intent: 'today' } },
    gcalOpts: { events: [tbilisi] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('что у меня сегодня'));
  const out = deps.tg.sent.at(-1).html;
  // 17:00 Тбилиси = 16:00 МСК
  assert.ok(out.includes('<b>16:00 – 17:00 МСК</b> 🕔 17:00 – 18:00 Тбилиси'));
});

test('п.8+9: переключение зоны → 6.10 и расписание в новой зоне; «какая зона» → 6.12', async () => {
  const deps = makeDeps({
    classifierMap: {
      'переключи': { intent: 'set_timezone', city: 'Тбилиси' },
      'какая у меня': { intent: 'get_timezone' },
    },
  });
  const router = createRouter(deps);
  await router.refreshCache();

  await router.handleUpdate(msg('переключи зону на Тбилиси'));
  const sw = deps.tg.sent.at(-1).html;
  assert.equal(sw, '<b>🌍 Таймзона переключена</b>\n━━━━━━━━━━━━━━━━━━━━\n\n📍 <b>Тбилиси</b> (Asia/Tbilisi, GMT+04:00)\nВсе будущие сообщения и расписания — в этой зоне.');
  assert.equal(deps.gcal.tz, 'Asia/Tbilisi');

  await router.handleUpdate(msg('какая у меня зона'));
  const cur = deps.tg.sent.at(-1).html;
  assert.ok(cur.includes('📍 <b>Тбилиси</b> (Asia/Tbilisi, GMT+04:00)'));
  assert.ok(cur.includes('🕒 Сейчас здесь <b>13:00</b>')); // 12:00 МСК = 13:00 Тбилиси
});

test('п.8: зона не распознана → 6.11', async () => {
  const deps = makeDeps({ classifierMap: { 'переключи': { intent: 'set_timezone', city: 'Хогвартс' } } });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('переключи зону на Хогвартс'));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>⚠️ Не удалось распознать зону</b>'));
});

test('п.10: «удали Тест-1 и Тест-2» → подтверждение → «Да» → обе удалены', async () => {
  const e1 = rawEvent('d1', 'Тест-1', '2026-07-23T10:00:00', '2026-07-23T11:00:00');
  const e2 = rawEvent('d2', 'Тест-2', '2026-07-24T12:00:00', '2026-07-24T13:00:00');
  const deps = makeDeps({
    classifierMap: { 'удали': { intent: 'delete', titles: ['Тест-1', 'Тест-2'] } },
    gcalOpts: { events: [e1, e2] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('удали Тест-1 и Тест-2'));

  const confirm = deps.tg.sent.at(-1);
  assert.ok(confirm.html.startsWith('<b>🗑 Удалить встречи?</b>'));
  assert.ok(confirm.html.endsWith('Точно удаляем?'));
  const [yes, no] = confirm.opts.buttons[0];
  assert.equal(yes.text, '✅ Да, удалить');
  assert.equal(no.text, '❌ Нет');
  assert.equal(deps.gcal.store.length, 2); // ещё ничего не удалено

  await router.handleUpdate(cb(yes.callback_data));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('<b>✅ Встречи удалены</b>'));
  assert.ok(out.includes('📌 <b>Тест-1</b>'));
  assert.ok(out.includes('📌 <b>Тест-2</b>'));
  assert.equal(deps.gcal.store.length, 0);
});

test('удаление: кнопка «Нет» → ничего не удалено', async () => {
  const e1 = rawEvent('d1', 'Тест-1', '2026-07-23T10:00:00', '2026-07-23T11:00:00');
  const deps = makeDeps({
    classifierMap: { 'удали': { intent: 'delete', titles: ['Тест-1'] } },
    gcalOpts: { events: [e1] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('удали Тест-1'));
  const no = deps.tg.sent.at(-1).opts.buttons[0][1];
  await router.handleUpdate(cb(no.callback_data));
  assert.equal(deps.tg.sent.at(-1).html, '<b>❌ Отмена</b>\n━━━━━━━━━━━━━━━━━━━━\n\nНичего не удалил.');
  assert.equal(deps.gcal.store.length, 1);
});

test('фолбэк: классификатор потерял название («удали, пожалуйста, встречу, старая планёрка») → находим по тексту', async () => {
  const e1 = rawEvent('a1', 'Старая планёрка', '2026-07-23T23:00:00', '2026-07-24T00:00:00');
  const deps = makeDeps({
    classifierMap: { 'календаре встречу': { intent: 'delete', titles: [] } }, // модель споткнулась о запятую
    gcalOpts: { events: [e1] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('Удали, пожалуйста, в моем календаре встречу, старая планёрка.'));
  const confirm = deps.tg.sent.at(-1);
  assert.ok(confirm.html.startsWith('<b>🗑 Удалить встречу?</b>'));
  assert.ok(confirm.html.includes('📌 <b>Старая планёрка</b>'));
});

test('п.11: удалить несуществующую → 6.15', async () => {
  const deps = makeDeps({ classifierMap: { 'удали': { intent: 'delete', titles: ['Химера'] } } });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('удали Химеру'));
  assert.equal(deps.tg.sent.at(-1).html,
    '<b>❌ Встреча не найдена</b>\n━━━━━━━━━━━━━━━━━━━━\n\n📌 <b>Химера</b>\n📝 В календаре нет события с таким названием.');
});

test('п.12: два совпадения → 6.16 с кнопками-номерами → выбор → подтверждение удаления', async () => {
  const e1 = rawEvent('a1', 'Созвон с Петей', '2026-07-23T10:00:00', '2026-07-23T11:00:00');
  const e2 = rawEvent('a2', 'Созвон с Васей', '2026-07-24T15:00:00', '2026-07-24T16:00:00');
  const deps = makeDeps({
    classifierMap: { 'удали созвон': { intent: 'delete', titles: ['Созвон'] } },
    gcalOpts: { events: [e1, e2] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('удали созвон'));
  const ambiguous = deps.tg.sent.at(-1);
  assert.ok(ambiguous.html.startsWith('<b>🔍 Найдено несколько встреч</b>'));
  assert.ok(ambiguous.html.includes('1) <b>Созвон с Петей</b> — 23 июля, 🕙 10:00 МСК'));
  assert.ok(ambiguous.html.includes('2) <b>Созвон с Васей</b> — 24 июля, 🕒 15:00 МСК'));
  const btns = ambiguous.opts.buttons[0];
  assert.equal(btns.length, 2);

  await router.handleUpdate(cb(btns[1].callback_data)); // выбрал №2
  const confirm = deps.tg.sent.at(-1);
  assert.ok(confirm.html.startsWith('<b>🗑 Удалить встречу?</b>'));
  assert.ok(confirm.html.includes('📌 <b>Созвон с Васей</b>'));

  await router.handleUpdate(cb(confirm.opts.buttons[0][0].callback_data)); // «Да»
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>✅ Встреча удалена</b>'));
  assert.deepEqual(deps.gcal.store.map((e) => e.id), ['a1']); // удалён именно Вася
});

test('«Удалить все» при неоднозначности: обе уходят на подтверждение и удаляются', async () => {
  const e1 = rawEvent('t1', 'тест 15', '2026-07-23T12:30:00', '2026-07-23T13:30:00');
  const e2 = rawEvent('t2', 'Тест 15', '2026-07-23T12:30:00', '2026-07-23T15:30:00');
  const deps = makeDeps({
    classifierMap: { 'Удали': { intent: 'delete', titles: ['тест 15'] } },
    gcalOpts: { events: [e1, e2] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('Удали встречи тест 15'));
  const ambiguous = deps.tg.sent.at(-1);
  const allBtn = ambiguous.opts.buttons.at(-1)[0];
  assert.equal(allBtn.text, '🗑 Удалить все');

  await router.handleUpdate(cb(allBtn.callback_data));
  const confirm = deps.tg.sent.at(-1);
  assert.ok(confirm.html.startsWith('<b>🗑 Удалить встречи?</b>'));
  assert.ok(deps.tg.edits.at(-1).html.endsWith('➡️ ☑️ Выбрано: все'));

  await router.handleUpdate(cb(confirm.opts.buttons[0][0].callback_data)); // «Да»
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>✅ Встречи удалены</b>'));
  assert.equal(deps.gcal.store.length, 0);
});

test('неоднозначность при обновлении: выбор ЦИФРОЙ → обновляется выбранная', async () => {
  const e1 = rawEvent('t1', 'тест 15', '2026-07-23T12:30:00', '2026-07-23T13:30:00');
  const e2 = rawEvent('t2', 'Тест 15', '2026-07-23T12:30:00', '2026-07-23T15:30:00');
  const deps = makeDeps({
    classifierMap: { 'Добавь во встречу': { intent: 'update', title: 'тест 15', date: '', time_start: '', duration_min: '', attendees_add: ['vasya@mail.ru'], description: 'тестовое', city: '' } },
    gcalOpts: { events: [e1, e2] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('Добавь во встречу тест 15 описание и позови vasya@mail.ru'));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>🔍 Найдено несколько встреч</b>'));

  await router.handleUpdate(msg('2')); // ответ цифрой, без кнопки
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('<b>🔄 Встреча обновлена</b>'));
  assert.ok(out.includes('👥 vasya@mail.ru'));
  assert.ok(out.includes('📝 тестовое'));
  const patched = deps.gcal.store.find((e) => e.id === 't2');
  assert.ok(patched.attendees.some((a) => a.email === 'vasya@mail.ru')); // именно №2
});

test('п.15: спецсимволы в названии не ломают HTML', async () => {
  const deps = makeDeps({
    classifierMap: { 'спец': { ...CREATE_IVAN, title: 'A<B & C', attendees: [] } },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('спец встреча'));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.includes('📌 <b>A&lt;B &amp; C</b>'));
});

test('перенос существующей: «перенеси Ивана на 20:00» → 6.14', async () => {
  const e1 = rawEvent('m1', 'Иван', '2026-07-23T15:00:00', '2026-07-23T16:00:00');
  const deps = makeDeps({
    classifierMap: { 'перенеси': { intent: 'update', title: 'Иван', date: '', time_start: '20:00', duration_min: '', attendees_add: [], description: '', city: '' } },
    gcalOpts: { events: [e1] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('перенеси встречу с Иваном на 20:00'));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('<b>🔄 Встреча перенесена</b>'));
  assert.ok(out.includes('20:00 – 21:00'));
});

test('правило А: голое время в ответе = зона календаря, а не зона исходной встречи', async () => {
  // календарь в Тбилиси; встреча ставилась «по Москве», но время не названо
  const deps = makeDeps({
    classifierMap: { 'встреча': { intent: 'create', title: 'Иван', date: '2026-07-23', time_start: '', time_end: '', duration_min: '60', attendees: [], location: '', description: '', city: 'Москва' } },
    gcalOpts: { tz: 'Asia/Tbilisi' },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('встреча с Иваном завтра по Москве'));
  const ask = deps.tg.sent.at(-1);
  assert.ok(ask.html.includes('в твоей зоне: Тбилиси')); // подсказка с живой зоной

  await router.handleUpdate(msg('в 20:00', { reply_to_message: { message_id: ask.message_id, text: ask.html } }));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.includes('20:00 – 21:00 Тбилиси')); // голое время = зона календаря
  assert.ok(!out.includes('МСК'));                   // второй строки МСК нет

  // а с городом — город побеждает: 20:00 МСК = 21:00 Тбилиси
  await router.handleUpdate(msg('встреча с Иваном завтра по Москве'));
  const ask2 = deps.tg.sent.at(-1);
  await router.handleUpdate(msg('в 20:00 по Москве', { reply_to_message: { message_id: ask2.message_id, text: ask2.html } }));
  const out2 = deps.tg.sent.at(-1).html;
  assert.ok(out2.includes('21:00 – 22:00 Тбилиси'));
  assert.ok(out2.includes('20:00 – 21:00 МСК'));
});

test('детали в ответе на вопрос времени не теряются (длительность/описание/место)', async () => {
  const deps = makeDeps({
    classifierMap: {
      'Встреча с Петей': { intent: 'create', title: 'Петя', date: '2026-07-23', time_start: '', time_end: '', duration_min: '60', attendees: [], location: '', description: '', city: '' },
      'договоры с инвестором': { intent: 'create', title: 'Петя', date: '', time_start: '22:00', time_end: '', duration_min: '90', attendees: [], location: 'Москоу-Сити', description: 'Обсудить договоры с инвестором', city: '' },
    },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('Встреча с Петей завтра'));
  const ask = deps.tg.sent.at(-1);

  await router.handleUpdate(msg(
    'Поставь, пожалуйста, на 22:00. Продолжительность встречи полтора часа. Описание: нужно обсудить договоры с инвестором. Место встречи Москоу-Сити.',
    { reply_to_message: { message_id: ask.message_id, text: ask.html } },
  ));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('<b>✅ Встреча добавлена в календарь!</b>'));
  assert.ok(out.includes('22:00 – 23:30')); // полтора часа, а не дефолтный час
  assert.ok(out.includes('📍 Москоу-Сити'));
  assert.ok(out.includes('📝 Обсудить договоры с инвестором'));
});

test('массовое удаление: «удали все встречи на этой неделе» → подтверждение → удалены', async () => {
  const e1 = rawEvent('b1', 'Планёрка', '2026-07-23T10:00:00', '2026-07-23T11:00:00');
  const e2 = rawEvent('b2', 'Созвон', '2026-07-24T15:00:00', '2026-07-24T16:00:00');
  const deps = makeDeps({
    classifierMap: { 'все встречи': { intent: 'delete_all', range: 'week', date: '' } },
    gcalOpts: { events: [e1, e2] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('Удали, пожалуйста, все встречи на этой неделе'));
  const confirm = deps.tg.sent.at(-1);
  assert.ok(confirm.html.startsWith('<b>🗑 Удалить встречи?</b>'));
  assert.ok(confirm.html.includes('📌 <b>Планёрка</b>'));
  assert.ok(confirm.html.includes('📌 <b>Созвон</b>'));

  await router.handleUpdate(cb(confirm.opts.buttons[0][0].callback_data));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>✅ Встречи удалены</b>'));
  assert.equal(deps.gcal.store.length, 0);
});

test('массовый перенос: «перенеси все встречи на неделю вперёд» → +7 дней', async () => {
  const e1 = rawEvent('m1', 'Планёрка', '2026-07-23T10:00:00', '2026-07-23T11:00:00');
  const deps = makeDeps({
    classifierMap: { 'перенеси все': { intent: 'move_all', range: 'week', date: '', shift_days: '7' } },
    gcalOpts: { events: [e1] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('перенеси все встречи на неделю вперёд, я заболел'));
  const confirm = deps.tg.sent.at(-1);
  assert.ok(confirm.html.startsWith('<b>🔄 Перенести встречи?</b>'));
  assert.ok(confirm.html.includes('на <b>7 дн. вперёд</b>'));
  assert.equal(confirm.opts.buttons[0][0].text, '✅ Да, перенести');

  await router.handleUpdate(cb(confirm.opts.buttons[0][0].callback_data));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('<b>🔄 Встреча перенесена</b>'));
  assert.ok(out.includes('30 июля 2026')); // 23 + 7
  const raw = deps.gcal.store[0];
  assert.ok(raw.start.dateTime.startsWith('2026-07-30'));
});

test('массовый перенос: «Нет» → «Ничего не переношу», встречи на месте', async () => {
  const e1 = rawEvent('m1', 'Планёрка', '2026-07-23T10:00:00', '2026-07-23T11:00:00');
  const deps = makeDeps({
    classifierMap: { 'перенеси все': { intent: 'move_all', range: 'week', date: '', shift_days: '7' } },
    gcalOpts: { events: [e1] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('перенеси все встречи'));
  const no = deps.tg.sent.at(-1).opts.buttons[0][1];
  await router.handleUpdate(cb(no.callback_data));
  assert.ok(deps.tg.sent.at(-1).html.includes('Ничего не переношу.'));
  assert.ok(deps.gcal.store[0].start.dateTime.startsWith('2026-07-23'));
});

test('массовое удаление: пустой период → «Встреч нет»', async () => {
  const deps = makeDeps({
    classifierMap: { 'все встречи': { intent: 'delete_all', range: 'next_week', date: '' } },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('удали все встречи на следующей неделе'));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>🤷 Встреч нет</b>'));
});

test('чужой пользователь игнорируется', async () => {
  const deps = makeDeps({});
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate({ message: { chat: { id: 555 }, from: { id: 555 }, text: 'привет' } });
  assert.equal(deps.tg.sent.length, 0);
});

test('голосовое → транскрипция → тот же пайплайн', async () => {
  const deps = makeDeps({ classifierMap: { 'голосовой текст': { intent: 'today' } } });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate({ message: { chat: { id: OWNER }, from: { id: OWNER }, voice: { file_id: 'v1' } } });
  assert.ok(deps.tg.sent.at(-1).html.startsWith('🗒 <b>Расписание на сегодня</b>'));
});

test('intent other → свободный ответ (экранированный)', async () => {
  const deps = makeDeps({});
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('как дела?'));
  assert.equal(deps.tg.sent.at(-1).html, 'свободный ответ');
});
