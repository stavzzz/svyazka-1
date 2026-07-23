// Юнит-тесты: tz, dates, conflict, timeparse, state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';

import { detectCity, zoneLabel, gmtLabel, getClock } from '../src/tz.js';
import { rangeFor, fmtDateRu, fmtDayHeader, fmtWeekRange } from '../src/dates.js';
import { findConflicts } from '../src/conflict.js';
import { parseWhen } from '../src/timeparse.js';
import { createState, newPendingKey } from '../src/state.js';
import { viewFromEvent } from '../src/views.js';

// Фиксированное «сейчас»: среда 22 июля 2026, 12:00 МСК
const NOW = DateTime.fromISO('2026-07-22T12:00:00', { zone: 'Europe/Moscow' }).toMillis();

// ── tz ──────────────────────────────────────────────────────────
test('detectCity: «по Москве», МСК, ЕКБ, Тбилиси', () => {
  assert.equal(detectCity('встреча завтра в 15:00 по Москве').tz, 'Europe/Moscow');
  assert.equal(detectCity('на 14 МСК').tz, 'Europe/Moscow');
  assert.equal(detectCity('переключи на ЕКБ').tz, 'Asia/Yekaterinburg');
  assert.equal(detectCity('я в Тбилиси').name, 'Тбилиси');
  assert.equal(detectCity('лечу в Дубай').tz, 'Asia/Dubai');
});

test('detectCity: граница слова — «Ижевск» не ловится внутри слова', () => {
  assert.equal(detectCity('пижевский формат'), null);
  assert.equal(detectCity('снижевск'), null);
  assert.ok(detectCity('в Ижевске'));
});

test('detectCity: пустой/без города → null', () => {
  assert.equal(detectCity('встреча с Иваном завтра'), null);
  assert.equal(detectCity(''), null);
});

test('zoneLabel и gmtLabel', () => {
  assert.equal(zoneLabel('Europe/Moscow', NOW), 'МСК');
  assert.equal(zoneLabel('Asia/Tbilisi', NOW), 'Тбилиси');
  assert.equal(zoneLabel('Europe/Kaliningrad', NOW), 'GMT+02:00'); // нет в списке → офсет
  assert.equal(gmtLabel('Europe/Moscow', NOW), 'GMT+03:00');
  assert.equal(gmtLabel('America/New_York', NOW), 'GMT-04:00'); // летом EDT
});

test('getClock', () => {
  assert.equal(getClock('11:00'), '🕚');
  assert.equal(getClock('14:30'), '🕑');
  assert.equal(getClock('00:15'), '🕛');
});

// ── dates ───────────────────────────────────────────────────────
test('rangeFor: сегодня/завтра/послезавтра', () => {
  const tz = 'Europe/Moscow';
  const t = rangeFor('today', {}, tz, NOW);
  assert.equal(t.start.toISODate(), '2026-07-22');
  assert.equal(t.header, 'на сегодня');
  assert.equal(rangeFor('tomorrow', {}, tz, NOW).start.toISODate(), '2026-07-23');
  assert.equal(rangeFor('day_after_tomorrow', {}, tz, NOW).start.toISODate(), '2026-07-24');
});

test('rangeFor: эта неделя ПН–ВС и заголовок', () => {
  const r = rangeFor('week', {}, 'Europe/Moscow', NOW);
  assert.equal(r.start.toISODate(), '2026-07-20'); // понедельник
  assert.equal(r.end.toISODate(), '2026-07-27');   // exclusive
  assert.equal(r.header, 'на 20–26 июля 2026');
});

test('rangeFor: следующая неделя (кросс-месяц)', () => {
  const r = rangeFor('next_week', {}, 'Europe/Moscow', NOW);
  assert.equal(r.start.toISODate(), '2026-07-27');
  assert.equal(r.header, 'на следующую неделю (27 июля – 2 августа 2026)');
});

test('rangeFor: weekday и specific_date заголовки', () => {
  const w = rangeFor('weekday', { date: '2026-07-27' }, 'Europe/Moscow', NOW);
  assert.equal(w.header, 'на понедельник, 27 июля 2026');
  const s = rangeFor('specific_date', { date: '2026-07-20' }, 'Europe/Moscow', NOW);
  assert.equal(s.header, 'на ПН, 20 июля 2026');
});

