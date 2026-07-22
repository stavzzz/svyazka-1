// Диапазоны дат для 7 интентов расписания + русские форматы дат.
// Все расчёты — в зоне календаря, от переданного now (детерминизм в тестах).
import { DateTime } from 'luxon';

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD_ABBR = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС']; // luxon weekday 1..7
const WD_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const WD_ACCUSATIVE = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];

export function fmtDateRu(dt) { // '13 июля 2026'
  return `${dt.day} ${MONTHS_GEN[dt.month - 1]} ${dt.year}`;
}
export function fmtDayHeader(dt) { // 'ПН, 13 июля 2026'
  return `${WD_ABBR[dt.weekday - 1]}, ${fmtDateRu(dt)}`;
}
export function fmtDayShort(dt) { // 'ПН, 13 июля' (группировка недели)
  return `${WD_ABBR[dt.weekday - 1]}, ${dt.day} ${MONTHS_GEN[dt.month - 1]}`;
}
export function weekdayFull(dt) { return WD_FULL[dt.weekday - 1]; }
export function weekdayAccusative(i) { return WD_ACCUSATIVE[i]; } // 0=пн

// 'на 13–19 июля 2026' | 'на 28 июля – 3 августа 2026'
export function fmtWeekRange(a, b) {
  if (a.month === b.month) return `${a.day}–${b.day} ${MONTHS_GEN[a.month - 1]} ${a.year}`;
  if (a.year === b.year) return `${a.day} ${MONTHS_GEN[a.month - 1]} – ${b.day} ${MONTHS_GEN[b.month - 1]} ${a.year}`;
  return `${a.day} ${MONTHS_GEN[a.month - 1]} ${a.year} – ${b.day} ${MONTHS_GEN[b.month - 1]} ${b.year}`;
}

// intent: today|tomorrow|day_after_tomorrow|weekday|week|next_week|specific_date
// opts: {date?: 'YYYY-MM-DD'} для weekday/specific_date
// → {start: DateTime, end: DateTime (exclusive), header: 'на …', kind: 'day'|'week'}
export function rangeFor(intent, opts, tz, nowMs) {
  const now = DateTime.fromMillis(nowMs, { zone: tz });
  const day0 = now.startOf('day');
  const mk = (d, header) => ({ start: d, end: d.plus({ days: 1 }), header, kind: 'day' });

  switch (intent) {
    case 'today': return mk(day0, 'на сегодня');
    case 'tomorrow': return mk(day0.plus({ days: 1 }), 'на завтра');
    case 'day_after_tomorrow': return mk(day0.plus({ days: 2 }), 'на послезавтра');
    case 'weekday': {
      const d = DateTime.fromISO(opts.date, { zone: tz }).startOf('day');
      return mk(d, `на ${weekdayFull(d)}, ${fmtDateRu(d)}`);
    }
    case 'specific_date': {
      const d = DateTime.fromISO(opts.date, { zone: tz }).startOf('day');
      return mk(d, `на ${fmtDayHeader(d)}`);
    }
    case 'week': {
      const start = day0.minus({ days: day0.weekday - 1 });
      const end = start.plus({ days: 7 });
      return { start, end, header: `на ${fmtWeekRange(start, end.minus({ days: 1 }))}`, kind: 'week' };
    }
    case 'next_week': {
      const start = day0.minus({ days: day0.weekday - 1 }).plus({ days: 7 });
      const end = start.plus({ days: 7 });
      return { start, end, header: `на следующую неделю (${fmtWeekRange(start, end.minus({ days: 1 }))})`, kind: 'week' };
    }
    default: throw new Error(`unknown range intent: ${intent}`);
  }
}
