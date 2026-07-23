// Моки зависимостей для интеграционных тестов router/scheduler.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { createState } from '../src/state.js';

export const NOW = DateTime.fromISO('2026-07-22T12:00:00', { zone: 'Europe/Moscow' }).toMillis();
export const OWNER = 83494179;

// Telegram-мок: копит отправки, выдаёт message_id.
export function mockTg() {
  const sent = [];
  const edits = [];
  let nextId = 1000;
  return {
    sent,
    edits,
    async send(chatId, html, opts = {}) {
      const m = { chatId, html, opts, message_id: ++nextId };
      sent.push(m);
      return m;
    },
    async edit(chatId, messageId, html, opts = {}) {
      const m = { chatId, messageId, html, opts };
      edits.push(m);
      return m;
    },
    typingCalls: 0,
    async typing() { this.typingCalls++; },
    async answerCallback() {},
    async getVoice() { return Buffer.from('fake'); },
  };
}

// Google Calendar-мок: события в памяти, генерирует Meet-ссылки.
export function mockGcal({ tz = 'Europe/Moscow', events = [] } = {}) {
  let idc = 0;
  const store = [...events]; // «сырые» события Google
  const api = {
    store,
    tz,
    calls: [],
    async getCalendarTz() { return api.tz; },
    async setCalendarTz(newTz) { api.tz = newTz; api.calls.push(['setTz', newTz]); },
    async listEvents(minISO, maxISO) {
      const a = DateTime.fromISO(minISO).toMillis();
      const b = DateTime.fromISO(maxISO).toMillis();
      // Как Google с singleEvents=true: мастера серий (с recurrence) в списках нет
      return store.filter((e) => {
        if (e.recurrence) return false;
        const s = DateTime.fromISO(e.start.dateTime || e.start.date).toMillis();
        return s >= a && s < b;
      });
    },
    async getEvent(id) {
      const raw = store.find((e) => e.id === id);
      if (!raw) throw new Error('404');
      return raw;
    },
    async createEvent(ev, opts = {}) {
      const id = `ev${++idc}`;
      const raw = {
        id,
        summary: ev.summary,
        start: { dateTime: ev.startISO, timeZone: ev.tz },
        end: { dateTime: ev.endISO, timeZone: ev.tz },
        status: 'confirmed',
        htmlLink: `https://cal/${id}`,
        attendees: (ev.attendees || []).map((e) => ({ email: e })),
        location: ev.location || undefined,
        description: ev.description || undefined,
        recurrence: ev.recurrence || undefined,
        hangoutLink: opts.meet === false ? undefined : `https://meet.google.com/${id}`,
      };
      store.push(raw);
      api.calls.push(['create', raw]);
      // Серия: как Google — разворачиваем экземпляры в список (первые 10 достаточно)
      if (raw.recurrence) expandMockSeries(store, raw);
      return raw;
    },
    async patchEvent(id, patch) {
      const raw = store.find((e) => e.id === id);
      if (!raw) throw new Error('404');
      if (patch.summary) raw.summary = patch.summary;
      if (patch.start) raw.start = { dateTime: patch.start.dateTime, timeZone: patch.start.timeZone };
      if (patch.end) raw.end = { dateTime: patch.end.dateTime, timeZone: patch.end.timeZone };
      if (patch.attendees) raw.attendees = patch.attendees;
      if (patch.description !== undefined) raw.description = patch.description;
      if (patch.recurrence) raw.recurrence = patch.recurrence;
      api.calls.push(['patch', id, patch]);
      return raw;
    },
    async deleteEvent(id) {
      const i = store.findIndex((e) => e.id === id);
      if (i < 0) throw new Error('gcal DELETE: 410 Resource has been deleted');
      store.splice(i, 1);
      // Как Google: удаление мастера каскадно сносит экземпляры серии
      for (let j = store.length - 1; j >= 0; j--) {
        if (store[j].recurringEventId === id) store.splice(j, 1);
      }
      api.calls.push(['delete', id]);
    },
  };
  return api;
}

export function mockZoom({ enabled = true } = {}) {
  let n = 0;
  return {
    enabled,
    calls: [],
    async createMeeting(topic, start, dur, tz) {
      this.calls.push([topic, start, dur, tz]);
      return { joinUrl: `https://zoom.us/j/${++n}00`, meetingId: n };
    },
  };
}

