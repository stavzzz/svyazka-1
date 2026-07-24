// Интеграционные тесты повторяющихся встреч (24.07): создание серии с картой
// подтверждения, доспрос частоты и конца, конфликт-гейт с EXDATE, удаление и
// перенос с объёмом «только эту / эту и следующие / всю серию», 🔁-бейджи.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router.js';
import { makeDeps, msg, cb, rawEvent, rawRecurInstance, rawRecurMaster, OWNER } from './helpers.js';

// NOW в helpers: СР, 2026-07-22 12:00 МСК.

const CREATE_YOGA = {
  intent: 'create', title: 'Йога', date: '2026-07-27', time_start: '11:00', time_end: '12:30',
  duration_min: '', attendees: [], location: '', description: '', city: '',
  recur: { freq: 'weekly', byday: ['MO', 'FR'], interval: '1', count: '', until: '2026-09-20' },
};

function lastButtons(deps) { return deps.tg.sent.at(-1).opts.buttons; }
function btn(deps, row, col) { return lastButtons(deps)[row][col].callback_data; }

// Фикстура: серия «Йога» ПН+ПТ 11:00–12:30, мастер m1 + 3 экземпляра в кэше.
function yogaSeriesEvents() {
  return [
    rawRecurMaster('m1', 'Йога', '2026-07-27T11:00:00', '2026-07-27T12:30:00', ['RRULE:FREQ=WEEKLY;BYDAY=MO,FR']),
    rawRecurInstance('m1', 'Йога', '2026-07-27T11:00:00', '2026-07-27T12:30:00'),
    rawRecurInstance('m1', 'Йога', '2026-07-31T11:00:00', '2026-07-31T12:30:00'),
    rawRecurInstance('m1', 'Йога', '2026-08-03T11:00:00', '2026-08-03T12:30:00'),
  ];
}

// ── Создание ─────────────────────────────────────────────────────

test('серия п.1: полная фраза → карточка серии → ✅ → RRULE с BYDAY и UNTIL, карточка с 🔁', async () => {
  const deps = makeDeps({ classifierMap: { 'йога': CREATE_YOGA } });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('йога каждый ПН и ПТ с 11:00 до 12:30 до 20 сентября'));

  const card = deps.tg.sent.at(-1);
  assert.ok(card.html.startsWith('<b>🔁 Повторяющаяся встреча</b>'));
  // «до …» — дата ПОСЛЕДНЕГО занятия (ПТ 18.09), а не ограничитель until (ВС 20.09)
  assert.ok(card.html.includes('🔁 еженедельно по ПН и ПТ · до ПТ, 18 сентября (16 занятий)'));
  assert.ok(card.html.includes('11:00 – 12:30')); // 90 минут из time_end
  assert.equal(lastButtons(deps)[0][0].text, '✅ Поставить');

  await router.handleUpdate(cb(btn(deps, 0, 0))); // ✅ Поставить
  const created = deps.gcal.calls.find((c) => c[0] === 'create')[1];
  assert.deepEqual(created.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=MO,FR;UNTIL=20260920T205959Z']);
  assert.equal(created.start.dateTime.slice(0, 16), '2026-07-27T11:00');
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('<b>✅ Встреча добавлена в календарь!</b>'));
  assert.ok(out.includes('🔁 еженедельно по ПН и ПТ'));
});

