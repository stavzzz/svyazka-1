// Преобразование событий Google → представления для рендера.
// Здесь же: нормализация события, правило двух строк времени, ссылки Meet+Zoom.
import { DateTime } from 'luxon';
import { zoneLabel, getClock } from './tz.js';
import { fmtDayHeader } from './dates.js';
import { meetLink } from './gcal.js';

const ZOOM_RX = /Zoom:\s*(https:\/\/\S+)/;

// Google event → плоская структура
export function normEvent(raw) {
  const allDay = Boolean(raw.start?.date);
  const startMs = allDay
    ? DateTime.fromISO(raw.start.date, { zone: 'utc' }).toMillis()
    : DateTime.fromISO(raw.start.dateTime).toMillis();
  const endMs = allDay
    ? DateTime.fromISO(raw.end.date, { zone: 'utc' }).toMillis()
    : DateTime.fromISO(raw.end.dateTime).toMillis();
  return {
    id: raw.id,
    summary: raw.summary || '(без названия)',
    startMs, endMs, allDay,
    status: raw.status || 'confirmed',
    transparent: raw.transparency === 'transparent',
    tz: raw.start?.timeZone || null,
    htmlLink: raw.htmlLink || '',
    location: raw.location || '',
    description: raw.description || '',
    attendees: (raw.attendees || []).filter((a) => !a.self && !a.resource).map((a) => a.email),
    // email → responseStatus (needsAction/accepted/declined/tentative) — для
    // уведомлений «участник принял» (правка 23.07 вечер; Calendar API отдаёт сам)
    attStatus: Object.fromEntries((raw.attendees || [])
      .filter((a) => !a.self && !a.resource)
      .map((a) => [a.email, a.responseStatus || 'needsAction'])),
    meet: meetLink(raw),
    zoom: (raw.description || '').match(ZOOM_RX)?.[1] || '',
    // Серии (24.07): у экземпляра — recurringEventId, у мастера — recurrence
    recurringEventId: raw.recurringEventId || null,
    recurrence: raw.recurrence || null,
  };
}

export function zoomFromDescription(desc) {
  return (desc || '').match(ZOOM_RX)?.[1] || '';
}
export function stripZoomLine(desc) {
  return (desc || '').replace(/\n*Zoom:\s*https:\/\/\S+/g, '').trim();
}

// Ссылки для карточки: обе (Meet+Zoom) → именованные подписи, одна → «Подключиться к встрече».
export function buildLinks(meet, zoom) {
  const links = [];
  if (meet && zoom) {
    links.push({ label: 'Подключиться: Google Meet', url: meet });
    links.push({ label: 'Подключиться: Zoom', url: zoom });
  } else if (meet) links.push({ label: 'Подключиться к встрече', url: meet });
  else if (zoom) links.push({ label: 'Подключиться к встрече', url: zoom });
  return links;
}

const hm = (dt) => dt.toFormat('HH:mm');

// Времена и alt-строка (правило двух строк: зона события ≠ локальной).
export function timesFor(ev, calTz) {
  const s = DateTime.fromMillis(ev.startMs, { zone: calTz });
  const e = DateTime.fromMillis(ev.endMs, { zone: calTz });
  const t1 = ev.allDay ? '00:00' : hm(s);
  const t2 = ev.allDay ? '23:59' : hm(e);
  const base = { clock: getClock(t1), t1, t2, zone: zoneLabel(calTz, ev.startMs), local: s };
  let alt = null;
  if (!ev.allDay && ev.tz && ev.tz !== calTz && zoneLabel(ev.tz, ev.startMs) !== base.zone) {
    const s2 = DateTime.fromMillis(ev.startMs, { zone: ev.tz });
    const e2 = DateTime.fromMillis(ev.endMs, { zone: ev.tz });
    alt = { clock: getClock(hm(s2)), t1: hm(s2), t2: hm(e2), zone: zoneLabel(ev.tz, ev.startMs) };
  }
  return { ...base, alt };
}

// Полное представление для карточек (created/deleted/moved/reminder).
export function viewFromEvent(ev, calTz) {
  const t = timesFor(ev, calTz);
  return {
    title: ev.summary,
    dateRu: fmtDayHeader(t.local), // «ВС, 26 июля 2026» — день недели везде (правка 23.07)
    clock: t.clock, t1: t.t1, t2: t.t2, zone: t.zone,
    alt: t.alt,
    attendees: ev.attendees,
    location: ev.location,
    description: stripZoomLine(ev.description),
    links: buildLinks(ev.meet, ev.zoom),
    htmlLink: ev.htmlLink,
    recur: Boolean(ev.recurringEventId || ev.recurrence), // 🔁-бейдж
  };
}

// Строка расписания.
export function lineFromEvent(ev, calTz) {
  const t = timesFor(ev, calTz);
  return {
    clock: t.clock, t1: t.t1, t2: t.t2, zone: t.zone, alt: t.alt, url: ev.htmlLink, title: ev.summary,
    recur: Boolean(ev.recurringEventId || ev.recurrence),
  };
}