// Классификатор-мок: детерминированная карта фраза→объект.
export function mockClassifier(map) {
  return {
    async classify(text) {
      for (const [k, v] of Object.entries(map)) {
        if (text.includes(k)) return structuredClone(v);
      }
      return { intent: 'other' };
    },
    async freeAnswer() { return 'свободный ответ'; },
  };
}

export function freshState() {
  const dir = mkdtempSync(join(tmpdir(), 'secbot-'));
  return createState(join(dir, 'state.json'));
}

export function makeDeps({ classifierMap = {}, gcalOpts = {}, nowMs = NOW } = {}) {
  const tg = mockTg();
  const gcal = mockGcal(gcalOpts);
  const zoom = mockZoom();
  const state = freshState();
  const cfg = { ownerChatId: OWNER, fallbackTz: 'Europe/Moscow' };
  return {
    tg, gcal, zoom, state, cfg,
    classifier: mockClassifier(classifierMap),
    transcriber: { async transcribe() { return 'голосовой текст'; } },
    now: () => nowMs,
  };
}

export const msg = (text, extra = {}) => ({
  message: { chat: { id: OWNER }, from: { id: OWNER }, text, message_id: 1, ...extra },
});
export const cb = (data) => ({
  callback_query: { id: 'cbq1', data, from: { id: OWNER }, message: { chat: { id: OWNER } } },
});

// Сырое событие Google для фикстур.
export function rawEvent(id, summary, startISO, endISO, { tz = 'Europe/Moscow', status = 'confirmed', description } = {}) {
  return {
    id, summary, status,
    start: { dateTime: DateTime.fromISO(startISO, { zone: tz }).toISO(), timeZone: tz },
    end: { dateTime: DateTime.fromISO(endISO, { zone: tz }).toISO(), timeZone: tz },
    htmlLink: `https://cal/${id}`,
    description,
  };
}

// Экземпляр серии (как отдаёт singleEvents=true): id мастера + recurringEventId.
export function rawRecurInstance(masterId, summary, startISO, endISO, { tz = 'Europe/Moscow' } = {}) {
  const stamp = DateTime.fromISO(startISO, { zone: tz }).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  return { ...rawEvent(`${masterId}_${stamp}`, summary, startISO, endISO, { tz }), recurringEventId: masterId };
}

// Мастер серии (в списках не появляется — только через getEvent).
export function rawRecurMaster(id, summary, startISO, endISO, recurrence, { tz = 'Europe/Moscow', attendees = [] } = {}) {
  return { ...rawEvent(id, summary, startISO, endISO, { tz }), recurrence, attendees: attendees.map((e) => ({ email: e })) };
}

// Разворот серии в моке (упрощённо: weekly по BYDAY / daily, до 10 экземпляров).
function expandMockSeries(store, master) {
  const tz = master.start.timeZone || 'Europe/Moscow';
  const rrule = (master.recurrence || []).find((s) => s.startsWith('RRULE')) || '';
  const exdate = (master.recurrence || []).find((s) => s.startsWith('EXDATE')) || '';
  const excluded = new Set((exdate.split(':')[1] || '').split(',').filter(Boolean));
  const s0 = DateTime.fromISO(master.start.dateTime, { zone: tz });
  const e0 = DateTime.fromISO(master.end.dateTime, { zone: tz });
  const durMs = e0.toMillis() - s0.toMillis();
  const byday = (/BYDAY=([^;]+)/.exec(rrule)?.[1] || '').split(',').filter(Boolean);
  const codes = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
  const wanted = new Set(byday.map((c) => codes[c]).filter(Boolean));
  const count = parseInt(/COUNT=(\d+)/.exec(rrule)?.[1], 10) || 10;
  let made = 0;
  for (let d = s0; made < Math.min(count, 10); d = d.plus({ days: 1 })) {
    if (wanted.size && !wanted.has(d.weekday)) continue;
    if (excluded.has(d.toFormat("yyyyMMdd'T'HHmmss"))) { continue; }
    store.push({
      ...master,
      id: `${master.id}_${d.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`,
      recurrence: undefined,
      recurringEventId: master.id,
      start: { dateTime: d.toISO(), timeZone: tz },
      end: { dateTime: DateTime.fromMillis(d.toMillis() + durMs, { zone: tz }).toISO(), timeZone: tz },
    });
    made++;
  }
}