test('fmtDateRu/fmtDayHeader/fmtWeekRange', () => {
  const d = DateTime.fromISO('2026-07-13', { zone: 'Europe/Moscow' });
  assert.equal(fmtDateRu(d), '13 июля 2026');
  assert.equal(fmtDayHeader(d), 'ПН, 13 июля 2026');
  assert.equal(fmtWeekRange(d, d.plus({ days: 6 })), '13–19 июля 2026');
});

// ── conflict ────────────────────────────────────────────────────
test('findConflicts: формула пересечения интервалов', () => {
  const evs = [
    { id: '1', summary: 'A', startMs: 100, endMs: 200, status: 'confirmed' },
    { id: '2', summary: 'B', startMs: 300, endMs: 400, status: 'confirmed' },
    { id: '3', summary: 'C', startMs: 150, endMs: 250, status: 'cancelled' },
  ];
  assert.deepEqual(findConflicts(150, 250, evs).map((e) => e.id), ['1']); // cancelled пропущен
  assert.deepEqual(findConflicts(200, 300, evs).map((e) => e.id), []);   // впритык — не конфликт
  assert.deepEqual(findConflicts(150, 350, evs).map((e) => e.id), ['1', '2']);
  assert.deepEqual(findConflicts(150, 350, evs, '1').map((e) => e.id), ['2']); // exceptId
});

// ── timeparse ───────────────────────────────────────────────────
test('parseWhen: HH:MM и «на 14 МСК»', () => {
  assert.equal(parseWhen('в 15:30', 'Europe/Moscow', NOW).time, '15:30');
  const p = parseWhen('на 14 МСК', 'Europe/Moscow', NOW);
  assert.equal(p.time, '14:00');
  assert.equal(p.tz, 'Europe/Moscow');
});

test('parseWhen: «в пятницу 20:00» → ближайшая будущая пятница', () => {
  const p = parseWhen('в пятницу 20:00', 'Europe/Moscow', NOW);
  assert.equal(p.time, '20:00');
  assert.equal(p.date, '2026-07-24');
});

test('parseWhen: «завтра в 15:30»', () => {
  const p = parseWhen('завтра в 15:30', 'Europe/Moscow', NOW);
  assert.equal(p.date, '2026-07-23');
  assert.equal(p.time, '15:30');
});

test('parseWhen: дефект №6 — «в 2026 году» не даёт время', () => {
  assert.equal(parseWhen('в 2026 году', 'Europe/Moscow', NOW), null);
});

test('parseWhen: «на 9 утра по Москве» и «в 9 вечера»', () => {
  assert.equal(parseWhen('на 9 утра по Москве', 'Europe/Moscow', NOW).time, '09:00');
  assert.equal(parseWhen('в 9 вечера', 'Europe/Moscow', NOW).time, '21:00');
});

test('parseWhen: мусор → null', () => {
  assert.equal(parseWhen('привет как дела', 'Europe/Moscow', NOW), null);
});

// ── state ───────────────────────────────────────────────────────
test('state: sweep чистит pending>1ч и alerted>24ч', () => {
  const dir = mkdtempSync(join(tmpdir(), 'secbot-'));
  const st = createState(join(dir, 'state.json'));
  st.data.pending['1'] = { key: 'k', createdAt: NOW - 3700_000 };
  st.data.pending['2'] = { key: 'k2', createdAt: NOW - 100_000 };
  st.data.alerted['e:5 минут'] = NOW - 25 * 3600_000;
  st.data.alerted['e2:час'] = NOW - 1000;
  st.sweep(NOW);
  assert.equal(st.data.pending['1'], undefined);
  assert.ok(st.data.pending['2']);
  assert.equal(st.data.alerted['e:5 минут'], undefined);
  assert.ok(st.data.alerted['e2:час']);
});

test('newPendingKey: формат <chat_id>_<8 симв>, ≤64 байта, без кириллицы', () => {
  const k = newPendingKey(111111111);
  assert.match(k, /^111111111_[A-Za-z0-9_-]{8}$/);
  assert.ok(Buffer.byteLength(`cal:reschedule:${k}`) <= 64);
});

