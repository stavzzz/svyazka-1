// Юнит-тесты модуля повторяющихся встреч (recur.js): RRULE, EXDATE,
// детерминированные парсеры фраз, описание серии, разворот экземпляров.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import {
  buildRecurrence, withExdates, parseRecurPhrase, parseRecurEnd,
  describeRecur, expandOccurrences, nextByday, normRecur,
} from '../src/recur.js';

const MSK = 'Europe/Moscow';
const dt = (iso) => DateTime.fromISO(iso, { zone: MSK });

// ── buildRecurrence ──────────────────────────────────────────────

test('buildRecurrence: weekly ПН+ПТ с UNTIL — конец дня в UTC', () => {
  const r = buildRecurrence(
    { freq: 'weekly', byday: ['MO', 'FR'], interval: 1, count: 0, untilISO: '2026-09-18' },
    dt('2026-07-27T11:00:00'),
  );
  // 2026-09-18 23:59:59 МСК (UTC+3) = 20:59:59 UTC
  assert.deepEqual(r, ['RRULE:FREQ=WEEKLY;BYDAY=MO,FR;UNTIL=20260918T205959Z']);
});

test('buildRecurrence: daily с COUNT', () => {
  const r = buildRecurrence({ freq: 'daily', byday: [], interval: 1, count: 10, untilISO: '' }, dt('2026-07-27T07:00:00'));
  assert.deepEqual(r, ['RRULE:FREQ=DAILY;COUNT=10']);
});

test('buildRecurrence: бессрочная weekly без byday и interval=2', () => {
  assert.deepEqual(
    buildRecurrence({ freq: 'weekly', byday: [], interval: 2, count: 0, untilISO: '' }, dt('2026-07-25T10:00:00')),
    ['RRULE:FREQ=WEEKLY;INTERVAL=2'],
  );
  assert.deepEqual(
    buildRecurrence({ freq: 'monthly', byday: [], interval: 1, count: 0, untilISO: '' }, dt('2026-07-05T10:00:00')),
    ['RRULE:FREQ=MONTHLY'],
  );
});

// ── withExdates ──────────────────────────────────────────────────

test('withExdates: добавляет EXDATE с TZID, несколько дат через запятую', () => {
  const rec = ['RRULE:FREQ=WEEKLY;BYDAY=MO,FR'];
  const out = withExdates(rec, [dt('2026-07-28T11:00:00'), dt('2026-08-03T11:00:00')]);
  assert.deepEqual(out, [
    'RRULE:FREQ=WEEKLY;BYDAY=MO,FR',
    'EXDATE;TZID=Europe/Moscow:20260728T110000,20260803T110000',
  ]);
});

test('withExdates: пустой список дат — recurrence не меняется', () => {
  assert.deepEqual(withExdates(['RRULE:FREQ=DAILY'], []), ['RRULE:FREQ=DAILY']);
});

// ── parseRecurPhrase ─────────────────────────────────────────────

test('parseRecurPhrase: каждый день / ежедневно', () => {
  assert.deepEqual(parseRecurPhrase('зарядка каждый день в 7'), { freq: 'daily', byday: [], interval: 1 });
  assert.deepEqual(parseRecurPhrase('ежедневно'), { freq: 'daily', byday: [], interval: 1 });
});

test('parseRecurPhrase: по будням', () => {
  assert.deepEqual(parseRecurPhrase('стендап по будням в 9:30'),
    { freq: 'weekly', byday: ['MO', 'TU', 'WE', 'TH', 'FR'], interval: 1 });
});

test('parseRecurPhrase: каждый ПН и ПТ (разные падежи и формы)', () => {
  assert.deepEqual(parseRecurPhrase('йога каждый понедельник и пятницу'),
    { freq: 'weekly', byday: ['MO', 'FR'], interval: 1 });
  assert.deepEqual(parseRecurPhrase('по понедельникам и пятницам'),
    { freq: 'weekly', byday: ['MO', 'FR'], interval: 1 });
  assert.deepEqual(parseRecurPhrase('каждую среду'),
    { freq: 'weekly', byday: ['WE'], interval: 1 });
});

test('parseRecurPhrase: каждую вторую субботу / раз в 2 недели', () => {
  assert.deepEqual(parseRecurPhrase('баня каждую вторую субботу'),
    { freq: 'weekly', byday: ['SA'], interval: 2 });
  assert.deepEqual(parseRecurPhrase('созвон раз в 2 недели'),
    { freq: 'weekly', byday: [], interval: 2 });
});

test('parseRecurPhrase: каждую неделю без дней / не повторение — null', () => {
  assert.deepEqual(parseRecurPhrase('планёрка каждую неделю'), { freq: 'weekly', byday: [], interval: 1 });
  assert.equal(parseRecurPhrase('поставь встречу завтра в 15'), null);
});

// ── parseRecurEnd ────────────────────────────────────────────────

