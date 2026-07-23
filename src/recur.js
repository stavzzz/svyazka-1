// Повторяющиеся встречи: RRULE/EXDATE для Google Calendar API, детерминированные
// парсеры фраз («каждый ПН и ПТ», «до конца августа») и описание серии по-русски.
// Классификатор только выделяет поля — вся математика дат здесь, на luxon.
import { DateTime } from 'luxon';
import { fmtDayShort } from './dates.js';

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']; // luxon weekday 1..7
const BYDAY_RU = { MO: 'ПН', TU: 'ВТ', WE: 'СР', TH: 'ЧТ', FR: 'ПТ', SA: 'СБ', SU: 'ВС' };
const FREQS = new Set(['daily', 'weekly', 'monthly']);

// recur от классификатора (строки) → нормальная структура; мусор → null.
// {freq:''} — валидный маркер «пользователь сказал „повторяющуюся“, детали спросить».
export function normRecur(c) {
  if (!c || typeof c !== 'object') return null;
  const freq = (c.freq || '').toLowerCase();
  if (freq !== '' && !FREQS.has(freq)) return null;
  const interval = Math.max(1, parseInt(c.interval, 10) || 1);
  const count = Math.max(0, parseInt(c.count, 10) || 0);
  const untilISO = /^\d{4}-\d{2}-\d{2}$/.test(c.until || c.untilISO || '') ? (c.until || c.untilISO) : '';
  const byday = (Array.isArray(c.byday) ? c.byday : [])
    .map((d) => String(d).toUpperCase()).filter((d) => BYDAY.includes(d))
    .sort((a, b) => BYDAY.indexOf(a) - BYDAY.indexOf(b));
  return { freq, byday, interval, count, untilISO };
}

// → массив recurrence для Google API: ["RRULE:FREQ=…;BYDAY=…;UNTIL=…Z"]
// UNTIL — конец дня untilISO в зоне первой встречи, в UTC (формат RFC 5545).
export function buildRecurrence(recur, startDT) {
  const parts = [`FREQ=${recur.freq.toUpperCase()}`];
  if (recur.interval > 1) parts.push(`INTERVAL=${recur.interval}`);
  if (recur.freq === 'weekly' && recur.byday.length) parts.push(`BYDAY=${recur.byday.join(',')}`);
  if (recur.count > 0) parts.push(`COUNT=${recur.count}`);
  else if (recur.untilISO) {
    const until = DateTime.fromISO(recur.untilISO, { zone: startDT.zoneName }).endOf('day')
      .toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
    parts.push(`UNTIL=${until}`);
  }
  return [`RRULE:${parts.join(';')}`];
}

// Дырки в серии («Пропустить эти дни»): EXDATE в зоне серии.
export function withExdates(recurrence, startsDT) {
  if (!startsDT.length) return recurrence;
  const stamp = (d) => d.toFormat("yyyyMMdd'T'HHmmss");
  return [...recurrence, `EXDATE;TZID=${startsDT[0].zoneName}:${startsDT.map(stamp).join(',')}`];
}

// ── Парсер фраз повторения (ответ на «Как часто?» и валидатор классификатора) ──

// Стемы дней: «вторник» полностью — иначе ловит «каждую ВТОРую субботу».
const WD_STEMS = [
  ['понедельник', 'MO'], ['вторник', 'TU'], ['сред', 'WE'], ['четверг', 'TH'],
  ['пятниц', 'FR'], ['суббот', 'SA'], ['воскресен', 'SU'],
];

// Сокращения дней («каждый ПН и ПТ в 6:30» — баг приёмки Стаса 23.07 ночь).
const WD_SHORT = { пн: 'MO', вт: 'TU', ср: 'WE', чт: 'TH', пт: 'FR', сб: 'SA', вс: 'SU' };

