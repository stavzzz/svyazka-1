// Планировщики (ТЗ §9): тикер раз в минуту.
// Напоминания за сутки/час/5 минут — окна-ИНТЕРВАЛЫ (дрейф не страшен);
// кэш раз в час; план дня 08:00; план недели Пн 09:00. Гейты — в зоне календаря.
import { DateTime } from 'luxon';
import * as R from './render.js';
import { rangeFor, fmtDayHeader, fmtDayShort } from './dates.js';
import { normEvent, viewFromEvent, lineFromEvent } from './views.js';
import { TIER_MINUTES, TIER_LABELS } from './render.js';

const MIN = 60_000;

export function createScheduler(deps) {
  const { tg, gcal, state, cfg, refreshCache, now = () => Date.now() } = deps;
  const calTz = () => state.data.cache.tz || cfg.fallbackTz;

  async function sendDay(header, { morning = false } = {}) {
    const range = rangeFor('today', {}, calTz(), now());
    const events = (await gcal.listEvents(range.start.toUTC().toISO(), range.end.toUTC().toISO()))
      .map(normEvent).filter((e) => e.status !== 'cancelled');
    const lines = events.map((e) => lineFromEvent(e, calTz()));
    const html = morning
      ? R.rMorning(fmtDayHeader(range.start), lines)
      : R.rDaySchedule(header, fmtDayHeader(range.start), lines);
    await tg.send(cfg.ownerChatId, html);
  }

  async function sendWeek() {
    const range = rangeFor('week', {}, calTz(), now());
    const events = (await gcal.listEvents(range.start.toUTC().toISO(), range.end.toUTC().toISO()))
      .map(normEvent).filter((e) => e.status !== 'cancelled');
    const days = [];
    for (let d = range.start; d < range.end; d = d.plus({ days: 1 })) {
      const dayEvents = events.filter((e) => DateTime.fromMillis(e.startMs, { zone: calTz() }).hasSame(d, 'day'));
      if (dayEvents.length) days.push({ hdr: fmtDayShort(d), lines: dayEvents.map((e) => lineFromEvent(e, calTz())) });
    }
    await tg.send(cfg.ownerChatId, R.rWeekSchedule(range.header, days));
  }

  async function tick() {
    const nowMs = now();
    try { state.sweep(nowMs); } catch (e) { console.error('sweep:', e.message); }

    // Кэш раз в час
    if (nowMs - (state.data.cache.fetchedAt || 0) > 55 * MIN) {
      try { await refreshCache(); } catch (e) { console.error('cache refresh:', e.message); }
    }

    // Напоминания по кэшу — ярусы из настроек (/reminders), окна-интервалы ±30 сек
    const s = state.data.settings;
    for (const ev of state.data.cache.events) {
      if (ev.status === 'cancelled' || ev.allDay) continue;
      const delta = ev.startMs - nowMs;
      for (const m of TIER_MINUTES) {
        if (!s.tiers[m]) continue;
        if (delta >= (m - 0.5) * MIN && delta < (m + 0.5) * MIN) {
          const label = TIER_LABELS[m];
          const k = `${ev.id}:${label}`;
          if (state.data.alerted[k]) continue;
          state.data.alerted[k] = nowMs;
          state.save();
          try {
            await tg.send(cfg.ownerChatId, R.rReminder(viewFromEvent(ev, calTz()), label));
          } catch (e) { console.error('reminder send:', e.message); }
        }
      }
    }

    // План дня (время и дни недели — из настроек; окно +5 мин, один раз в день)
    const local = DateTime.fromMillis(nowMs, { zone: calTz() });
    const today = local.toISODate();
    const [mh, mm] = s.morning.time.split(':').map(Number);
    if (s.morning.enabled && s.morning.days.includes(local.weekday) &&
        local.hour === mh && local.minute >= mm && local.minute <= mm + 5 &&
        state.data.lastMorning !== today) {
      state.data.lastMorning = today;
      state.save();
      try { await sendDay('на сегодня', { morning: true }); } catch (e) { console.error('morning:', e.message); }
    }

    // План недели по понедельникам (время — из настроек)
    const weekKey = `${local.weekYear}-W${String(local.weekNumber).padStart(2, '0')}`;
    const [wh, wm] = s.weekly.time.split(':').map(Number);
    if (s.weekly.enabled && local.weekday === 1 &&
        local.hour === wh && local.minute >= wm && local.minute <= wm + 5 &&
        state.data.lastWeekly !== weekKey) {
      state.data.lastWeekly = weekKey;
      state.save();
      try { await sendWeek(); } catch (e) { console.error('weekly:', e.message); }
    }
  }

  return { tick, sendDay, sendWeek };
}
