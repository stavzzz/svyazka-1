// Оркестратор: update Telegram → доступ → голос→текст → служебные интенты
// (callback-кнопки, ответы на forceReply) → классификатор → обработчики.
// Все ответы рендерит код (render.js). Deps инжектятся — тестируемость.
import { DateTime } from 'luxon';
import * as R from './render.js';
import { detectCity, zoneLabel, gmtLabel, getClock } from './tz.js';
import { rangeFor, fmtDateRu, fmtDayHeader, fmtDayShort, weekdayFull } from './dates.js';
import { findConflicts } from './conflict.js';
import { parseWhen } from './timeparse.js';
import { newPendingKey } from './state.js';
import { normEvent, viewFromEvent, lineFromEvent, timesFor, buildLinks } from './views.js';
import { freeSlots, fmtDur } from './slots.js';

const WD_RU = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

export function createRouter(deps) {
  const { tg, gcal, zoom, classifier, transcriber, state, cfg, now = () => Date.now() } = deps;
  // Лог диалога (правка 23.07): каждая фраза, интент и результат — в docker logs.
  const log = deps.log || ((...a) => console.log(new Date(now()).toISOString(), ...a));

  const calTz = () => state.data.cache.tz || cfg.fallbackTz;
  const tzLabel = () => zoneLabel(calTz(), now());

  function classifyCtx() {
    const tz = calTz();
    const nowDt = DateTime.fromMillis(now(), { zone: tz });
    return {
      todayISO: nowDt.toISODate(),
      tomorrowISO: nowDt.plus({ days: 1 }).toISODate(),
      weekdayRu: WD_RU[nowDt.weekday - 1],
      tz,
    };
  }

  // ── Кэш календаря ────────────────────────────────────────────
  async function refreshCache() {
    const nowMs = now();
    const tz = await gcal.getCalendarTz();
    const min = new Date(nowMs - 24 * 3600_000).toISOString();
    const max = new Date(nowMs + 60 * 24 * 3600_000).toISOString();
    const events = (await gcal.listEvents(min, max)).map(normEvent);
    const prev = state.data.cache.events || [];
    state.data.cache = { tz, events, fetchedAt: nowMs };
    state.save();
    await notifyAttendeeResponses(prev, events).catch((e) => console.error('att notify:', e.message));
  }

  // Участник ответил на приглашение (правка 23.07 вечер): сравниваем responseStatus
  // между прошлым и свежим кэшем; Gmail не нужен — Calendar API отдаёт статус сам.
  async function notifyAttendeeResponses(prevEvents, events) {
    if (!prevEvents.length) return; // первый запуск — нет базы для сравнения
    const prevById = new Map(prevEvents.map((e) => [e.id, e]));
    for (const e of events) {
      const old = prevById.get(e.id);
      if (!old || !e.attStatus) continue;
      for (const [email, status] of Object.entries(e.attStatus)) {
        const was = old.attStatus?.[email];
        if (was === undefined || was === status) continue;
        if (status !== 'accepted' && status !== 'declined' && status !== 'tentative') continue;
        await tg.send(cfg.ownerChatId, R.rAttendeeResponse(viewFromEvent(e, calTz()), email, status));
      }
    }
  }

  // ── Представление ещё не созданного события (pending) ───────
  function pendingView(ev) {
    const start = DateTime.fromISO(`${ev.date}T${ev.time}`, { zone: ev.tz });
    const end = start.plus({ minutes: ev.durationMin });
    const local = start.setZone(calTz());
    const localEnd = end.setZone(calTz());
    const t1 = local.toFormat('HH:mm');
    const view = {
      title: ev.title,
      dateRu: fmtDayHeader(local),
      clock: getClock(t1), t1, t2: localEnd.toFormat('HH:mm'),
      zone: zoneLabel(calTz(), start.toMillis()),
      alt: null,
      attendees: ev.attendees || [],
      location: ev.location || '',
      description: ev.description || '',
    };
    if (ev.tz !== calTz() && zoneLabel(ev.tz, start.toMillis()) !== view.zone) {
      view.alt = {
        clock: getClock(start.toFormat('HH:mm')),
        t1: start.toFormat('HH:mm'), t2: end.toFormat('HH:mm'),
        zone: zoneLabel(ev.tz, start.toMillis()),
      };
    }
    return { view, startMs: start.toMillis(), endMs: end.toMillis(), start, end };
  }

  // Свободные окна в день планируемой встречи, куда она влезает по длительности.
  // Считается по кэшу — как и сам детект конфликта.
  function conflictDaySlots(ev, startMs) {
    const tz = calTz();
    const day = DateTime.fromMillis(startMs, { zone: tz }).startOf('day');
    const workStart = day.plus({ hours: 9 }).toMillis();
    const workEnd = day.plus({ hours: 21 }).toMillis();
    const from = Math.max(now(), workStart);
    const busy = state.data.cache.events.filter((e) =>
      e.status !== 'cancelled' && !e.allDay && !e.transparent &&
      e.endMs > day.toMillis() && e.startMs < day.plus({ days: 1 }).toMillis());
    const minMs = Math.max(30, ev.durationMin) * 60_000;
    return freeSlots(busy, from, workEnd, minMs).map((s) => {
      const t1 = DateTime.fromMillis(s.startMs, { zone: tz }).toFormat('HH:mm');
      const t2 = DateTime.fromMillis(s.endMs, { zone: tz }).toFormat('HH:mm');
      return { clock: getClock(t1), t1, t2, dur: fmtDur(s.endMs - s.startMs) };
    });
  }

  // ── Создание: гейт прошлого времени → конфликт-гейт → создать ─
  async function resolveAndMaybeCreate(chatId, ev) {
    const { startMs, endMs, view } = pendingView(ev);
    // Встреча в прошлом (правка Стаса 24.07): тот же 3-кнопочный флоу, что и конфликт
    if (endMs <= now()) {
      const key = newPendingKey(chatId);
      const html = R.rPastTime(view);
      const sent = await tg.send(chatId, html, { buttons: R.conflictButtons(key) });
      state.data.pending[chatId] = { key, kind: 'confirm', action: 'create', ev, createdAt: now(), cardHtml: html, promptMsgId: sent.message_id };
      state.save();
      return;
    }
    const conflicts = findConflicts(startMs, endMs, state.data.cache.events.filter((e) => !e.allDay && !e.transparent));
    if (conflicts.length) {
      const key = newPendingKey(chatId);
      const cv = conflicts.map((c) => {
        const t = timesFor(c, calTz());
        return { title: c.summary, t1: t.t1, t2: t.t2, zone: t.zone };
      });
      const html = R.rConflict(view, cv, conflictDaySlots(ev, startMs));
      const sent = await tg.send(chatId, html, { buttons: R.conflictButtons(key) });
      state.data.pending[chatId] = { key, kind: 'confirm', action: 'create', ev, createdAt: now(), cardHtml: html, promptMsgId: sent.message_id };
      state.save();
      return;
    }
    await doCreate(chatId, ev);
  }

  // Жизненный цикл кнопок (заметка telegram-instant-buttons): после нажатия
  // карточка перерисовывается БЕЗ кнопок, внизу — выбранный статус.
  async function stripButtons(chatId, pending, label) {
    if (!pending?.cardHtml || !pending?.promptMsgId) return;
    await tg.edit(chatId, pending.promptMsgId, pending.cardHtml + `\n\n➡️ ${label}`, {});
  }

  async function doCreate(chatId, ev) {
    const { start, end } = pendingView(ev);
    // Zoom — в каждую встречу (решение Стаса); сбой Zoom не блокирует создание.
    let zoomUrl = '';
    if (zoom.enabled) {
      try {
        const z = await zoom.createMeeting(ev.title, start.toFormat("yyyy-MM-dd'T'HH:mm:ss"), ev.durationMin, ev.tz);
        zoomUrl = z.joinUrl;
      } catch (e) { console.error('zoom create failed:', e.message); }
    }
    let description = ev.description || '';
    if (zoomUrl) description = (description ? description + '\n\n' : '') + `Zoom: ${zoomUrl}`;
    const raw = await gcal.createEvent({
      summary: ev.title,
      startISO: start.toISO(),
      endISO: end.toISO(),
      tz: ev.tz,
      attendees: ev.attendees,
      location: ev.location,
      description,
    }, { meet: true });
    await refreshCache();
    const nev = normEvent(raw);
    if (!nev.tz) nev.tz = ev.tz;
    await tg.send(chatId, R.rCreated(viewFromEvent(nev, calTz())));
  }

  // ── Перенос существующего события ────────────────────────────
  async function doMove(chatId, pending) {
    const { ev, eventId } = pending;
    const { start, end } = pendingView(ev);
    const patch = {
      start: { dateTime: start.toISO(), timeZone: ev.tz },
      end: { dateTime: end.toISO(), timeZone: ev.tz },
    };
    if (pending.newTitle) patch.summary = pending.newTitle; // перенос + переименование разом
    const raw = await gcal.patchEvent(eventId, patch);
    await refreshCache();
    await tg.send(chatId, R.rMoved([viewFromEvent(normEvent(raw), calTz())]));
    await nextFromQueue(chatId, pending); // очередь мульти-переноса
  }

  async function resolveAndMaybeMove(chatId, pending) {
    const { startMs, endMs, view } = pendingView(pending.ev);
    // Перенос в прошлое — тот же гейт (правка Стаса 24.07)
    if (endMs <= now()) {
      const key = newPendingKey(chatId);
      const html = R.rPastTime(view);
      const sent = await tg.send(chatId, html, { buttons: R.conflictButtons(key) });
      state.data.pending[chatId] = { ...pending, key, kind: 'confirm', createdAt: now(), cardHtml: html, promptMsgId: sent.message_id };
      state.save();
      return;
    }
    const conflicts = findConflicts(startMs, endMs,
      state.data.cache.events.filter((e) => !e.allDay && !e.transparent), pending.eventId);
    if (conflicts.length) {
      const key = newPendingKey(chatId);
      const cv = conflicts.map((c) => {
        const t = timesFor(c, calTz());
        return { title: c.summary, t1: t.t1, t2: t.t2, zone: t.zone };
      });
      const html = R.rConflict(view, cv, conflictDaySlots(pending.ev, startMs));
      const sent = await tg.send(chatId, html, { buttons: R.conflictButtons(key) });
      state.data.pending[chatId] = { ...pending, key, kind: 'confirm', createdAt: now(), cardHtml: html, promptMsgId: sent.message_id };
      state.save();
      return;
    }
    await doMove(chatId, pending);
  }

  // ── Поиск событий по названию (кэш, будущее окно) ────────────
  // Правка 23.07: сравнение по словам, устойчивое к падежам («встречУ тест
  // колонок» ↔ «Тест колонок»): регистр, ё→е, пунктуация, общий префикс ≥4.
  const STOP_WORDS = new Set(['встреча', 'встречу', 'встречи', 'встрече', 'встречей', 'событие']);
  function words(s) {
    return (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]/gi, ' ')
      .split(/\s+/).filter((w) => w.length >= 2 || /\d/.test(w)); // «Тест-1»: цифру не терять
  }
  // Стоп-слова режем ТОЛЬКО в запросе («удали встречУ тест колонок»);
  // название события не трогаем, иначе «Созвон» перестанет находиться.
  function keyWords(s) {
    const w = words(s);
    const k = w.filter((x) => !STOP_WORDS.has(x));
    return k.length ? k : w; // запрос из одних стоп-слов («встреча») — как есть
  }
  function tokenPair(a, b) {
    if (a === b) return true;
    const n = Math.min(a.length, b.length);
    return n >= 4 && a.slice(0, n) === b.slice(0, n);
  }
  function titleMatches(query, title) {
    const q = keyWords(query);
    const t = words(title);
    if (!q.length || !t.length) return false;
    return q.every((qw) => t.some((tw) => tokenPair(qw, tw)));
  }

  // Все токены, включая односимвольные («Тест а» ≠ «Тест б»; баг 23.07 ночь-3).
  function wordsAll(s) {
    return (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]/gi, ' ')
      .split(/\s+/).filter(Boolean);
  }
  function exactKey(s) { return wordsAll(s).filter((w) => !STOP_WORDS.has(w)).join(' '); }

  function searchByTitle(title) {
    const q = (title || '').trim();
    if (!q) return [];
    const base = state.data.cache.events.filter((e) =>
      e.status !== 'cancelled' && e.endMs > now() - 3600_000);
    // Точное совпадение названия — в приоритете, нечёткий поиск только при промахе
    const k = exactKey(q);
    if (k) {
      const exact = base.filter((e) => exactKey(e.summary) === k);
      if (exact.length) return exact;
    }
    return base.filter((e) => titleMatches(q, e.summary));
  }

  // Фолбэк: классификатор не вытащил название (запятые, обороты) —
  // ищем названия встреч из кэша прямо в тексте сообщения. Детерминированно.
  function searchInText(text) {
    const t = (text || '').trim();
    if (!t) return [];
    const seen = new Set();
    return state.data.cache.events.filter((e) => {
      if (e.status === 'cancelled' || e.endMs <= now() - 3600_000) return false;
      if (!titleMatches(e.summary, t)) return false; // все слова названия есть в тексте
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }

  // ── Обработчики интентов ─────────────────────────────────────

  // Ответ на вопрос названия: срезаем служебный префикс и кавычки —
  // «назови встречу "Тест"» → «Тест» (баг со скриншота Стаса 23.07).
  function cleanTitle(s) {
    let t = (s || '').trim();
    t = t.replace(/^(пожалуйста[,\s]+)?(назови|назов[её]м|назвать|название)\s*(встречу|е[её]|это)?\s*[:—-]?\s*/i, '');
    t = t.replace(/^["«'`]+/, '').replace(/["»'`]+$/, '').trim();
    return (t || s.trim()).slice(0, 80);
  }

  // «в 8» без «утра/вечера» — неоднозначно (правка 23.07 вечер): 1–11 часов,
  // ровный час, в тексте голое число без маркера и без двоеточия.
  function ampmAmbiguous(text, time) {
    if (!/^\d{2}:00$/.test(time || '')) return false;
    const h = +time.slice(0, 2);
    if (h < 1 || h > 11) return false;
    // граница слова: «сегоДНЯ» — не маркер, «3 часа дня» — маркер
    if (/(?<![а-яёa-z])(утр|вечер|ночи|ночью|дня(?![а-яё])|дн[её]м|полдень|полдн|am|pm)/i.test(text || '')) return false;
    return new RegExp('(?:^|[^:.\\d])(?:в|на)\\s+0?' + h + '(?![:.\\d])', 'i').test(text || '');
  }

  // Спросить «утра или вечера?» кнопками; продолжение — в handleCallback (cal:am/cal:pm).
  async function askAmPm(chatId, ev, action, extra = {}) {
    const key = newPendingKey(chatId);
    const html = R.rAskAmPm(ev.title, +ev.time.slice(0, 2));
    const sent = await tg.send(chatId, html, { buttons: R.ampmButtons(key) });
    state.data.pending[chatId] = { key, kind: 'await_ampm', action, ev, ...extra, createdAt: now(), cardHtml: html, promptMsgId: sent.message_id };
    state.save();
  }

  // Нет времени → спросить время (forceReply), есть → к конфликт-гейту.
  async function askTimeOrCreate(chatId, ev) {
    if (!ev.time) {
      const key = newPendingKey(chatId);
      const msg = await tg.send(chatId, R.rAskTime(ev.title, zoneLabel(calTz(), now())), { forceReply: true });
      state.data.pending[chatId] = { key, kind: 'await_time', action: 'create', ev, createdAt: now(), promptMsgId: msg.message_id };
      state.save();
      return;
    }
    await resolveAndMaybeCreate(chatId, ev);
  }

  async function handleCreate(chatId, c, text) {
    const city = c.city ? detectCity(c.city) : null;
    const ev = {
      title: (c.title || '').trim(),
      date: c.date || DateTime.fromMillis(now(), { zone: calTz() }).toISODate(),
      time: c.time_start || '',
      tz: city ? city.tz : calTz(),
      durationMin: computeDuration(c),
      attendees: c.attendees || [],
      location: c.location || '',
      description: c.description || '',
    };
    const ampm = Boolean(ev.time) && ampmAmbiguous(text, ev.time);
    // Правка 23.07: без названия НЕ создаём «Встречу» — спрашиваем название.
    if (!ev.title) {
      const key = newPendingKey(chatId);
      const sent = await tg.send(chatId, R.rAskTitle(), { forceReply: true });
      state.data.pending[chatId] = { key, kind: 'await_title', action: 'create', ev, ampm, createdAt: now(), promptMsgId: sent.message_id };
      state.save();
      return;
    }
    if (ampm) { await askAmPm(chatId, ev, 'create'); return; }
    await askTimeOrCreate(chatId, ev);
  }

  function computeDuration(c) {
    if (c.time_start && c.time_end) {
      const [h1, m1] = c.time_start.split(':').map(Number);
      const [h2, m2] = c.time_end.split(':').map(Number);
      const d = (h2 * 60 + m2) - (h1 * 60 + m1);
      if (d > 0) return d;
    }
    const d = parseInt(c.duration_min, 10);
    return d > 0 ? d : 60;
  }

  async function handleSchedule(chatId, intent, c) {
    // Классификатор не дал дату для weekday/specific_date → показываем сегодня.
    if ((intent === 'weekday' || intent === 'specific_date') && !/^\d{4}-\d{2}-\d{2}$/.test(c.date || '')) {
      intent = 'today';
    }
    let range;
    try {
      range = rangeFor(intent, { date: c.date }, calTz(), now());
    } catch {
      await tg.send(chatId, R.rFail());
      return;
    }
    let events;
    try {
      events = (await gcal.listEvents(range.start.toUTC().toISO(), range.end.toUTC().toISO()))
        .map(normEvent).filter((e) => e.status !== 'cancelled');
    } catch (e) {
      console.error('list failed:', e.message);
      await tg.send(chatId, R.rCalError());
      return;
    }
    if (range.kind === 'day') {
      await tg.send(chatId, R.rDaySchedule(range.header, fmtDayHeader(range.start), events.map((e) => lineFromEvent(e, calTz()))));
    } else {
      const days = [];
      for (let d = range.start; d < range.end; d = d.plus({ days: 1 })) {
        const dayEvents = events.filter((e) => {
          const s = DateTime.fromMillis(e.startMs, { zone: calTz() });
          return s.hasSame(d, 'day');
        });
        if (dayEvents.length) days.push({ hdr: fmtDayShort(d), lines: dayEvents.map((e) => lineFromEvent(e, calTz())) });
      }
      await tg.send(chatId, R.rWeekSchedule(range.header, days));
    }
  }

  function ambiguousItems(matches) {
    return matches.map((m) => {
      const tt = timesFor(m, calTz());
      return { title: m.summary, dayMonth: fmtDayShort(tt.local), clock: tt.clock, t1: tt.t1, zone: tt.zone };
    });
  }

  // «Найдено несколько» → pending выбора: кнопки-номера или цифра сообщением.
  // Кнопки — с днём недели и датой (правка Стаса 23.07): «1 · ПТ, 24 июля».
  async function askWhich(chatId, matches, action, payload) {
    const key = newPendingKey(chatId);
    const items = ambiguousItems(matches);
    const html = R.rAmbiguous(items, action);
    const labels = items.map((it, i) => `${i + 1} · ${it.dayMonth}`);
    const sent = await tg.send(chatId, html, { buttons: R.pickButtons(key, matches.length, { withAll: action === 'delete', labels }) });
    state.data.pending[chatId] = {
      key, kind: 'choose', action, candidates: matches, c: payload, createdAt: now(),
      cardHtml: html, promptMsgId: sent.message_id,
    };
    state.save();
  }

  // Выбранная встреча из «Найдено несколько» → продолжаем исходную операцию.
  // idx: номер (0-based) или 'all' — все сразу (только для удаления).
  async function resolveChoice(chatId, pending, idx) {
    const targets = idx === 'all'
      ? pending.candidates
      : [pending.candidates[idx]].filter(Boolean);
    if (!targets.length || (idx === 'all' && pending.action !== 'delete')) {
      await tg.send(chatId, R.rStaleButton());
      return;
    }
    delete state.data.pending[chatId];
    state.save();
    await stripButtons(chatId, pending, idx === 'all' ? '☑️ Выбрано: все' : `☑️ Выбрано: ${idx + 1}`);
    if (pending.action === 'find') { await sendFoundCard(chatId, targets[0]); return; }
    if (pending.action === 'delete') {
      const key = newPendingKey(chatId);
      const html = R.rConfirmDelete(targets.map((t) => viewFromEvent(t, calTz())));
      const sent = await tg.send(chatId, html, { buttons: R.deleteButtons(key) });
      state.data.pending[chatId] = { key, kind: 'confirm', action: 'delete', events: targets, notFound: [], createdAt: now(), cardHtml: html, promptMsgId: sent.message_id };
      state.save();
      return;
    }
    await applyUpdate(chatId, targets[0], pending.c);
  }

  async function handleDelete(chatId, c, text) {
    const titles = (c.titles && c.titles.length ? c.titles : [c.title]).filter(Boolean);
    const attempt = () => {
      const found = [];
      let notFound = [];
      for (const t of titles) {
        const matches = searchByTitle(t);
        if (matches.length > 1) return { ambiguous: matches };
        if (matches.length === 1) found.push(matches[0]);
        else notFound.push(t);
      }
      // Фолбэк: названий нет или ни одно не нашлось — ищем имена встреч в самом тексте
      if (!found.length) {
        const byText = searchInText(text);
        if (byText.length) return { found: byText, notFound: [] };
      }
      // Фолбэк 2: указана дата/время без названия («встречу в ВС в 11»)
      if (!found.length && !titles.length) {
        const bySlot = searchBySlot(c.date, c.time_start);
        if (bySlot.length > 1) return { ambiguous: bySlot };
        if (bySlot.length) return { found: bySlot, notFound: [] };
      }
      return { found, notFound };
    };
    let r = attempt();
    // Промах → возможно, кэш протух (событие только что создали) — обновить и повторить
    if (!r.ambiguous && !r.found.length) { await refreshCache().catch(() => {}); r = attempt(); }
    if (r.ambiguous) { await askWhich(chatId, r.ambiguous, 'delete', c); return; }
    const found = r.found;
    const notFound = r.notFound;
    if (!found.length) { await tg.send(chatId, R.rNotFound(titles.length ? titles : ['(без названия)'])); return; }

    // Защита от случайного удаления: подтверждение кнопками
    const key = newPendingKey(chatId);
    const html = R.rConfirmDelete(found.map((e) => viewFromEvent(e, calTz())), notFound);
    const sent = await tg.send(chatId, html, { buttons: R.deleteButtons(key) });
    state.data.pending[chatId] = {
      key, kind: 'confirm', action: 'delete',
      events: found, notFound, createdAt: now(),
      cardHtml: html, promptMsgId: sent.message_id,
    };
    state.save();
  }

  // Поиск по дате/времени без названия (правка 23.07 вечер): «встречу в ВС в 11:00».
  function searchBySlot(date, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return [];
    const tz = calTz();
    const d0 = DateTime.fromISO(date, { zone: tz }).startOf('day');
    const d1 = d0.plus({ days: 1 });
    const evs = state.data.cache.events.filter((e) =>
      e.status !== 'cancelled' && !e.allDay &&
      e.startMs >= d0.toMillis() && e.startMs < d1.toMillis());
    if (!/^\d{2}:\d{2}$/.test(time || '')) return evs;
    const exact = evs.filter((e) => DateTime.fromMillis(e.startMs, { zone: tz }).toFormat('HH:mm') === time);
    if (exact.length) return exact;
    const tMs = d0.plus({ hours: +time.slice(0, 2), minutes: +time.slice(3) }).toMillis();
    return evs.filter((e) => e.startMs <= tMs && e.endMs > tMs); // идущая в этот момент
  }

  // Интент find (правка 23.07): «найди/покажи встречу X» → карточки, ничего не меняем.
  async function handleFind(chatId, c, text) {
    const titles = (c.titles && c.titles.length ? c.titles : [c.title]).filter(Boolean);
    const attempt = () => {
      const found = [];
      for (const t of titles) found.push(...searchByTitle(t));
      if (!found.length) found.push(...searchInText(text));
      if (!found.length && !titles.length) found.push(...searchBySlot(c.date, c.time_start));
      const seen = new Set();
      return found.filter((e) => !seen.has(e.id) && seen.add(e.id));
    };
    let found = attempt();
    if (!found.length) { await refreshCache().catch(() => {}); found = attempt(); }
    if (!found.length) { await tg.send(chatId, R.rNotFound(titles.length ? titles : ['(без названия)'])); return; }
    // Несколько — выбор кнопками с датами (правка Стаса 23.07), одна — сразу карточка
    if (found.length > 1) {
      await askWhich(chatId, found.slice(0, CARD_CAP), 'find', c);
      return;
    }
    await sendFoundCard(chatId, found[0]);
  }

  // Карточка найденной встречи с кнопками действий (тест 46)
  async function sendFoundCard(chatId, event) {
    const html = R.rFound([viewFromEvent(event, calTz())]);
    const key = newPendingKey(chatId);
    const sent = await tg.send(chatId, html, { buttons: R.foundButtons(key) });
    state.data.pending[chatId] = { key, kind: 'found', event, createdAt: now(), cardHtml: html, promptMsgId: sent.message_id };
    state.save();
  }

  // Массовые операции: «удали/перенеси все встречи за период» (с подтверждением).
  const CARD_CAP = 12; // не раздуваем карточку сверх лимита Telegram

  async function handleBulk(chatId, c, kind) {
    let intent = ['today', 'tomorrow', 'week', 'next_week', 'specific_date'].includes(c.range) ? c.range : 'week';
    if (intent === 'specific_date' && !/^\d{4}-\d{2}-\d{2}$/.test(c.date || '')) intent = 'today';
    const range = rangeFor(intent, { date: c.date }, calTz(), now());
    let events;
    try {
      events = (await gcal.listEvents(range.start.toUTC().toISO(), range.end.toUTC().toISO()))
        .map(normEvent)
        .filter((e) => e.status !== 'cancelled' && !e.allDay && e.endMs > now());
    } catch (e) {
      console.error('bulk list failed:', e.message);
      await tg.send(chatId, R.rCalError());
      return;
    }
    if (!events.length) { await tg.send(chatId, R.rNoEventsRange(range.header)); return; }

    const views = events.slice(0, CARD_CAP).map((e) => viewFromEvent(e, calTz()));
    const more = Math.max(0, events.length - CARD_CAP);
    const key = newPendingKey(chatId);
    if (kind === 'delete') {
      const html = R.rConfirmDelete(views, [], more);
      const sent = await tg.send(chatId, html, { buttons: R.deleteButtons(key) });
      state.data.pending[chatId] = { key, kind: 'confirm', action: 'delete', events, notFound: [], createdAt: now(), cardHtml: html, promptMsgId: sent.message_id };
    } else {
      const shiftDays = parseInt(c.shift_days, 10) || 7;
      const html = R.rConfirmMove(views, shiftDays, more);
      const sent = await tg.send(chatId, html, { buttons: R.moveButtons(key) });
      state.data.pending[chatId] = { key, kind: 'confirm', action: 'move_all', events, shiftDays, createdAt: now(), cardHtml: html, promptMsgId: sent.message_id };
    }
    state.save();
  }

  async function doMoveAll(chatId, pending) {
    const moved = [];
    for (const ev of pending.events) {
      const tz = ev.tz || calTz();
      const s = DateTime.fromMillis(ev.startMs, { zone: tz }).plus({ days: pending.shiftDays });
      const e = DateTime.fromMillis(ev.endMs, { zone: tz }).plus({ days: pending.shiftDays });
      try {
        const raw = await gcal.patchEvent(ev.id, {
          start: { dateTime: s.toISO(), timeZone: tz },
          end: { dateTime: e.toISO(), timeZone: tz },
        });
        moved.push(normEvent(raw));
      } catch (err) { console.error('bulk move failed:', err.message); }
    }
    await refreshCache();
    if (!moved.length) { await tg.send(chatId, R.rCalError()); return; }
    await tg.send(chatId, R.rMoved(moved.slice(0, CARD_CAP).map((m) => viewFromEvent(m, calTz()))));
  }

  async function doDelete(chatId, pending) {
    for (const ev of pending.events) {
      try { await gcal.deleteEvent(ev.id); } catch (e) {
        console.error('delete failed:', e.message);
        await tg.send(chatId, R.rCalError());
        return;
      }
    }
    await refreshCache();
    await tg.send(chatId, R.rDeleted(pending.events.map((e) => viewFromEvent(e, calTz())), pending.notFound));
  }

  // Несколько названных встреч одной фразой: «перенеси X и Y на завтра».
  // Правка Стаса 23.07 ночь-3: отдельное сообщение на каждую; конфликтные —
  // по очереди через стандартный конфликт-гейт (queue в pending).
  async function moveNamed(chatId, targets, c) {
    const seen = new Set();
    targets = targets.filter((e) => !seen.has(e.id) && seen.add(e.id)); // дедуп
    const deferred = [];
    for (const target of targets) {
      const tz = target.tz || calTz();
      const oldStart = DateTime.fromMillis(target.startMs, { zone: tz });
      const ev = {
        title: target.summary,
        date: c.date || oldStart.toISODate(),
        time: c.time_start || oldStart.toFormat('HH:mm'),
        tz,
        durationMin: Math.round((target.endMs - target.startMs) / 60000),
      };
      const { startMs, endMs } = pendingView(ev);
      const conflicts = findConflicts(startMs, endMs,
        state.data.cache.events.filter((e) => !e.allDay && !e.transparent), target.id);
      if (conflicts.length) { deferred.push({ ev, eventId: target.id }); continue; }
      try {
        const s = DateTime.fromISO(`${ev.date}T${ev.time}`, { zone: tz });
        const raw = await gcal.patchEvent(target.id, {
          start: { dateTime: s.toISO(), timeZone: tz },
          end: { dateTime: s.plus({ minutes: ev.durationMin }).toISO(), timeZone: tz },
        });
        await refreshCache();
        await tg.send(chatId, R.rMoved([viewFromEvent(normEvent(raw), calTz())]));
      } catch (e) { console.error('move named failed:', e.message); await tg.send(chatId, R.rCalError()); }
    }
    if (deferred.length) {
      const [first, ...rest] = deferred;
      await resolveAndMaybeMove(chatId, { kind: 'confirm', action: 'move', ev: first.ev, eventId: first.eventId, queue: rest });
    }
  }

  // Следующая конфликтная из очереди мульти-переноса (после Да/Отмены).
  async function nextFromQueue(chatId, pending) {
    if (!pending.queue?.length) return;
    const [next, ...rest] = pending.queue;
    await resolveAndMaybeMove(chatId, { kind: 'confirm', action: 'move', ev: next.ev, eventId: next.eventId, queue: rest });
  }

  async function handleUpdate(chatId, c, text) {
    // Несколько названий → перенос каждой (как массовый, без конфликт-гейта)
    const multi = (c.titles || []).filter(Boolean);
    if (multi.length > 1 && (c.date || c.time_start)) {
      const targets = [];
      const missing = [];
      for (const t of multi) {
        let m = searchByTitle(t);
        if (!m.length) { await refreshCache().catch(() => {}); m = searchByTitle(t); }
        if (m.length) targets.push(...m); else missing.push(t);
      }
      if (!targets.length) { await tg.send(chatId, R.rNotFound(multi)); return; }
      await moveNamed(chatId, targets, c);
      if (missing.length) await tg.send(chatId, R.rNotFound(missing));
      return;
    }
    const attempt = () => {
      let m = searchByTitle(c.title || (multi[0] || ''));
      if (!m.length) m = searchInText(text); // фолбэк по тексту сообщения
      return m;
    };
    let matches = attempt();
    if (!matches.length) { await refreshCache().catch(() => {}); matches = attempt(); }
    if (!matches.length) { await tg.send(chatId, R.rNotFound([c.title || '(без названия)'])); return; }
    if (matches.length > 1) {
      await askWhich(chatId, matches, 'update', c);
      return;
    }
    await applyUpdate(chatId, matches[0], c);
  }

  async function applyUpdate(chatId, target, c) {
    const newTitle = (c.new_title || '').trim(); // переименование (правка 23.07 вечер)
    const tz0 = target.tz || calTz();
    const oldStart0 = DateTime.fromMillis(target.startMs, { zone: tz0 });

    // Относительный сдвиг: «перенеси на час вперёд/на 30 минут раньше» (правка 23.07 ночь-3)
    const shiftMin = parseInt(c.shift_min, 10) || 0;
    if (shiftMin) {
      const s = oldStart0.plus({ minutes: shiftMin });
      const ev = {
        title: newTitle || target.summary,
        date: s.toISODate(), time: s.toFormat('HH:mm'), tz: tz0,
        durationMin: Math.round((target.endMs - target.startMs) / 60000),
      };
      await resolveAndMaybeMove(chatId, { kind: 'confirm', action: 'move', ev, eventId: target.id, newTitle });
      return;
    }

    // Время «изменилось», только если названо новое время или ДРУГАЯ дата —
    // «переименуй встречу в воскресенье» (дата та же) не считается переносом.
    const timeChanged = Boolean(c.time_start) || (Boolean(c.date) && c.date !== oldStart0.toISODate());

    if (timeChanged) {
      const city = c.city ? detectCity(c.city) : null;
      const tz = city ? city.tz : (target.tz || calTz());
      const oldStart = DateTime.fromMillis(target.startMs, { zone: tz });
      const oldDurMin = Math.round((target.endMs - target.startMs) / 60000);
      const ev = {
        title: newTitle || target.summary,
        date: c.date || oldStart.toISODate(),
        time: c.time_start || oldStart.toFormat('HH:mm'),
        tz,
        durationMin: parseInt(c.duration_min, 10) > 0 ? parseInt(c.duration_min, 10) : oldDurMin,
      };
      await resolveAndMaybeMove(chatId, { kind: 'confirm', action: 'move', ev, eventId: target.id, newTitle });
      return;
    }

    // Изменения без переноса: новое название / длительность / участники / описание
    const patch = {};
    if (newTitle) patch.summary = newTitle;
    if (parseInt(c.duration_min, 10) > 0) {
      const end = DateTime.fromMillis(target.startMs).plus({ minutes: parseInt(c.duration_min, 10) });
      patch.end = { dateTime: end.toISO(), timeZone: target.tz || calTz() };
    }
    if (c.attendees_add?.length) {
      const emails = new Set([...target.attendees, ...c.attendees_add]);
      patch.attendees = [...emails].map((e) => ({ email: e }));
    }
    if (c.description) {
      const zoomUrl = target.zoom;
      patch.description = c.description + (zoomUrl ? `\n\nZoom: ${zoomUrl}` : '');
    }
    if (!Object.keys(patch).length) { await tg.send(chatId, R.rFail()); return; }
    try {
      const raw = await gcal.patchEvent(target.id, patch);
      await refreshCache();
      await tg.send(chatId, R.rUpdated(viewFromEvent(normEvent(raw), calTz())));
    } catch (e) {
      console.error('patch failed:', e.message);
      await tg.send(chatId, R.rCalError());
    }
  }

  async function handleSetTz(chatId, text, c) {
    const city = detectCity(text) || (c.city ? detectCity(c.city) : null);
    if (!city) { await tg.send(chatId, R.rTzUnknown()); return; }
    try {
      await gcal.setCalendarTz(city.tz);
      state.data.cache.tz = city.tz;
      state.save();
      await tg.send(chatId, R.rTzSwitched(city.name, city.tz, gmtLabel(city.tz, now())));
    } catch (e) {
      console.error('set tz failed:', e.message);
      await tg.send(chatId, R.rCalError());
    }
  }

  async function handleGetTz(chatId) {
    const tz = calTz();
    const nowHM = DateTime.fromMillis(now(), { zone: tz }).toFormat('HH:mm');
    await tg.send(chatId, R.rTzCurrent(zoneLabel(tz, now()), tz, gmtLabel(tz, now()), nowHM));
  }

  // ── Команды меню: ЧИСТЫЙ код, ноль токенов (правило из заметки
  //    telegram-instant-buttons-openclaw: меню и списки рисует код) ──
  async function handleNext(chatId) {
    let events;
    try {
      const nowMs = now();
      events = (await gcal.listEvents(new Date(nowMs).toISOString(), new Date(nowMs + 60 * 24 * 3600_000).toISOString()))
        .map(normEvent)
        .filter((e) => e.status !== 'cancelled' && !e.allDay && e.startMs > nowMs)
        .sort((a, b) => a.startMs - b.startMs);
    } catch (e) {
      console.error('next failed:', e.message);
      await tg.send(chatId, R.rCalError());
      return;
    }
    if (!events.length) { await tg.send(chatId, R.rNextNone()); return; }
    await tg.send(chatId, R.rNext(viewFromEvent(events[0], calTz())));
  }

  // Рабочее окно для свободных слотов: 09:00–21:00 в зоне календаря.
  function daySlots(day, busy, tz) {
    const workStart = day.plus({ hours: 9 }).toMillis();
    const workEnd = day.plus({ hours: 21 }).toMillis();
    const from = Math.max(now(), workStart);
    return freeSlots(busy, from, workEnd).map((s) => {
      const t1 = DateTime.fromMillis(s.startMs, { zone: tz }).toFormat('HH:mm');
      const t2 = DateTime.fromMillis(s.endMs, { zone: tz }).toFormat('HH:mm');
      return { clock: getClock(t1), t1, t2, dur: fmtDur(s.endMs - s.startMs) };
    });
  }

  async function listBusy(fromISO, toISO) {
    return (await gcal.listEvents(fromISO, toISO))
      .map(normEvent)
      .filter((e) => e.status !== 'cancelled' && !e.allDay && !e.transparent);
  }

  async function handleFree(chatId) {
    const tz = calTz();
    const day = DateTime.fromMillis(now(), { zone: tz }).startOf('day');
    let busy;
    try {
      busy = await listBusy(day.toUTC().toISO(), day.plus({ days: 1 }).toUTC().toISO());
    } catch (e) {
      console.error('free failed:', e.message);
      await tg.send(chatId, R.rCalError());
      return;
    }
    await tg.send(chatId, R.rFreeSlots(fmtDayHeader(day), daySlots(day, busy, tz)));
  }

  async function handleFreeWeek(chatId, nextWeek) {
    const tz = calTz();
    const range = rangeFor(nextWeek ? 'next_week' : 'week', {}, tz, now());
    let busy;
    try {
      busy = await listBusy(range.start.toUTC().toISO(), range.end.toUTC().toISO());
    } catch (e) {
      console.error('free week failed:', e.message);
      await tg.send(chatId, R.rCalError());
      return;
    }
    const today = DateTime.fromMillis(now(), { zone: tz }).startOf('day');
    const days = [];
    for (let d = range.start; d < range.end; d = d.plus({ days: 1 })) {
      if (d < today) continue; // прошедшие дни этой недели не показываем
      const slots = daySlots(d, busy, tz);
      if (slots.length) days.push({ hdr: fmtDayShort(d), slots });
    }
    const header = nextWeek
      ? range.header.replace('на следующую неделю', 'на следующей неделе')
      : `на этой неделе (${range.header.replace('на ', '')})`;
    await tg.send(chatId, R.rFreeWeek(header, days));
  }

  // → true, если текст был /командой и обработан кодом (без классификатора).
  // Неизвестные /команды тоже гасятся кодом — в модель не проваливаются.
  async function handleMenuCommand(chatId, text) {
    const m = text.match(/^\/([a-z_]+)\b/i);
    if (!m) return false;
    switch (m[1].toLowerCase()) {
      case 'today': await handleSchedule(chatId, 'today', {}); break;
      case 'tomorrow': await handleSchedule(chatId, 'tomorrow', {}); break;
      case 'week': await handleSchedule(chatId, 'week', {}); break;
      case 'next_week': await handleSchedule(chatId, 'next_week', {}); break;
      case 'tz': await handleGetTz(chatId); break;
      case 'next': await handleNext(chatId); break;
      case 'free': await handleFree(chatId); break;
      case 'free_week': await handleFreeWeek(chatId, false); break;
      case 'free_next': await handleFreeWeek(chatId, true); break;
      case 'add': await tg.send(chatId, R.rAskWhat(), { forceReply: true }); break;
      case 'reminders':
        await tg.send(chatId, R.rReminderSettings(state.data.settings, tzLabel()),
          { buttons: R.settingsButtons(state.data.settings) });
        break;
      case 'new': {
        const hadPending = Boolean(state.data.pending[chatId]);
        delete state.data.pending[chatId];
        state.save();
        await tg.send(chatId, R.rReset(hadPending));
        break;
      }
      default: await tg.send(chatId, R.rUnknownCmd());
    }
    return true;
  }

  // ── Callback-кнопки: cal:<action>:<pending_key> ──────────────
  // Кнопки настроек: set:<что>[:значение] → мутация settings + перерисовка карточки.
  async function handleSettingsCallback(cb) {
    const chatId = cb.message.chat.id;
    const s = state.data.settings;
    const parts = (cb.data || '').split(':'); // ['set', код, ...значение]
    const code = parts[1];
    const val = parts.slice(2).join(':');
    switch (code) {
      case 'mo': s.morning.enabled = !s.morning.enabled; break;
      case 'md': {
        const d = Number(val);
        s.morning.days = s.morning.days.includes(d)
          ? s.morning.days.filter((x) => x !== d)
          : [...s.morning.days, d].sort((a, b) => a - b);
        break;
      }
      case 'mt': s.morning.time = val; break;
      case 't': s.tiers[val] = !s.tiers[val]; break;
      case 'wo': s.weekly.enabled = !s.weekly.enabled; break;
      case 'wt': {
        const times = ['08:00', '09:00', '10:00', '18:00'];
        s.weekly.time = times[(times.indexOf(s.weekly.time) + 1) % times.length];
        break;
      }
      default: return;
    }
    state.save();
    await tg.edit(chatId, cb.message.message_id,
      R.rReminderSettings(s, tzLabel()), { buttons: R.settingsButtons(s) });
  }

  async function handleCallback(cb) {
    await tg.answerCallback(cb.id);
    const chatId = cb.message?.chat?.id;
    if (!chatId || cb.from?.id !== cfg.ownerChatId) return;
    log('btn', cb.data || '');
    tg.typing(chatId); // «печатает…» и на кнопках
    if ((cb.data || '').startsWith('set:')) { await handleSettingsCallback(cb); return; }

    // Кнопки под «Нашёл встречу»: cal:fmove|fren|finv|fdel:<key> (тест 46)
    const fnd = /^cal:(fmove|fren|finv|fdel):(.+)$/.exec(cb.data || '');
    if (fnd) {
      const pending = state.data.pending[chatId];
      if (!pending || pending.kind !== 'found' || pending.key !== fnd[2]) {
        await tg.send(chatId, R.rStaleButton());
        return;
      }
      const e = pending.event;
      delete state.data.pending[chatId];
      state.save();
      if (fnd[1] === 'fdel') {
        await stripButtons(chatId, pending, '🗑 Удалить');
        const key = newPendingKey(chatId);
        const html = R.rConfirmDelete([viewFromEvent(e, calTz())]);
        const sent = await tg.send(chatId, html, { buttons: R.deleteButtons(key) });
        state.data.pending[chatId] = { key, kind: 'confirm', action: 'delete', events: [e], notFound: [], createdAt: now(), cardHtml: html, promptMsgId: sent.message_id };
        state.save();
        return;
      }
      if (fnd[1] === 'fmove') {
        await stripButtons(chatId, pending, '🔁 Перенести');
        const tz = e.tz || calTz();
        const s = DateTime.fromMillis(e.startMs, { zone: tz });
        const ev = { title: e.summary, date: s.toISODate(), time: s.toFormat('HH:mm'), tz, durationMin: Math.round((e.endMs - e.startMs) / 60000) };
        const msg2 = await tg.send(chatId, R.rAskNewTime(zoneLabel(calTz(), now())), { forceReply: true });
        state.data.pending[chatId] = { kind: 'await_reschedule', action: 'move', ev, eventId: e.id, createdAt: now(), promptMsgId: msg2.message_id };
        state.save();
        return;
      }
      const isRen = fnd[1] === 'fren';
      await stripButtons(chatId, pending, isRen ? '✏️ Переименовать' : '👥 Пригласить');
      const msg2 = await tg.send(chatId, isRen ? R.rAskRename() : R.rAskInvite(), { forceReply: true });
      state.data.pending[chatId] = { kind: isRen ? 'await_rename' : 'await_invite', event: e, createdAt: now(), promptMsgId: msg2.message_id };
      state.save();
      return;
    }

    // Кнопки «утра/вечера»: cal:am|pm:<key> (правка 23.07 вечер)
    const ampm = /^cal:(am|pm):(.+)$/.exec(cb.data || '');
    if (ampm) {
      const pending = state.data.pending[chatId];
      if (!pending || pending.kind !== 'await_ampm' || pending.key !== ampm[2]) {
        await tg.send(chatId, R.rStaleButton());
        return;
      }
      delete state.data.pending[chatId];
      state.save();
      const ev = { ...pending.ev };
      if (ampm[1] === 'pm') ev.time = `${String((+ev.time.slice(0, 2) % 12) + 12).padStart(2, '0')}:00`;
      await stripButtons(chatId, pending, ampm[1] === 'pm' ? '🌆 Вечера' : '🌅 Утра');
      if (pending.action === 'move') await resolveAndMaybeMove(chatId, { ...pending, kind: 'confirm', ev });
      else await askTimeOrCreate(chatId, ev);
      return;
    }

    // Выбор из «Найдено несколько»: cal:pick:<key>:<idx|all>
    const pick = /^cal:pick:([^:]+):(\d+|all)$/.exec(cb.data || '');
    if (pick) {
      const pending = state.data.pending[chatId];
      if (!pending || pending.kind !== 'choose' || pending.key !== pick[1]) {
        await tg.send(chatId, R.rStaleButton());
        return;
      }
      await resolveChoice(chatId, pending, pick[2] === 'all' ? 'all' : Number(pick[2]));
      return;
    }

    const m = /^cal:(add|reschedule|cancel):(.+)$/.exec(cb.data || '');
    if (!m) { await tg.send(chatId, R.rStaleButton()); return; }
    const [, action, key] = m;
    const pending = state.data.pending[chatId];
    if (!pending || pending.key !== key) { await tg.send(chatId, R.rStaleButton()); return; }

    if (action === 'cancel') {
      delete state.data.pending[chatId];
      state.save();
      const noLabel = pending.action === 'delete' || pending.action === 'move_all' ? '❌ Нет' : '❌ Отмена';
      await stripButtons(chatId, pending, noLabel);
      if (pending.action === 'delete') { await tg.send(chatId, R.rDeleteCancelled()); return; }
      if (pending.action === 'move_all') { await tg.send(chatId, R.rMoveCancelled()); return; }
      const { view } = pendingView(pending.ev);
      await tg.send(chatId, R.rCancelled(view));
      await nextFromQueue(chatId, pending); // очередь мульти-переноса: отмена одной не стопит остальные
      return;
    }
    if (action === 'add') {
      delete state.data.pending[chatId];
      state.save();
      const yesLabel = pending.action === 'delete' ? '✅ Да, удалить'
        : pending.action === 'move_all' ? '✅ Да, перенести' : '✅ Всё равно';
      await stripButtons(chatId, pending, yesLabel);
      if (pending.action === 'delete') await doDelete(chatId, pending);
      else if (pending.action === 'move_all') await doMoveAll(chatId, pending);
      else if (pending.action === 'move') await doMove(chatId, pending);
      else await doCreate(chatId, pending.ev);
      return;
    }
    if (pending.action === 'delete' || pending.action === 'move_all') { await tg.send(chatId, R.rStaleButton()); return; }
    // reschedule → просим новое время (forceReply)
    await stripButtons(chatId, pending, '🔁 Перенести');
    const msg = await tg.send(chatId, R.rAskNewTime(zoneLabel(calTz(), now())), { forceReply: true });
    state.data.pending[chatId] = { ...pending, kind: 'await_reschedule', createdAt: now(), promptMsgId: msg.message_id };
    state.save();
  }

  // ── Ответ на forceReply (уточнение времени / новое время) ────
  // Правило А (согласовано 2026-07-22): время без города — в зоне КАЛЕНДАРЯ,
  // город в ответе всегда побеждает.
  async function handleForceReplyAnswer(chatId, text, pending) {
    const parsed = parseWhen(text, calTz(), now());
    const ev = { ...pending.ev };
    let gotTime = false; // в ответе должно быть НОВОЕ время (или хотя бы дата)
    if (parsed?.time) { ev.time = parsed.time; gotTime = true; }
    if (parsed?.date) ev.date = parsed.date;
    ev.tz = parsed?.tz || calTz();

    // В ответе наговорили не только время, а ещё детали (название, длительность,
    // описание, место, участники) — вытаскиваем их классификатором и вливаем в встречу.
    if (text.length > 40 || /назов|названием/i.test(text)) {
      try {
        const c = await classifier.classify(text, classifyCtx());
        if (c.intent === 'create' || c.intent === 'update') {
          // «…назови встречу тест» в ответе на вопрос времени (правка 23.07 вечер)
          const namedTitle = (c.title || c.new_title || '').trim();
          if (namedTitle) ev.title = namedTitle;
          const dur = parseInt(c.duration_min, 10);
          if (dur > 0) ev.durationMin = dur;
          if (c.description) ev.description = c.description;
          if (c.location) ev.location = c.location;
          const emails = [...(c.attendees || []), ...(c.attendees_add || [])];
          if (emails.length) ev.attendees = [...new Set([...(ev.attendees || []), ...emails])];
          // время словами («на десять вечера») мог поймать только классификатор
          if (!gotTime && /^\d{2}:\d{2}$/.test(c.time_start || '')) {
            ev.time = c.time_start;
            gotTime = true;
            const ct = c.city ? detectCity(c.city) : null;
            if (ct) ev.tz = ct.tz;
          }
        }
      } catch (e) { console.error('detail merge failed:', e.message); }
    }

    if ((!gotTime && !parsed?.date) || !ev.time) { await tg.send(chatId, R.rBadTime(tzLabel())); return; }
    delete state.data.pending[chatId];
    state.save();
    // «в 8» в ответе — уточняем утра/вечера (правка 23.07 вечер)
    if (ampmAmbiguous(text, ev.time)) {
      await askAmPm(chatId, ev, pending.action === 'move' ? 'move' : 'create',
        pending.action === 'move' ? { eventId: pending.eventId, newTitle: pending.newTitle } : {});
      return;
    }
    if (pending.action === 'move') await resolveAndMaybeMove(chatId, { ...pending, ev });
    else await resolveAndMaybeCreate(chatId, ev);
  }

  // ── Главный обработчик update ────────────────────────────────
  async function handleUpdateObj(u) {
    try {
      if (u.callback_query) { await handleCallback(u.callback_query); return; }
      const msg = u.message;
      if (!msg) return;
      const chatId = msg.chat?.id;
      if (msg.from?.id !== cfg.ownerChatId) return; // личный секретарь — только владелец
      tg.typing(chatId); // «печатает…» — взял в работу (правка Стаса 23.07)

      let text = msg.text || '';
      if (msg.voice || msg.audio) {
        try {
          const fileId = (msg.voice || msg.audio).file_id;
          const buf = await tg.getVoice(fileId);
          text = await transcriber.transcribe(buf);
        } catch (e) {
          console.error('stt failed:', e.message);
          await tg.send(chatId, R.rFail());
          return;
        }
      }
      if (!text.trim()) return;
      log((msg.voice || msg.audio) ? 'voice' : 'msg', text.slice(0, 200));

      if (/^\/(start|help)\b/.test(text)) {
        await tg.send(chatId, R.rWelcome());
        return;
      }

      // Команды меню — чистый код, классификатор не вызывается
      if (/^\//.test(text) && !state.data.cache.tz) await refreshCache().catch(() => {});
      if (await handleMenuCommand(chatId, text)) return;

      // Выбор цифрой (или словом «все») при «Найдено несколько встреч»
      const choosing = state.data.pending[chatId];
      if (choosing && choosing.kind === 'choose') {
        if (choosing.action === 'delete' && /^\s*вс[её]\b/i.test(text)) {
          await resolveChoice(chatId, choosing, 'all');
          return;
        }
        const num = /^\s*(\d{1,2})/.exec(text);
        if (num) {
          const idx = Number(num[1]) - 1;
          if (idx >= 0 && idx < choosing.candidates.length) {
            await resolveChoice(chatId, choosing, idx);
            return;
          }
        }
      }

      // Ответ на forceReply-вопрос о времени. Контекст не теряем (глюк с «на 25:00»):
      // пока висит ожидание, ЛЮБОЕ сообщение с распознаваемым временем — это ответ,
      // даже если оно пришло не reply'ем (например, после «⚠️ Не понял время»).
      const pending = state.data.pending[chatId];

      // Ответ на «Новое название?» / «Кого пригласить?» (кнопки под «Нашёл встречу», тест 46)
      if (pending && (pending.kind === 'await_rename' || pending.kind === 'await_invite')) {
        delete state.data.pending[chatId];
        state.save();
        try {
          let patch;
          if (pending.kind === 'await_rename') {
            const nt = cleanTitle(text);
            if (!nt) { await tg.send(chatId, R.rFail()); return; }
            patch = { summary: nt };
          } else {
            const emails = text.match(/[\w.+-]+@[\w.-]+\.\w+/g) || [];
            if (!emails.length) { await tg.send(chatId, R.rFail()); return; }
            patch = { attendees: [...new Set([...(pending.event.attendees || []), ...emails])].map((em) => ({ email: em })) };
          }
          const raw = await gcal.patchEvent(pending.event.id, patch);
          await refreshCache();
          await tg.send(chatId, R.rUpdated(viewFromEvent(normEvent(raw), calTz())));
        } catch (e) {
          console.error('found action failed:', e.message);
          await tg.send(chatId, R.rCalError());
        }
        return;
      }

      // Ответ на вопрос о названии (правка 23.07): пока ждём название,
      // любой текст без «/» — это название (reply не обязателен).
      if (pending && pending.kind === 'await_title') {
        delete state.data.pending[chatId];
        state.save();
        const ev = { ...pending.ev, title: cleanTitle(text) };
        if (pending.ampm && ev.time) { await askAmPm(chatId, ev, 'create'); return; }
        await askTimeOrCreate(chatId, ev);
        return;
      }

      // Ответ текстом на вопрос «утра или вечера?» (кнопки — в handleCallback)
      if (pending && pending.kind === 'await_ampm' && /утр|вечер|ночи|дня|дн[её]м/i.test(text)) {
        delete state.data.pending[chatId];
        state.save();
        const ev = { ...pending.ev };
        if (/вечер|ночи/i.test(text)) ev.time = `${String((+ev.time.slice(0, 2) % 12) + 12).padStart(2, '0')}:00`;
        await stripButtons(chatId, pending, /вечер|ночи/i.test(text) ? '🌆 Вечера' : '🌅 Утра');
        if (pending.action === 'move') await resolveAndMaybeMove(chatId, { ...pending, kind: 'confirm', ev });
        else await askTimeOrCreate(chatId, ev);
        return;
      }

      if (pending && (pending.kind === 'await_time' || pending.kind === 'await_reschedule')) {
        const isReply = msg.reply_to_message &&
          (msg.reply_to_message.message_id === pending.promptMsgId ||
           /На какое время/.test(msg.reply_to_message.text || ''));
        const parsed = parseWhen(text, calTz(), now());
        if (isReply || (parsed && parsed.time)) {
          await handleForceReplyAnswer(chatId, text, pending);
          return;
        }
      }

      // Классификация
      if (!state.data.cache.tz) await refreshCache().catch(() => {});
      const tz = calTz();
      const nowDt = DateTime.fromMillis(now(), { zone: tz });
      const c = await classifier.classify(text, {
        todayISO: nowDt.toISODate(),
        tomorrowISO: nowDt.plus({ days: 1 }).toISODate(),
        weekdayRu: WD_RU[nowDt.weekday - 1],
        tz,
      });

      log('intent', JSON.stringify(c).slice(0, 300));
      tg.typing(chatId); // классификация долгая — обновить «печатает…» перед действием

      switch (c.intent) {
        case 'create': await handleCreate(chatId, c, text); break;
        case 'today': case 'tomorrow': case 'day_after_tomorrow':
        case 'weekday': case 'week': case 'next_week': case 'specific_date':
          await handleSchedule(chatId, c.intent, c); break;
        case 'delete': await handleDelete(chatId, c, text); break;
        case 'find': await handleFind(chatId, c, text); break;
        case 'update': await handleUpdate(chatId, c, text); break;
        case 'delete_all': await handleBulk(chatId, c, 'delete'); break;
        case 'move_all': await handleBulk(chatId, c, 'move'); break;
        case 'set_timezone': await handleSetTz(chatId, text, c); break;
        case 'get_timezone': await handleGetTz(chatId); break;
        default: {
          const answer = await classifier.freeAnswer(text);
          await tg.send(chatId, R.rFree(answer));
        }
      }
      log('done', c.intent);
    } catch (e) {
      log('err', e.message);
      console.error('router error:', e);
      const chatId = u.message?.chat?.id || u.callback_query?.message?.chat?.id;
      if (chatId) await tg.send(chatId, R.rFail()).catch(() => {});
    }
  }

  return { handleUpdate: handleUpdateObj, refreshCache, calTz };
}