// → {freq, byday, interval} | null (повторение в тексте не найдено)
export function parseRecurPhrase(text) {
  const t = (text || '').toLowerCase().replace(/ё/g, 'е');
  if (/по будням|в будни|будни[ем]\s|каждый будний/.test(t)) {
    return { freq: 'weekly', byday: ['MO', 'TU', 'WE', 'TH', 'FR'], interval: 1 };
  }
  if (/каждый день|ежедневно/.test(t)) return { freq: 'daily', byday: [], interval: 1 };
  if (/кажд[а-я]* месяц|ежемесячно|кажд[а-я]* \d+-?е число/.test(t)) return { freq: 'monthly', byday: [], interval: 1 };

  const hasKazhd = /кажд/.test(t);
  const days = [];
  for (const [stem, code] of WD_STEMS) {
    // День считаем: с «кажд…» — в любой форме; без — только во множ. числе («по понедельникам»)
    const re = new RegExp(stem + '[а-я]*', 'g'); // \w кириллицу не матчит
    const m = t.match(re);
    if (!m) continue;
    const plural = m.some((w) => /ам$|ям$|и$|ы$/.test(w));
    if (hasKazhd || plural) days.push(code);
  }
  // Сокращения токенами («ПН», «по пт») — только в явном контексте повторения,
  // иначе «поставь встречу в ПТ» ложно станет серией.
  if (hasKazhd || /(?:^|\s)по\s+(?:пн|вт|ср|чт|пт|сб|вс)(?![а-я])/.test(t)) {
    for (const tok of t.split(/[^а-я]+/)) {
      const code = WD_SHORT[tok];
      if (code && !days.includes(code)) days.push(code);
    }
  }
  let interval = 1;
  const mN = t.match(/раз в (\d+) недел/);
  if (mN) interval = Math.max(1, +mN[1]);
  else if (/кажд[а-я]* втор[а-я]*|раз в две недел|через недел/.test(t)) interval = 2;

  if (days.length) {
    return { freq: 'weekly', byday: days.sort((a, b) => BYDAY.indexOf(a) - BYDAY.indexOf(b)), interval };
  }
  if (/еженедельно|кажд[а-я]* недел|раз в (\d+|две) недел|через недел/.test(t)) {
    return { freq: 'weekly', byday: [], interval };
  }
  return null;
}

// ── Парсер конца серии (ответ на «Докуда повторять?») ────────────

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function monthFromText(t) {
  for (let i = 0; i < 12; i++) if (t.includes(MONTHS_GEN[i])) return i + 1;
  return 0;
}
// Год: если месяц уже прошёл относительно старта — значит, следующий год.
function yearFor(startDT, month, day) {
  const cand = DateTime.fromObject({ year: startDT.year, month, day }, { zone: startDT.zoneName });
  return cand < startDT.startOf('day') ? startDT.year + 1 : startDT.year;
}

// → {none:true} | {count:N} | {untilISO:'YYYY-MM-DD'} | null (не понял)
export function parseRecurEnd(text, startDT) {
  const t = (text || '').toLowerCase().replace(/ё/g, 'е');
  if (/бессрочн|без конца|навсегда|без окончани|пока не отменю|всегда/.test(t)) return { none: true };
  let m = t.match(/(\d+)\s*раз/);
  if (m) return { count: Math.max(1, +m[1]) };
  if (/до конца года/.test(t)) return { untilISO: `${startDT.year}-12-31` };
  if (/до конца/.test(t)) {
    const mo = monthFromText(t);
    if (mo) {
      const y = yearFor(startDT, mo, 1);
      const last = DateTime.fromObject({ year: y, month: mo, day: 1 }, { zone: startDT.zoneName }).endOf('month');
      return { untilISO: last.toISODate() };
    }
  }
  m = t.match(/до (\d{1,2})(?:-?го)?\s+([а-я]+)/);
  if (m) {
    const mo = monthFromText(m[2]);
    if (mo) {
      const day = Math.min(+m[1], 31);
      return { untilISO: DateTime.fromObject({ year: yearFor(startDT, mo, day), month: mo, day }, { zone: startDT.zoneName }).toISODate() };
    }
  }
  m = t.match(/до (\d{1,2})[.](\d{1,2})(?:[.](\d{2,4}))?/);
  if (m) {
    const y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : yearFor(startDT, +m[2], +m[1]);
    const d = DateTime.fromObject({ year: y, month: +m[2], day: +m[1] }, { zone: startDT.zoneName });
    if (d.isValid) return { untilISO: d.toISODate() };
  }
  m = t.match(/(\d+)?\s*(недел|месяц)/);
  if (m) {
    const n = Math.max(1, parseInt(m[1], 10) || 1);
    const until = m[2] === 'недел' ? startDT.plus({ weeks: n }) : startDT.plus({ months: n });
    return { untilISO: until.minus({ days: 1 }).toISODate() };
  }
  return null;
}

// ── Описание серии по-русски (карточки) ──────────────────────────

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
function joinRu(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' и ' + items.at(-1);
}

