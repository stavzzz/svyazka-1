// Парсер времени из свободного текста (ответы на forceReply: уточнение/перенос).
// ТЗ §9 оригинала + дефект №6: одиночное число берём ТОЛЬКО с явным предлогом
// («на 14», «в 9») и только 1–2 цифры («в 2026 году» не ловится).
import { DateTime } from 'luxon';
import { detectCity } from './tz.js';

const WEEKDAYS = [
  ['понедельник', 1], ['вторник', 2], ['сред', 3], ['четверг', 4],
  ['пятниц', 5], ['суббот', 6], ['воскресень', 7],
];

// → {time:'HH:MM'|null, tz:string|null, date:'YYYY-MM-DD'|null} | null (ничего не понял)
export function parseWhen(text, baseTz, nowMs) {
  if (!text) return null;
  const t = text.toLowerCase();
  const out = { time: null, tz: null, date: null };

  // 1) Время 'HH:MM' / 'HH.MM'
  let m = t.match(/(?<!\d)(\d{1,2})[:.](\d{2})(?!\d)/);
  if (m) {
    const h = +m[1], min = +m[2];
    if (h <= 23 && min <= 59) out.time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  // 2) Одиночный час с предлогом: «на 14», «в 9» (+ «утра/дня/вечера/ночи»)
  if (!out.time) {
    m = t.match(/(?:^|\s)(?:в|на|к)\s+(\d{1,2})(?!\d)(?:\s*(утра|дня|вечера|ночи))?/);
    if (m) {
      let h = +m[1];
      const suffix = m[2] || '';
      if ((suffix === 'дня' || suffix === 'вечера') && h < 12) h += 12;
      if (h <= 23) out.time = `${String(h).padStart(2, '0')}:00`;
    }
  }

  // 3) Зона по городу
  const city = detectCity(t);
  if (city) out.tz = city.tz;

  // 4) День
  const base = DateTime.fromMillis(nowMs, { zone: baseTz }).startOf('day');
  if (/(?:^|\s)сегодня/.test(t)) out.date = base.toISODate();
  else if (/(?:^|\s)послезавтра/.test(t)) out.date = base.plus({ days: 2 }).toISODate();
  else if (/(?:^|\s)завтра/.test(t)) out.date = base.plus({ days: 1 }).toISODate();
  else {
    for (const [stem, wd] of WEEKDAYS) {
      if (t.includes(stem)) {
        // ближайший будущий такой день, «сегодня» не считается
        let diff = (wd - base.weekday + 7) % 7;
        if (diff === 0) diff = 7;
        out.date = base.plus({ days: diff }).toISODate();
        break;
      }
    }
  }

  if (!out.time && !out.date && !out.tz) return null;
  return out;
}