// ── views: день недели в датах карточек (правка Стаса 2026-07-23) ──
test('viewFromEvent: dateRu содержит день недели', () => {
  const v = viewFromEvent({
    id: 'x', summary: 'Тест', allDay: false, status: 'confirmed',
    startMs: DateTime.fromISO('2026-07-26T11:00', { zone: 'Asia/Tbilisi' }).toMillis(),
    endMs: DateTime.fromISO('2026-07-26T13:00', { zone: 'Asia/Tbilisi' }).toMillis(),
    tz: 'Asia/Tbilisi', attendees: [], description: '', location: '', meet: '', zoom: '', htmlLink: '',
  }, 'Asia/Tbilisi');
  assert.equal(v.dateRu, 'ВС, 26 июля 2026');
});

// ── Правка 23.07: telegram.edit молчит про «message is not modified» ──
test('edit: «message is not modified» глотается без console.error, прочие 400 — логируются', async () => {
  const { createTelegram } = await import('../src/telegram.js');
  const mk = (desc) => createTelegram({
    token: 't',
    fetchFn: async () => ({ status: 400, json: async () => ({ ok: false, description: desc }) }),
  });
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  try {
    assert.equal(await mk('Bad Request: message is not modified: ...').edit(1, 2, 'x'), null);
    assert.equal(errs.length, 0);
    assert.equal(await mk('Bad Request: chat not found').edit(1, 2, 'x'), null);
    assert.equal(errs.length, 1);
  } finally { console.error = orig; }
});

// ── Правка 23.07 (вечер): база городов мира + явные GMT-офсеты ──
test('detectCity: новые города мира', () => {
  assert.equal(detectCity('поставь по времени Хошимина').tz, 'Asia/Ho_Chi_Minh');
  assert.equal(detectCity('по времени Сан-Паулу').tz, 'America/Sao_Paulo');
  assert.equal(detectCity('в Катманду').tz, 'Asia/Kathmandu');
  assert.equal(detectCity('я на Бали').tz, 'Asia/Makassar');
  assert.equal(detectCity('прилетел в Сеул').tz, 'Asia/Seoul');
  assert.equal(detectCity('по Мадриду').tz, 'Europe/Madrid');
  assert.equal(detectCity('встреча в Мехико').tz, 'America/Mexico_City');
  assert.equal(detectCity('лечу в Стамбул').tz, 'Europe/Istanbul');
  assert.equal(detectCity('созвон по Сингапуру').tz, 'Asia/Singapore');
  assert.equal(detectCity('в Буэнос-Айресе').tz, 'America/Argentina/Buenos_Aires');
});

test('detectCity: явный офсет GMT+5 / UTC-3 / GMT+5:30', () => {
  assert.equal(detectCity('поставь на 14 по GMT+5').tz, 'UTC+5');
  assert.equal(detectCity('utc-3 пожалуйста').tz, 'UTC-3');
  assert.equal(detectCity('по GMT+5:30').tz, 'UTC+5:30');
  assert.equal(detectCity('просто gmt').tz, 'Europe/London'); // без знака — Лондон, как раньше
  const dt = DateTime.fromMillis(NOW, { zone: 'UTC+5' });
  assert.equal(dt.isValid, true);
});

test('detectCity: новые стемы не дают ложных срабатываний', () => {
  assert.equal(detectCity('прочитать властелин колец'), null);
  assert.equal(detectCity('обсуждение договоров'), null);
  assert.equal(detectCity('лимонад и карамель'), null);
  assert.equal(detectCity('пергола на веранде'), null);
  assert.equal(detectCity('чтение книги'), null);
});

// ── Правка 23.07 (ночь-2): города с дефисом — слитно и через пробел ──
test('detectCity: НьюЙорка/Нью Йорка/Лос Анджелес/ТельАвив распознаются', () => {
  assert.equal(detectCity('на 17:00 по времени НьюЙорка').tz, 'America/New_York');
  assert.equal(detectCity('по времени Нью Йорка').tz, 'America/New_York');
  assert.equal(detectCity('в Лос Анджелесе').tz, 'America/Los_Angeles');
  assert.equal(detectCity('по ТельАвиву').tz, 'Asia/Jerusalem');
  assert.equal(detectCity('в Сан Франциско').tz, 'America/Los_Angeles');
  assert.equal(detectCity('по Нью-Йорку').tz, 'America/New_York'); // дефис по-прежнему работает
  assert.equal(detectCity('просто gmt').tz, 'Europe/London');      // gmt(?![+-]) не сломан
});
