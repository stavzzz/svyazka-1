// Тесты планировщиков: окна напоминаний (интервалы), гейты 08:00 и Пн 09:00 — ровно один раз.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { createScheduler } from '../src/scheduler.js';
import { createRouter } from '../src/router.js';
import { makeDeps, rawEvent } from './helpers.js';

function schedDeps(deps, nowRef) {
  const router = createRouter({ ...deps, now: () => nowRef.t });
  return createScheduler({ ...deps, refreshCache: router.refreshCache, now: () => nowRef.t });
}

test('п.13: напоминание за 5 минут — ровно один раз (окно-интервал)', async () => {
  const start = DateTime.fromISO('2026-07-22T12:05:10', { zone: 'Europe/Moscow' });
  const ev = rawEvent('r1', 'Планёрка', start.toISO(), start.plus({ hours: 1 }).toISO());
  const nowRef = { t: DateTime.fromISO('2026-07-22T12:00:20', { zone: 'Europe/Moscow' }).toMillis() };
  const deps = makeDeps({ gcalOpts: { events: [ev] } });
  const sched = schedDeps(deps, nowRef);

  await sched.tick(); // t-4:50 до старта → в окне [4:30,5:30) → шлём
  const reminders = deps.tg.sent.filter((m) => m.html.includes('🔔'));
  assert.equal(reminders.length, 1);
  assert.ok(reminders[0].html.startsWith('<b>🔔 Встреча через 5 минут!</b>'));

  nowRef.t += 60_000; // следующая минута, всё ещё близко к окну
  await sched.tick();
  assert.equal(deps.tg.sent.filter((m) => m.html.includes('🔔')).length, 1); // дубля нет
});

test('напоминания за час и за сутки', async () => {
  const start = DateTime.fromISO('2026-07-23T13:00:00', { zone: 'Europe/Moscow' });
  const ev = rawEvent('r2', 'Демо', start.toISO(), start.plus({ hours: 1 }).toISO());

  // за сутки
  let nowRef = { t: start.minus({ minutes: 1440 }).toMillis() };
  let deps = makeDeps({ gcalOpts: { events: [ev] } });
  let sched = schedDeps(deps, nowRef);
  await sched.tick();
  assert.ok(deps.tg.sent.some((m) => m.html.startsWith('<b>🔔 Встреча через сутки!</b>')));

  // за час
  nowRef = { t: start.minus({ minutes: 60 }).toMillis() };
  deps = makeDeps({ gcalOpts: { events: [ev] } });
  sched = schedDeps(deps, nowRef);
  await sched.tick();
  assert.ok(deps.tg.sent.some((m) => m.html.startsWith('<b>🔔 Встреча через час!</b>')));
});

test('п.14: утренний план в 08:00 — один раз за день, повтор тика не дублирует', async () => {
  const ev = rawEvent('m1', 'Планёрка', '2026-07-22T10:00:00', '2026-07-22T11:00:00');
  const nowRef = { t: DateTime.fromISO('2026-07-22T08:02:00', { zone: 'Europe/Moscow' }).toMillis() };
  const deps = makeDeps({ gcalOpts: { events: [ev] } });
  const sched = schedDeps(deps, nowRef);

  await sched.tick();
  const mornings = deps.tg.sent.filter((m) => m.html.startsWith('🗒 <b>Расписание на сегодня</b>'));
  assert.equal(mornings.length, 1);
  assert.ok(mornings[0].html.includes('Планёрка'));

  nowRef.t += 60_000;
  await sched.tick();
  assert.equal(deps.tg.sent.filter((m) => m.html.startsWith('🗒 <b>Расписание на сегодня</b>')).length, 1);
});

test('утро вне окна (08:20) не шлётся; пустой день — особый текст', async () => {
  const nowRef = { t: DateTime.fromISO('2026-07-22T08:20:00', { zone: 'Europe/Moscow' }).toMillis() };
  const deps = makeDeps({});
  const sched = schedDeps(deps, nowRef);
  await sched.tick();
  assert.equal(deps.tg.sent.length, 0);

  // а в 08:03 пустой день даёт «Отличный день для глубокой работы»
  const nowRef2 = { t: DateTime.fromISO('2026-07-22T08:03:00', { zone: 'Europe/Moscow' }).toMillis() };
  const deps2 = makeDeps({});
  const sched2 = schedDeps(deps2, nowRef2);
  await sched2.tick();
  assert.ok(deps2.tg.sent.at(-1).html.includes('<i>Встреч нет. Отличный день для глубокой работы.</i>'));
});

test('план недели: понедельник 09:00 один раз; вторник — нет', async () => {
  const ev = rawEvent('w1', 'Планёрка', '2026-07-20T10:00:00', '2026-07-20T11:00:00');
  const monday = { t: DateTime.fromISO('2026-07-20T09:01:00', { zone: 'Europe/Moscow' }).toMillis() };
  const deps = makeDeps({ gcalOpts: { events: [ev] } });
  const sched = schedDeps(deps, monday);
  await sched.tick();
  const weeks = deps.tg.sent.filter((m) => m.html.startsWith('🗒 <b>Расписание на 20–26 июля 2026</b>'));
  assert.equal(weeks.length, 1);

  monday.t += 60_000;
  await sched.tick();
  assert.equal(deps.tg.sent.filter((m) => m.html.startsWith('🗒 <b>Расписание на 20–26 июля 2026</b>')).length, 1);

  // вторник 09:00 — ничего
  const tue = { t: DateTime.fromISO('2026-07-21T09:01:00', { zone: 'Europe/Moscow' }).toMillis() };
  const deps2 = makeDeps({});
  const sched2 = schedDeps(deps2, tue);
  await sched2.tick();
  assert.equal(deps2.tg.sent.filter((m) => m.html.includes('Расписание на 2')).length, 0);
});
