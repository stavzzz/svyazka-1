// Тесты /reminders: настройки, кнопки-тумблеры, перерисовка, гейты планировщика.
// Классификатор-бомба: всё управление — чистый код.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { createRouter } from '../src/router.js';
import { createScheduler } from '../src/scheduler.js';
import { makeDeps, msg, rawEvent, OWNER } from './helpers.js';

function bombDeps(opts = {}) {
  const deps = makeDeps(opts);
  deps.classifier = {
    async classify() { throw new Error('КЛАССИФИКАТОР ВЫЗВАН!'); },
    async freeAnswer() { throw new Error('freeAnswer вызван!'); },
  };
  return deps;
}
const setCb = (data, messageId = 500) => ({
  callback_query: { id: 'cbq', data, from: { id: OWNER }, message: { chat: { id: OWNER }, message_id: messageId } },
});

test('/reminders: карточка с дефолтами + 5 рядов кнопок, без модели', async () => {
  const deps = bombDeps({});
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(msg('/reminders'));
  const m = deps.tg.sent.at(-1);
  assert.ok(m.html.startsWith('<b>⚙️ Напоминания</b>\n━━━━━━━━━━━━━━━━━━━━'));
  assert.ok(m.html.includes('🌅 План дня: 08:00 · каждый день'));
  assert.ok(m.html.includes('🗓 План недели: ПН 09:00'));
  assert.ok(m.html.includes('🔔 Перед встречей: за сутки · час · 5 минут'));
  const rows = m.opts.buttons;
  assert.equal(rows.length, 5);
  assert.equal(rows[1].length, 7); // дни недели
  assert.equal(rows[3].length, 5); // ярусы: Сутки/Час/30м/10м/5м
});

test('кнопки: день СБ/ВС выкл, время 09:00, ярус 30м вкл — карточка перерисована', async () => {
  const deps = bombDeps({});
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(setCb('set:md:6'));
  await router.handleUpdate(setCb('set:md:7'));
  await router.handleUpdate(setCb('set:mt:09:00'));
  await router.handleUpdate(setCb('set:t:30'));
  const s = deps.state.data.settings;
  assert.deepEqual(s.morning.days, [1, 2, 3, 4, 5]);
  assert.equal(s.morning.time, '09:00');
  assert.equal(s.tiers[30], true);
  const last = deps.tg.edits.at(-1);
  assert.equal(last.messageId, 500);
  assert.ok(last.html.includes('🌅 План дня: 09:00 · ПН ВТ СР ЧТ ПТ'));
  assert.ok(last.html.includes('за сутки · час · 30 минут · 5 минут'));
});

test('кнопки: план недели выкл и цикл времени', async () => {
  const deps = bombDeps({});
  const router = createRouter(deps);
  await router.refreshCache();
  await router.handleUpdate(setCb('set:wo'));
  assert.equal(deps.state.data.settings.weekly.enabled, false);
  assert.ok(deps.tg.edits.at(-1).html.includes('🗓 План недели: выкл'));
  await router.handleUpdate(setCb('set:wt'));
  assert.equal(deps.state.data.settings.weekly.time, '10:00'); // 09:00 → 10:00
});

function sched(deps, nowRef) {
  const router = createRouter({ ...deps, now: () => nowRef.t });
  return createScheduler({ ...deps, refreshCache: router.refreshCache, now: () => nowRef.t });
}

test('ярус 30 минут: по умолчанию молчит, после включения шлёт «через 30 минут» один раз', async () => {
  const start = DateTime.fromISO('2026-07-22T12:30:10', { zone: 'Europe/Moscow' });
  const ev = rawEvent('r30', 'Демо', start.toISO(), start.plus({ hours: 1 }).toISO());
  const nowRef = { t: DateTime.fromISO('2026-07-22T12:00:20', { zone: 'Europe/Moscow' }).toMillis() };

  const off = makeDeps({ gcalOpts: { events: [ev] } });
  await sched(off, nowRef).tick();
  assert.equal(off.tg.sent.filter((m) => m.html.includes('через 30 минут')).length, 0);

  const on = makeDeps({ gcalOpts: { events: [ev] } });
  on.state.data.settings.tiers[30] = true;
  const s2 = sched(on, nowRef);
  await s2.tick();
  const got = on.tg.sent.filter((m) => m.html.startsWith('<b>🔔 Встреча через 30 минут!</b>'));
  assert.equal(got.length, 1);
  nowRef.t += 60_000;
  await s2.tick();
  assert.equal(on.tg.sent.filter((m) => m.html.includes('через 30 минут')).length, 1); // без дублей
});

test('план дня уважает дни недели и время из настроек', async () => {
  // СР 22.07, дни только ПН–ПТ, время 09:00
  const mk = (iso) => ({ t: DateTime.fromISO(iso, { zone: 'Europe/Moscow' }).toMillis() });

  // в 08:02 при времени 09:00 — молчит
  const d1 = makeDeps({});
  d1.state.data.settings.morning.time = '09:00';
  await sched(d1, mk('2026-07-22T08:02:00')).tick();
  assert.equal(d1.tg.sent.length, 0);

  // в 09:02 — шлёт
  const d2 = makeDeps({});
  d2.state.data.settings.morning.time = '09:00';
  await sched(d2, mk('2026-07-22T09:02:00')).tick();
  assert.equal(d2.tg.sent.filter((m) => m.html.startsWith('🗒 <b>Расписание на сегодня</b>')).length, 1);

  // СБ 25.07 при днях ПН–ПТ — молчит
  const d3 = makeDeps({});
  d3.state.data.settings.morning.days = [1, 2, 3, 4, 5];
  await sched(d3, mk('2026-07-25T08:02:00')).tick();
  assert.equal(d3.tg.sent.length, 0);

  // выключен целиком — молчит
  const d4 = makeDeps({});
  d4.state.data.settings.morning.enabled = false;
  await sched(d4, mk('2026-07-22T08:02:00')).tick();
  assert.equal(d4.tg.sent.length, 0);
});

test('план недели: выключен — молчит даже в ПН 09:02', async () => {
  const deps = makeDeps({});
  deps.state.data.settings.weekly.enabled = false;
  const nowRef = { t: DateTime.fromISO('2026-07-20T09:02:00', { zone: 'Europe/Moscow' }).toMillis() };
  await sched(deps, nowRef).tick();
  assert.equal(deps.tg.sent.filter((m) => m.html.includes('Расписание на 2')).length, 0);
});