test('parseRecurEnd: бессрочно', () => {
  assert.deepEqual(parseRecurEnd('бессрочно', dt('2026-07-27T11:00:00')), { none: true });
  assert.deepEqual(parseRecurEnd('без конца', dt('2026-07-27T11:00:00')), { none: true });
});

test('parseRecurEnd: N раз', () => {
  assert.deepEqual(parseRecurEnd('10 раз', dt('2026-07-27T11:00:00')), { count: 10 });
});

test('parseRecurEnd: до конца августа / до 15 сентября', () => {
  assert.deepEqual(parseRecurEnd('до конца августа', dt('2026-07-27T11:00:00')), { untilISO: '2026-08-31' });
  assert.deepEqual(parseRecurEnd('до 15 сентября', dt('2026-07-27T11:00:00')), { untilISO: '2026-09-15' });
});

test('parseRecurEnd: на 8 недель / на 2 месяца (включительно, минус день)', () => {
  assert.deepEqual(parseRecurEnd('на 8 недель', dt('2026-07-27T11:00:00')), { untilISO: '2026-09-20' });
  assert.deepEqual(parseRecurEnd('2 месяца', dt('2026-07-27T11:00:00')), { untilISO: '2026-09-26' });
});

test('parseRecurEnd: непонятный ответ → null', () => {
  assert.equal(parseRecurEnd('ну как пойдёт', dt('2026-07-27T11:00:00')), null);
});

// ── describeRecur ────────────────────────────────────────────────

test('describeRecur: еженедельно по дням с until и счётчиком занятий', () => {
  const s = describeRecur(
    { freq: 'weekly', byday: ['MO', 'FR'], interval: 1, count: 0, untilISO: '2026-09-18' },
    dt('2026-07-27T11:00:00'), 16,
  );
  assert.equal(s, 'еженедельно по ПН и ПТ · до ПТ, 18 сентября (16 занятий)');
});

test('describeRecur: ежедневно бессрочно / раз в 2 недели N раз', () => {
  assert.equal(
    describeRecur({ freq: 'daily', byday: [], interval: 1, count: 0, untilISO: '' }, dt('2026-07-27T07:00:00'), 0),
    'ежедневно · бессрочно');
  assert.equal(
    describeRecur({ freq: 'weekly', byday: ['SA'], interval: 2, count: 10, untilISO: '' }, dt('2026-07-25T10:00:00'), 10),
    'раз в 2 недели по СБ · 10 раз');
});

// ── expandOccurrences / nextByday ────────────────────────────────

test('expandOccurrences: weekly ПН+ПТ на 8 недель = 16 экземпляров, правильные дни', () => {
  const occ = expandOccurrences(
    { freq: 'weekly', byday: ['MO', 'FR'], interval: 1, count: 0, untilISO: '2026-09-20' },
    dt('2026-07-27T11:00:00'),
  );
  assert.equal(occ.length, 16);
  assert.equal(occ[0].toISODate(), '2026-07-27'); // ПН
  assert.equal(occ[1].toISODate(), '2026-07-31'); // ПТ
  assert.ok(occ.every((d) => [1, 5].includes(d.weekday)));
  assert.ok(occ.every((d) => d.toFormat('HH:mm') === '11:00'));
});

test('expandOccurrences: COUNT и cap для бессрочных', () => {
  const occ = expandOccurrences({ freq: 'daily', byday: [], interval: 1, count: 5, untilISO: '' }, dt('2026-07-27T07:00:00'));
  assert.equal(occ.length, 5);
  const endless = expandOccurrences({ freq: 'daily', byday: [], interval: 1, count: 0, untilISO: '' }, dt('2026-07-27T07:00:00'));
  assert.ok(endless.length <= 100); // горизонт 90 дней / cap 100
  assert.ok(endless.length >= 89);
});

test('nextByday: ближайший день из byday, включая сегодняшний', () => {
  // 2026-07-24 — пятница
  assert.equal(nextByday(dt('2026-07-24T10:00:00'), ['MO', 'FR']).toISODate(), '2026-07-24');
  assert.equal(nextByday(dt('2026-07-24T10:00:00'), ['MO']).toISODate(), '2026-07-27');
  assert.equal(nextByday(dt('2026-07-24T10:00:00'), []).toISODate(), '2026-07-24');
});

// ── normRecur (вход от классификатора) ───────────────────────────

test('normRecur: строковые поля классификатора → числа, мусор отсекается', () => {
  assert.deepEqual(
    normRecur({ freq: 'weekly', byday: ['MO', 'XX', 'FR'], interval: '2', count: '', until: '2026-09-18' }),
    { freq: 'weekly', byday: ['MO', 'FR'], interval: 2, count: 0, untilISO: '2026-09-18' });
  assert.equal(normRecur({ freq: 'yearly' }), null); // неизвестная частота
  assert.deepEqual(normRecur({ freq: '' }), { freq: '', byday: [], interval: 1, count: 0, untilISO: '' }); // «серия, спросить детали»
  assert.equal(normRecur(undefined), null);
});