// → «еженедельно по ПН и ПТ · до ПТ, 18 сентября (16 занятий)»
export function describeRecur(recur, startDT, occurrencesCount = 0) {
  let freqPart;
  if (recur.freq === 'daily') {
    freqPart = recur.interval > 1 ? `раз в ${recur.interval} ${plural(recur.interval, 'день', 'дня', 'дней')}` : 'ежедневно';
  } else if (recur.freq === 'monthly') {
    freqPart = recur.interval > 1 ? `раз в ${recur.interval} ${plural(recur.interval, 'месяц', 'месяца', 'месяцев')}` : 'ежемесячно';
  } else {
    freqPart = recur.interval > 1 ? `раз в ${recur.interval} ${plural(recur.interval, 'неделю', 'недели', 'недель')}` : 'еженедельно';
  }
  const bydayPart = recur.byday.length ? ` по ${joinRu(recur.byday.map((d) => BYDAY_RU[d]))}` : '';
  let endPart;
  if (recur.count > 0) endPart = `${recur.count} раз`;
  else if (recur.untilISO) {
    const until = DateTime.fromISO(recur.untilISO, { zone: startDT.zoneName });
    endPart = `до ${fmtDayShort(until)}`;
    if (occurrencesCount > 0) endPart += ` (${occurrencesCount} ${plural(occurrencesCount, 'занятие', 'занятия', 'занятий')})`;
  } else endPart = 'бессрочно';
  return `${freqPart}${bydayPart} · ${endPart}`;
}

// ── Разворот экземпляров (конфликт-гейт, счётчик занятий) ────────

// → DateTime[] стартов. Бессрочные — горизонт horizonDays; всегда cap штук максимум.
export function expandOccurrences(recur, startDT, { horizonDays = 90, cap = 100 } = {}) {
  const out = [];
  const bounded = recur.count > 0 || recur.untilISO;
  const hardStop = startDT.plus({ days: bounded ? 400 : horizonDays });
  const until = recur.untilISO
    ? DateTime.fromISO(recur.untilISO, { zone: startDT.zoneName }).endOf('day')
    : hardStop;
  const maxN = recur.count > 0 ? Math.min(recur.count, cap) : cap;

  if (recur.freq === 'weekly' && recur.byday.length) {
    const wanted = new Set(recur.byday.map((c) => BYDAY.indexOf(c) + 1));
    const week0 = startDT.startOf('week');
    for (let d = startDT; d <= until && d <= hardStop && out.length < maxN; d = d.plus({ days: 1 })) {
      if (!wanted.has(d.weekday)) continue;
      const weekIdx = Math.round(d.startOf('week').diff(week0, 'weeks').weeks);
      if (weekIdx % recur.interval !== 0) continue;
      out.push(d);
    }
    return out;
  }
  const step = recur.freq === 'daily' ? { days: recur.interval }
    : recur.freq === 'weekly' ? { weeks: recur.interval } : { months: recur.interval };
  for (let d = startDT, i = 0; d <= until && d <= hardStop && out.length < maxN; i++) {
    out.push(d);
    d = recur.freq === 'monthly' ? startDT.plus({ months: recur.interval * (i + 1) }) : d.plus(step);
  }
  return out;
}

// Обратный разбор RRULE мастера (операции «вся серия / следующие»).
// → recur-структура | null. UNTIL приводится к дате в зоне серии.
export function recurFromRRule(line, zone) {
  const body = String(line || '').replace(/^RRULE:/, '');
  const kv = Object.fromEntries(body.split(';').map((p) => p.split('=')));
  const freq = (kv.FREQ || '').toLowerCase();
  if (!FREQS.has(freq)) return null;
  let untilISO = '';
  if (kv.UNTIL) {
    const u = /^\d{8}$/.test(kv.UNTIL)
      ? DateTime.fromFormat(kv.UNTIL, 'yyyyMMdd', { zone })
      : DateTime.fromFormat(kv.UNTIL, "yyyyMMdd'T'HHmmss'Z'", { zone: 'utc' }).setZone(zone);
    if (u.isValid) untilISO = u.toISODate();
  }
  return {
    freq,
    byday: (kv.BYDAY ? kv.BYDAY.split(',') : []).filter((c) => BYDAY.includes(c)),
    interval: Math.max(1, parseInt(kv.INTERVAL, 10) || 1),
    count: Math.max(0, parseInt(kv.COUNT, 10) || 0),
    untilISO,
  };
}

// Первая встреча серии: ближайший день (включая сегодняшний), попадающий в byday.
export function nextByday(fromDT, byday) {
  if (!byday.length) return fromDT;
  const wanted = new Set(byday.map((c) => BYDAY.indexOf(c) + 1));
  for (let i = 0; i < 7; i++) {
    const d = fromDT.plus({ days: i });
    if (wanted.has(d.weekday)) return d;
  }
  return fromDT;
}