test('серия п.2: конец не назван → «Докуда повторять?» → «бессрочно» → RRULE без UNTIL/COUNT', async () => {
  const deps = makeDeps({
    classifierMap: {
      'планёрка': {
        intent: 'create', title: 'Планёрка', date: '2026-07-28', time_start: '10:00', time_end: '',
        duration_min: '60', recur: { freq: 'weekly', byday: ['TU'], interval: '1', count: '', until: '' },
      },
    },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('каждый вторник в 10 планёрка'));

  // «в 10» без маркера — сначала штатный вопрос «утра или вечера?»
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>🕗 Утра или вечера?</b>'));
  await router.handleUpdate(cb(btn(deps, 0, 0))); // 🌅 Утра

  const ask = deps.tg.sent.at(-1);
  assert.ok(ask.html.startsWith('<b>📅 Докуда повторять?</b>'));
  assert.equal(ask.opts.forceReply, true);

  await router.handleUpdate(msg('бессрочно'));
  const card = deps.tg.sent.at(-1);
  assert.ok(card.html.includes('🔁 еженедельно по ВТ · бессрочно'));

  await router.handleUpdate(cb(btn(deps, 0, 0)));
  const created = deps.gcal.calls.find((c) => c[0] === 'create')[1];
  assert.deepEqual(created.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TU']);
});

test('серия п.3: «повторяющуюся Йога» без деталей → частота → время → «10 раз» → COUNT=10', async () => {
  const deps = makeDeps({
    classifierMap: {
      'повторяющуюся': {
        intent: 'create', title: 'Йога', date: '2026-07-22', time_start: '', time_end: '',
        duration_min: '60', recur: { freq: '', byday: [], interval: '1', count: '', until: '' },
      },
    },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('поставь повторяющуюся встречу Йога'));

  let ask = deps.tg.sent.at(-1);
  assert.ok(ask.html.startsWith('<b>🔁 Как часто повторять?</b>'));

  await router.handleUpdate(msg('каждый понедельник и пятницу'));
  ask = deps.tg.sent.at(-1);
  assert.ok(ask.html.startsWith('<b>🕒 На какое время поставить встречу?</b>'));

  await router.handleUpdate(msg('в 11:00', { reply_to_message: { message_id: ask.message_id, text: ask.html } }));
  ask = deps.tg.sent.at(-1);
  assert.ok(ask.html.startsWith('<b>📅 Докуда повторять?</b>'));

  await router.handleUpdate(msg('10 раз'));
  const card = deps.tg.sent.at(-1);
  assert.ok(card.html.includes('🔁 еженедельно по ПН и ПТ · 10 раз'));

  await router.handleUpdate(cb(btn(deps, 0, 0)));
  const created = deps.gcal.calls.find((c) => c[0] === 'create')[1];
  assert.deepEqual(created.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=MO,FR;COUNT=10']);
  // Йога без байдэй-даты: 22.07 — СР, первая встреча уезжает на ПТ 24.07
  assert.equal(created.start.dateTime.slice(0, 16), '2026-07-24T11:00');
});

test('серия п.4: конфликт экземпляра → карточка с датой → «Пропустить эти дни» → EXDATE', async () => {
  const busy = rawEvent('busy1', 'Стендап', '2026-07-27T11:30:00', '2026-07-27T12:00:00');
  const deps = makeDeps({
    classifierMap: { 'йога': { ...CREATE_YOGA, recur: { ...CREATE_YOGA.recur, until: '2026-08-09' } } },
    gcalOpts: { events: [busy] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('йога каждый ПН и ПТ'));
  await router.handleUpdate(cb(btn(deps, 0, 0))); // ✅ Поставить

  const conflict = deps.tg.sent.at(-1);
  assert.ok(conflict.html.startsWith('<b>⚠️ Конфликты в серии</b>'));
  assert.ok(conflict.html.includes('• ПН, 27 июля — <b>Стендап</b> 11:30–12:00 МСК'));
  assert.equal(lastButtons(deps)[0][1].text, '⏭ Пропустить эти дни');

  await router.handleUpdate(cb(btn(deps, 0, 1))); // ⏭
  const created = deps.gcal.calls.find((c) => c[0] === 'create')[1];
  assert.deepEqual(created.recurrence, [
    'RRULE:FREQ=WEEKLY;BYDAY=MO,FR;UNTIL=20260809T205959Z',
    'EXDATE;TZID=Europe/Moscow:20260727T110000',
  ]);
});

test('серия п.5: конфликт → «Всё равно» → серия без EXDATE', async () => {
  const busy = rawEvent('busy1', 'Стендап', '2026-07-27T11:30:00', '2026-07-27T12:00:00');
  const deps = makeDeps({
    classifierMap: { 'йога': { ...CREATE_YOGA, recur: { ...CREATE_YOGA.recur, until: '2026-08-09' } } },
    gcalOpts: { events: [busy] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('йога каждый ПН и ПТ'));
  await router.handleUpdate(cb(btn(deps, 0, 0)));
  await router.handleUpdate(cb(btn(deps, 0, 0))); // ✅ Всё равно
  const created = deps.gcal.calls.find((c) => c[0] === 'create')[1];
  assert.equal(created.recurrence.length, 1);
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>✅ Встреча добавлена в календарь!</b>'));
});

// ── Удаление ─────────────────────────────────────────────────────

test('серия п.6: «удали йогу» → кнопки объёма (не 16 кнопок выбора!) → «Всю серию» → удалён мастер', async () => {
  const deps = makeDeps({
    classifierMap: { 'удали йогу': { intent: 'delete', titles: ['Йога'], date: '', time_start: '', series_scope: '' } },
    gcalOpts: { events: yogaSeriesEvents() },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('удали йогу'));

  const scopeCard = deps.tg.sent.at(-1);
  assert.ok(scopeCard.html.startsWith('<b>🔁 Это повторяющаяся встреча</b>'));
  const rows = lastButtons(deps);
  assert.equal(rows.length, 4);
  assert.equal(rows[0][0].text, 'Только эту (ПН, 27 июля)');
  assert.equal(rows[2][0].text, 'Всю серию');

  await router.handleUpdate(cb(rows[2][0].callback_data)); // Всю серию
  const confirm = deps.tg.sent.at(-1);
  assert.ok(confirm.html.includes('🔁 Объём: <b>вся серия</b>'));
  await router.handleUpdate(cb(btn(deps, 0, 0))); // ✅ Да, удалить
  assert.deepEqual(deps.gcal.calls.at(-1), ['delete', 'm1']);
  assert.ok(deps.tg.sent.at(-1).html.includes('🔁 Объём: <b>вся серия</b>'));
});

test('серия п.7: «Только эту» → удалён экземпляр; «Эту и следующие» → мастеру urезан RRULE (UNTIL)', async () => {
  // Только эту
  let deps = makeDeps({
    classifierMap: { 'удали йогу': { intent: 'delete', titles: ['Йога'], series_scope: '' } },
    gcalOpts: { events: yogaSeriesEvents() },
  });
  let router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('удали йогу'));
  await router.handleUpdate(cb(lastButtons(deps)[0][0].callback_data)); // Только эту
  await router.handleUpdate(cb(btn(deps, 0, 0)));
  assert.equal(deps.gcal.calls.at(-1)[0], 'delete');
  assert.match(deps.gcal.calls.at(-1)[1], /^m1_2026/); // id экземпляра, не мастера

  // Эту и следующие — с ПТ 31.07: мастер остаётся, но с UNTIL до этой даты
  deps = makeDeps({
    classifierMap: { 'удали йогу': { intent: 'delete', titles: ['Йога'], date: '2026-07-31', series_scope: 'following' } },
    gcalOpts: { events: yogaSeriesEvents() },
  });
  router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('удали йогу начиная с пятницы'));
  assert.ok(deps.tg.sent.at(-1).html.includes('🔁 Объём: <b>это занятие и все следующие</b>'));
  await router.handleUpdate(cb(btn(deps, 0, 0)));
  const patch = deps.gcal.calls.findLast((c) => c[0] === 'patch');
  assert.equal(patch[1], 'm1');
  // 31.07 11:00 МСК − 1с = 07:59:59Z
  assert.deepEqual(patch[2].recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=MO,FR;UNTIL=20260731T075959Z']);
});

test('серия п.8: «удали серию йоги» (series_scope=all от классификатора) → сразу подтверждение', async () => {
  const deps = makeDeps({
    classifierMap: { 'удали серию': { intent: 'delete', titles: ['Йога'], series_scope: 'all' } },
    gcalOpts: { events: yogaSeriesEvents() },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('удали серию йоги'));
  const confirm = deps.tg.sent.at(-1);
  assert.ok(confirm.html.startsWith('<b>🗑 Удалить встречу?</b>')); // без кнопок объёма
  assert.ok(confirm.html.includes('🔁 Объём: <b>вся серия</b>'));
  await router.handleUpdate(cb(btn(deps, 0, 0)));
  assert.deepEqual(deps.gcal.calls.at(-1), ['delete', 'm1']);
});

test('серия п.9: «отмени йогу в понедельник» → объём не спрашивается, удаляется экземпляр этой даты', async () => {
  const deps = makeDeps({
    classifierMap: { 'отмени йогу': { intent: 'delete', titles: ['Йога'], date: '2026-08-03', time_start: '', series_scope: '' } },
    gcalOpts: { events: yogaSeriesEvents() },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('отмени йогу в понедельник 3 августа'));
  const confirm = deps.tg.sent.at(-1);
  assert.ok(confirm.html.includes('🔁 Объём: <b>только это занятие</b>'));
  assert.ok(confirm.html.includes('ПН, 3 августа'));
  await router.handleUpdate(cb(btn(deps, 0, 0)));
  const del = deps.gcal.calls.at(-1);
  assert.equal(del[0], 'delete');
  assert.ok(del[1].startsWith('m1_20260803')); // именно понедельничный экземпляр
});

// ── Перенос ──────────────────────────────────────────────────────

test('серия п.10: «перенеси йогу на 12:00» → объём → «Только эту» двигает экземпляр, «Всю серию» — мастер', async () => {
  // Только эту
  let deps = makeDeps({
    classifierMap: { 'перенеси йогу': { intent: 'update', title: 'Йога', time_start: '12:00', series_scope: '' } },
    gcalOpts: { events: yogaSeriesEvents() },
  });
  let router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('перенеси йогу на 12:00'));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>🔁 Это повторяющаяся встреча</b>'));
  await router.handleUpdate(cb(lastButtons(deps)[0][0].callback_data)); // Только эту
  let patch = deps.gcal.calls.findLast((c) => c[0] === 'patch');
  assert.match(patch[1], /^m1_2026/);
  assert.equal(patch[2].start.dateTime.slice(0, 16), '2026-07-27T12:00');

  // Всю серию
  deps = makeDeps({
    classifierMap: { 'йогу': { intent: 'update', title: 'Йога', time_start: '12:00', series_scope: 'all' } },
    gcalOpts: { events: yogaSeriesEvents() },
  });
  router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('перенеси всю йогу на 12:00'));
  patch = deps.gcal.calls.findLast((c) => c[0] === 'patch');
  assert.equal(patch[1], 'm1');
  assert.equal(patch[2].start.dateTime.slice(0, 16), '2026-07-27T12:00');
  assert.equal(patch[2].end.dateTime.slice(0, 16), '2026-07-27T13:30'); // длительность 90 мин сохранена
  assert.ok(deps.tg.sent.at(-1).html.includes('🔁 Объём: <b>вся серия</b>'));
});

test('серия п.11: «эту и следующие» на новое время → старая серия урезана + новая с этой даты', async () => {
  const deps = makeDeps({
    classifierMap: { 'перенеси йогу': { intent: 'update', title: 'Йога', time_start: '12:00', series_scope: 'following' } },
    gcalOpts: { events: yogaSeriesEvents() },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('перенеси йогу на 12:00 начиная с этой'));

  const patch = deps.gcal.calls.find((c) => c[0] === 'patch');
  assert.equal(patch[1], 'm1');
  assert.match(patch[2].recurrence[0], /UNTIL=20260727T075959Z$/); // хвост отрезан до ближайшего экземпляра
  const created = deps.gcal.calls.find((c) => c[0] === 'create')[1];
  assert.equal(created.summary, 'Йога');
  assert.equal(created.start.dateTime.slice(0, 16), '2026-07-27T12:00');
  assert.deepEqual(created.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=MO,FR']);
  assert.ok(deps.tg.sent.at(-1).html.includes('🔁 Объём: <b>это занятие и все следующие</b>'));
});

test('серия п.12: сдвиг всей серии «на час позже» (shift_min) без вопроса — series_scope=all', async () => {
  const deps = makeDeps({
    classifierMap: { 'сдвинь': { intent: 'update', title: 'Йога', shift_min: '60', series_scope: 'all' } },
    gcalOpts: { events: yogaSeriesEvents() },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('сдвинь всю йогу на час позже'));
  const patch = deps.gcal.calls.findLast((c) => c[0] === 'patch');
  assert.equal(patch[1], 'm1');
  assert.equal(patch[2].start.dateTime.slice(0, 16), '2026-07-27T12:00');
});

// ── Прочее ───────────────────────────────────────────────────────

test('серия п.13: /today показывает 🔁 у экземпляра серии', async () => {
  const deps = makeDeps({
    gcalOpts: { events: [rawRecurInstance('m1', 'Йога', '2026-07-22T15:00:00', '2026-07-22T16:30:00')] },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('/today'));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.includes('🔁 <a href='));
  assert.ok(out.includes('Йога'));
});

test('серия п.14: «переименуй йогу в Пилатес» → patch МАСТЕРА (вся серия), объём не спрашивается', async () => {
  const deps = makeDeps({
    classifierMap: { 'переименуй': { intent: 'update', title: 'Йога', new_title: 'Пилатес', series_scope: '' } },
    gcalOpts: { events: yogaSeriesEvents() },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('переименуй йогу в Пилатес'));
  const patch = deps.gcal.calls.findLast((c) => c[0] === 'patch');
  assert.equal(patch[1], 'm1');
  assert.equal(patch[2].summary, 'Пилатес');
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>🔄 Встреча обновлена</b>'));
});

test('серия п.15: «найди йогу» → одна карточка (не 3 экземпляра) с описанием ритма', async () => {
  const deps = makeDeps({
    classifierMap: { 'найди йогу': { intent: 'find', titles: ['Йога'] } },
    gcalOpts: { events: yogaSeriesEvents() },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('найди йогу'));
  const out = deps.tg.sent.at(-1);
  assert.ok(out.html.startsWith('<b>🔍 Нашёл встречу</b>')); // одна, без выбора
  assert.ok(out.html.includes('🔁 еженедельно по ПН и ПТ · бессрочно'));
});

test('серия п.17 (баг 23.07 ночь): ответ «каждый ПН в 6:30 утра» сокращением — понят', async () => {
  const deps = makeDeps({
    classifierMap: {
      'повторяющуюся': {
        intent: 'create', title: 'Ретро', date: '2026-07-22', time_start: '', duration_min: '60',
        recur: { freq: '', byday: [], interval: '1', count: '', until: '' },
      },
    },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('поставь повторяющуюся встречу Ретро'));
  await router.handleUpdate(msg('каждый ПН в 6:30 утра'));
  // частота и время поняты из одного ответа → сразу «Докуда повторять?»
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>📅 Докуда повторять?</b>'));
  await router.handleUpdate(msg('2 раза'));
  await router.handleUpdate(cb(btn(deps, 0, 0)));
  const created = deps.gcal.calls.find((c) => c[0] === 'create')[1];
  assert.deepEqual(created.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2']);
  assert.equal(created.start.dateTime.slice(0, 16), '2026-07-27T06:30');
});

test('серия п.18 (баг 23.07 ночь): «ПН в 6:30 и ВС в 5:00» — два времени → просим по одной серии', async () => {
  const deps = makeDeps({
    classifierMap: {
      'повторяющуюся': {
        intent: 'create', title: 'Ретро', date: '2026-07-22', time_start: '', duration_min: '60',
        recur: { freq: '', byday: [], interval: '1', count: '', until: '' },
      },
    },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('поставь повторяющуюся встречу Ретро'));
  await router.handleUpdate(msg('каждый понедельник в 6:30 утра и каждое воскресенье в 05:00 утра'));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>🕒 Разные времена — это разные серии</b>'));
  // Ожидание не сброшено — следующий ответ продолжает цепочку
  await router.handleUpdate(msg('каждый понедельник в 6:30 утра'));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>📅 Докуда повторять?</b>'));
});

test('серия п.19 (баг 23.07 ночь): серия + одиночная с тем же названием → «Удалить все» сносит серию целиком', async () => {
  const events = [...yogaSeriesEvents(), rawEvent('solo1', 'Йога', '2026-07-25T18:00:00', '2026-07-25T19:00:00')];
  const deps = makeDeps({
    classifierMap: { 'удали йогу': { intent: 'delete', titles: ['Йога'], series_scope: '' } },
    gcalOpts: { events },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('удали йогу'));
  // Две «йоги» (серия схлопнута + одиночная) → выбор с «Удалить все»
  const rows = lastButtons(deps);
  const allBtn = rows.at(-1)[0];
  assert.equal(allBtn.text, '🗑 Удалить все');
  await router.handleUpdate(cb(allBtn.callback_data));
  await router.handleUpdate(cb(btn(deps, 0, 0))); // ✅ Да, удалить
  const deleted = deps.gcal.calls.filter((c) => c[0] === 'delete').map((c) => c[1]).sort();
  assert.deepEqual(deleted, ['m1', 'solo1']); // мастер серии, не экземпляр; без 410-падений
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>✅ Встречи удалены</b>'));
});

test('серия п.20: выбор ОДНОЙ из нескольких, и это серия → кнопки объёма', async () => {
  const events = [...yogaSeriesEvents(), rawEvent('solo1', 'Йога', '2026-07-25T18:00:00', '2026-07-25T19:00:00')];
  const deps = makeDeps({
    classifierMap: { 'удали йогу': { intent: 'delete', titles: ['Йога'], series_scope: '' } },
    gcalOpts: { events },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('удали йогу'));
  // Кандидаты отсортированы по старту: solo1 (25.07) раньше серии (27.07)? Нет: серия с 27.07, solo 25.07 → solo первый.
  // Берём кнопку той, что серия — вторая.
  const pickRows = lastButtons(deps);
  await router.handleUpdate(cb(pickRows[1][0].callback_data));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>🔁 Это повторяющаяся встреча</b>'));
});

test('серия п.21: bulk «удали все встречи сегодня» удаляет ЭКЗЕМПЛЯР серии, не всю серию', async () => {
  const events = [
    rawRecurMaster('m1', 'Йога', '2026-07-22T15:00:00', '2026-07-22T16:00:00', ['RRULE:FREQ=WEEKLY;BYDAY=WE']),
    rawRecurInstance('m1', 'Йога', '2026-07-22T15:00:00', '2026-07-22T16:00:00'),
    rawRecurInstance('m1', 'Йога', '2026-07-29T15:00:00', '2026-07-29T16:00:00'),
  ];
  const deps = makeDeps({
    classifierMap: { 'удали все': { intent: 'delete_all', range: 'today', date: '' } },
    gcalOpts: { events },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('удали все встречи сегодня'));
  await router.handleUpdate(cb(btn(deps, 0, 0))); // ✅ Да, удалить
  const deleted = deps.gcal.calls.filter((c) => c[0] === 'delete').map((c) => c[1]);
  assert.equal(deleted.length, 1);
  assert.match(deleted[0], /^m1_20260722/); // именно сегодняшний экземпляр
});

test('серия п.22 (баг 24.07 утро): новая команда во время «Докуда?» — цепочка сброшена, команда выполнена', async () => {
  const deps = makeDeps({
    classifierMap: {
      'повторяющуюся': {
        intent: 'create', title: 'Ретро', date: '2026-07-22', time_start: '10:00', duration_min: '60',
        recur: { freq: 'weekly', byday: ['TU'], interval: '1', count: '', until: '' },
      },
      'встречу с Иваном': {
        intent: 'create', title: 'Иван', date: '2026-07-23', time_start: '15:00', time_end: '',
        duration_min: '60', attendees: [], location: '', description: '', city: '',
      },
    },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('поставь повторяющуюся встречу Ретро'));
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>📅 Докуда повторять?</b>'));
  // Вместо ответа — новая команда: раньше съедалась «Не понял, докуда»
  await router.handleUpdate(msg('Поставь встречу с Иваном завтра в 15:00'));
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.startsWith('<b>✅ Встреча добавлена в календарь!</b>'));
  assert.ok(out.includes('📌 <b>Иван</b>'));
});

test('серия п.23 (баг 24.07): две встречи одной фразой → бот сам ведёт по очереди, обе созданы', async () => {
  const deps = makeDeps({
    classifierMap: {
      // Ключ уточняющего запроса — раньше общего (мок матчит по includes)
      'Разбери ТОЛЬКО встречу «Тест 2»': {
        intent: 'create', title: 'Тест 2', date: '2026-07-26', time_start: '18:00', duration_min: '60',
        recur: { freq: 'weekly', byday: ['SU'], interval: '1', count: '4', until: '' },
      },
      'Тест 1': {
        intent: 'create', title: 'Тест 1', date: '2026-07-25', time_start: '17:00', duration_min: '60',
        more_titles: ['Тест 2'],
        recur: { freq: 'weekly', byday: ['SA'], interval: '1', count: '4', until: '' },
      },
    },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('Поставь каждую СБ встречу Тест 1 в 17:00 и каждое ВС Тест 2 в 18:00'));
  const note = deps.tg.sent.find((m) => m.html.includes('Ставлю по очереди'));
  assert.ok(note, 'нет сообщения об очереди');
  assert.ok(note.html.includes('<b>Тест 2</b>'));
  // Карточка Тест 1 → ✅ → создан → бот САМ показывает карточку Тест 2 → ✅
  assert.ok(deps.tg.sent.at(-1).html.includes('<b>Тест 1</b>'));
  await router.handleUpdate(cb(btn(deps, 0, 0)));
  const card2 = deps.tg.sent.at(-1);
  assert.ok(card2.html.startsWith('<b>🔁 Повторяющаяся встреча</b>'));
  assert.ok(card2.html.includes('<b>Тест 2</b>'));
  await router.handleUpdate(cb(btn(deps, 0, 0)));
  const created = deps.gcal.calls.filter((c) => c[0] === 'create').map((c) => c[1].summary);
  assert.deepEqual(created, ['Тест 1', 'Тест 2']);
});

test('серия п.24 (тест 62 Стаса): день выпал целиком → старт с первого реального, BYDAY без него, честный счётчик', async () => {
  // Оба ПН заняты → у Пилатеса (ПН+СР, 2 недели) остаются только среды
  const busy = [
    rawEvent('b1', 'Йога', '2026-07-27T11:00:00', '2026-07-27T12:00:00'),
    rawEvent('b2', 'Йога', '2026-08-03T11:00:00', '2026-08-03T12:00:00'),
  ];
  const deps = makeDeps({
    classifierMap: {
      'пилатес': {
        intent: 'create', title: 'Пилатес', date: '2026-07-24', time_start: '11:00', duration_min: '60',
        recur: { freq: 'weekly', byday: ['MO', 'WE'], interval: '1', count: '', until: '2026-08-05' },
      },
    },
    gcalOpts: { events: busy },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('пилатес каждый ПН и СР в 11:00 на 2 недели'));
  await router.handleUpdate(cb(btn(deps, 0, 0))); // ✅ Поставить → конфликты
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>⚠️ Конфликты в серии</b>'));
  await router.handleUpdate(cb(btn(deps, 0, 1))); // ⏭ Пропустить эти дни

  const created = deps.gcal.calls.find((c) => c[0] === 'create')[1];
  assert.equal(created.start.dateTime.slice(0, 16), '2026-07-29T11:00'); // первая РЕАЛЬНАЯ — СР
  assert.deepEqual(created.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20260805T205959Z']); // без ПН и без EXDATE
  const out = deps.tg.sent.at(-1).html;
  assert.ok(out.includes('🗓 Первая встреча в СР, 29 июля 2026'));
  assert.ok(out.includes('🔁 еженедельно по СР · до СР, 5 августа (2 занятия)'));
});

test('серия п.25: точечный пропуск (день жив) → EXDATE остаётся, старт с первого реального', async () => {
  // Занят только один ПН из двух → ПН остаётся в BYDAY, но с EXDATE
  const busy = [rawEvent('b1', 'Йога', '2026-07-27T11:00:00', '2026-07-27T12:00:00')];
  const deps = makeDeps({
    classifierMap: {
      'пилатес': {
        intent: 'create', title: 'Пилатес', date: '2026-07-24', time_start: '11:00', duration_min: '60',
        recur: { freq: 'weekly', byday: ['MO', 'WE'], interval: '1', count: '', until: '2026-08-05' },
      },
    },
    gcalOpts: { events: busy },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('пилатес каждый ПН и СР в 11:00 на 2 недели'));
  await router.handleUpdate(cb(btn(deps, 0, 0)));
  await router.handleUpdate(cb(btn(deps, 0, 1))); // ⏭
  const created = deps.gcal.calls.find((c) => c[0] === 'create')[1];
  assert.equal(created.start.dateTime.slice(0, 16), '2026-07-29T11:00');
  assert.deepEqual(created.recurrence, [
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260805T205959Z',
    'EXDATE;TZID=Europe/Moscow:20260727T110000',
  ]);
  assert.ok(deps.tg.sent.at(-1).html.includes('(3 занятия)')); // 4 − 1 пропуск
});

test('серия п.26: пропуск съел ВСЕ занятия → серия не создаётся, честное сообщение', async () => {
  const busy = [
    rawEvent('b1', 'Йога', '2026-07-27T11:00:00', '2026-07-27T12:00:00'),
    rawEvent('b2', 'Йога', '2026-08-03T11:00:00', '2026-08-03T12:00:00'),
  ];
  const deps = makeDeps({
    classifierMap: {
      'пилатес': {
        intent: 'create', title: 'Пилатес', date: '2026-07-24', time_start: '11:00', duration_min: '60',
        recur: { freq: 'weekly', byday: ['MO'], interval: '1', count: '', until: '2026-08-05' },
      },
    },
    gcalOpts: { events: busy },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('пилатес каждый ПН в 11:00 на 2 недели'));
  await router.handleUpdate(cb(btn(deps, 0, 0)));
  await router.handleUpdate(cb(btn(deps, 0, 1))); // ⏭ — а занятий не осталось
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>🤷 Ставить нечего</b>'));
  assert.equal(deps.gcal.calls.some((c) => c[0] === 'create'), false);
});

test('серия п.16: отмена на кнопках объёма → «ничего не удалил»', async () => {
  const deps = makeDeps({
    classifierMap: { 'удали йогу': { intent: 'delete', titles: ['Йога'], series_scope: '' } },
    gcalOpts: { events: yogaSeriesEvents() },
  });
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('удали йогу'));
  await router.handleUpdate(cb(lastButtons(deps)[3][0].callback_data)); // ❌ Отмена
  assert.ok(deps.tg.sent.at(-1).html.startsWith('<b>❌ Отмена</b>'));
  assert.equal(deps.gcal.calls.some((c) => c[0] === 'delete'), false);
});
