// Рендер ВСЕХ сообщений (ТЗ §6). Только код, никакой модели.
// Правила: parse_mode HTML; esc() для любого пользовательского/гуглового текста;
// разделитель шапки — ровно 20 символов '━'.

export const DIV = '━'.repeat(20);

export const esc = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Внутренние блоки ─────────────────────────────────────────────

// v: {title,dateRu,clock,t1,t2,zone, alt?, attendees?, location?, description?, links?, htmlLink?}
// alt: {clock,t1,t2,zone}; links: [{label,url}]
// Карточка собирается из 4 групп, между группами — пустая строка
// (читаемость, правка Стаса от 2026-07-22): 1) что/когда · 2) детали · 3) созвон · 4) календарь.
function eventBlock(v, { boldTime = true, withAttendees = false, withLocation = false, withDescription = false, withLinks = false, withOpen = false } = {}) {
  const g1 = [];
  g1.push(`📌 <b>${esc(v.title)}</b>`);
  g1.push(`🗓 ${v.dateRu}`);
  const t = `${v.t1} – ${v.t2} ${v.zone}`;
  g1.push(`${v.clock} ${boldTime ? `<b>${t}</b>` : t}`);
  if (v.alt) g1.push(`${v.alt.clock} ${v.alt.t1} – ${v.alt.t2} ${v.alt.zone}`);
  // Серия (24.07): подробное описание, если известно, иначе просто бейдж
  if (v.recurDesc) g1.push(`🔁 ${esc(v.recurDesc)}`);
  else if (v.recur) g1.push('🔁 повторяется');
  const g2 = [];
  if (withAttendees && v.attendees && v.attendees.length) g2.push(`👥 ${v.attendees.map(esc).join(', ')}`);
  if (withLocation && v.location) g2.push(`📍 ${esc(v.location)}`);
  if (withDescription && v.description) g2.push(`📝 ${esc(v.description)}`);
  const g3 = [];
  if (withLinks && v.links) for (const l of v.links) g3.push(`💻 <a href="${esc(l.url)}">${l.label}</a>`);
  const g4 = [];
  if (withOpen && v.htmlLink) g4.push(`👉 <a href="${esc(v.htmlLink)}">Открыть в Google Календаре</a>`);
  return [g1, g2, g3, g4].filter((g) => g.length).map((g) => g.join('\n')).join('\n\n');
}

const head = (title) => `<b>${title}</b>\n${DIV}\n\n`;

// ── 6.1 Встреча создана ──────────────────────────────────────────
export function rCreated(v) {
  return head('✅ Встреча добавлена в календарь!') +
    eventBlock(v, { withAttendees: true, withLocation: true, withDescription: true, withLinks: true, withOpen: true });
}

// ── 6.2 Расписание на день ───────────────────────────────────────
// line: {clock,t1,t2,zone, alt?, url, title}
function scheduleLine(l) {
  let s = `${l.clock} <b>${l.t1} – ${l.t2} ${l.zone}</b>`;
  if (l.alt) s += ` ${l.alt.clock} ${l.alt.t1} – ${l.alt.t2} ${l.alt.zone}`;
  s += ` • ${l.recur ? '🔁 ' : ''}<a href="${esc(l.url)}">${esc(l.title)}</a>`;
  return s;
}

export function rDaySchedule(header, dayHdr, lines, { morning = false } = {}) {
  let out = `🗒 <b>Расписание ${header}</b>\n${DIV}\n\n🗓 <b>${dayHdr}</b>\n\n`;
  if (!lines.length) {
    out += morning ? '<i>Встреч нет. Отличный день для глубокой работы.</i>' : '<i>Встреч нет.</i>';
  } else {
    out += lines.map(scheduleLine).join('\n');
  }
  return out;
}

// ── 6.3 Расписание на неделю ─────────────────────────────────────
// days: [{hdr:'ПН, 13 июля', lines:[...]}] — только дни с событиями
export function rWeekSchedule(header, days) {
  let out = `🗒 <b>Расписание ${header}</b>\n${DIV}\n\n`;
  if (!days.length) return out + '<i>Встреч нет.</i>';
  out += days.map((d) => `🗓 <b>${d.hdr}:</b>\n\n${d.lines.map(scheduleLine).join('\n')}`).join('\n\n');
  return out;
}

// ── 6.4 Конфликт времени (единственное сообщение с кнопками) ─────
// conflicts: [{title,t1,t2,zone}]; freeSlotsToday: [{clock,t1,t2,dur}] —
// свободные окна в день встречи, куда она влезает (расширение по просьбе Стаса).
export function rConflict(v, conflicts, freeSlotsToday = []) {
  let out = head('⚠️ Конфликт времени') +
    eventBlock(v) + '\n\n⛔ Пересекается с:\n' +
    conflicts.map((c) => `• <b>${esc(c.title)}</b> ${c.t1}–${c.t2} ${c.zone}`).join('\n');
  if (freeSlotsToday.length) {
    out += '\n\n🟢 Свободно в этот день:\n' +
      freeSlotsToday.map((s) => `${s.clock} <b>${s.t1} – ${s.t2}</b> · ${s.dur}`).join('\n');
  }
  return out + '\n\nЧто делаем?';
}

export function conflictButtons(pendingKey) {
  return [[
    { text: '✅ Всё равно', callback_data: `cal:add:${pendingKey}` },
    { text: '🔁 Перенести', callback_data: `cal:reschedule:${pendingKey}` },
    { text: '❌ Отмена', callback_data: `cal:cancel:${pendingKey}` },
  ]];
}

// Подсказка про зону (правило А: голое время = зона календаря).
const tzHint = (zone) => `\n\n<i>⏱ Время без города — в твоей зоне: ${zone}. Хочешь другую — назови город: «на 20 по Москве».</i>`;

// ── «В 8 утра или вечера?» (правка 23.07 вечер) ──────────────────
export function rAskAmPm(title, hour) {
  return head('🕗 Утра или вечера?') +
    (title ? `📌 <b>${esc(title)}</b>\n` : '') +
    `Ты сказал «в ${hour}» — это ${hour}:00 утра или ${hour + 12}:00 вечера?`;
}
export function ampmButtons(pendingKey) {
  return [[
    { text: '🌅 Утра', callback_data: `cal:am:${pendingKey}` },
    { text: '🌆 Вечера', callback_data: `cal:pm:${pendingKey}` },
  ]];
}

// ── «Это время уже в прошлом» (правка Стаса 24.07) ───────────────
export function rPastTime(v) {
  return head('⏰ Это время уже в прошлом') +
    eventBlock(v) +
    '\n\nЧто делаем — поставить всё равно, выбрать другое время или отменить?';
}

// ── Уточнение названия (forceReply) — правка 23.07: дефолт «Встреча» убран ──
export function rAskTitle() {
  return head('📝 Как назвать встречу?') +
    'Ответь на это сообщение названием — например «Созвон с командой».';
}

// ── 6.5 Уточнение времени (forceReply) ───────────────────────────
export function rAskTime(title, zone) {
  return head('🕒 На какое время поставить встречу?') +
    `📌 <b>${esc(title)}</b>\n\nОтветь на это сообщение временем — например «в 14:00», «на 9 утра по Москве».` +
    tzHint(zone);
}

// ── 6.6 Запрос нового времени при переносе (forceReply) ──────────
export function rAskNewTime(zone) {
  return '<b>🕒 На какое время перенести?</b>\n\nНапиши новое время в ответе на это сообщение, например «на 14 МСК» или «в 15:30».' +
    tzHint(zone);
}

// ── 6.7 Отмена создания ──────────────────────────────────────────
export function rCancelled(v) {
  return head('❌ Встреча не добавлена') + eventBlock(v, { boldTime: false });
}

// ── 6.8 Не понял время ───────────────────────────────────────────
export function rBadTime(zone) {
  return head('⚠️ Не понял время') +
    'Попробуй ещё раз — например: «на 14 МСК», «в пятницу 20:00» или «завтра в 15:30».' +
    tzHint(zone);
}

// ── 6.9 Кнопка устарела ──────────────────────────────────────────
export function rStaleButton() {
  return head('⚠️ Кнопка устарела') + 'Встреча уже отменена или истекла. Запланируй её заново.';
}

// ── 6.10 Таймзона переключена ────────────────────────────────────
export function rTzSwitched(cityName, tz, gmt) {
  return head('🌍 Таймзона переключена') +
    `📍 <b>${esc(cityName)}</b> (${tz}, ${gmt})\nВсе будущие сообщения и расписания — в этой зоне.`;
}

// ── 6.11 Зона не распознана ──────────────────────────────────────
export function rTzUnknown() {
  return head('⚠️ Не удалось распознать зону') +
    'Попробуй: «переключи таймзону на Москву / Тбилиси / Коломбо».';
}

// ── 6.12 Текущая таймзона ────────────────────────────────────────
export function rTzCurrent(label, tz, gmt, nowHM) {
  return head('🌍 Твоя текущая таймзона') +
    `📍 <b>${label}</b> (${tz}, ${gmt})\n🕒 Сейчас здесь <b>${nowHM}</b>`;
}

// ── 6.13 Встреча удалена / удалены ───────────────────────────────
// views: [eventView], notFound: ['X','Y']
export function rDeleted(views, notFound = [], scopeLabel = '') {
  const title = views.length > 1 ? '✅ Встречи удалены' : '✅ Встреча удалена';
  let out = head(title) + views.map((v) => eventBlock(v)).join('\n\n');
  if (scopeLabel) out += `\n\n🔁 Объём: <b>${scopeLabel}</b>`;
  if (notFound.length) out += `\n\n📝 Не найдены: ${notFound.map(esc).join(', ')}`;
  return out;
}

// ── 6.14 Встреча перенесена / перенесены ─────────────────────────
export function rMoved(views, notFound = [], scopeLabel = '') {
  const title = views.length > 1 ? '🔄 Встречи перенесены' : '🔄 Встреча перенесена';
  // Полная карточка (как у «создана»): встреча живая, ссылки актуальны.
  let out = head(title) + views.map((v) => eventBlock(v, { withAttendees: true, withLocation: true, withDescription: true, withLinks: true, withOpen: true })).join('\n\n');
  if (scopeLabel) out += `\n\n🔁 Объём: <b>${scopeLabel}</b>`;
  if (notFound.length) out += `\n\n📝 Не найдены: ${notFound.map(esc).join(', ')}`;
  return out;
}

// Обновление без переноса времени (описание/участники/длительность) —
// расширение ТЗ: та же структура, свой заголовок.
export function rUpdated(v) {
  return head('🔄 Встреча обновлена') +
    eventBlock(v, { withAttendees: true, withLocation: true, withDescription: true, withLinks: true, withOpen: true });
}

// Подтверждение удаления (защита от случайных удалений, правка Стаса).
// more — сколько встреч не влезло в карточку (они тоже будут удалены).
export function rConfirmDelete(views, notFound = [], more = 0, scopeLabel = '') {
  const title = views.length > 1 || more ? '🗑 Удалить встречи?' : '🗑 Удалить встречу?';
  let out = head(title) + views.map((v) => eventBlock(v)).join('\n\n');
  if (scopeLabel) out += `\n\n🔁 Объём: <b>${scopeLabel}</b>`;
  if (more > 0) out += `\n\n…и ещё ${more} — тоже будут удалены.`;
  if (notFound.length) out += `\n\n📝 Не найдены: ${notFound.map(esc).join(', ')}`;
  return out + '\n\nТочно удаляем?';
}

// Подтверждение массового переноса («заболел — сдвинь всё на неделю»).
export function rConfirmMove(views, shiftDays, more = 0) {
  const dir = shiftDays >= 0 ? 'вперёд' : 'назад';
  const n = Math.abs(shiftDays);
  let out = head('🔄 Перенести встречи?') +
    `Сдвигаю всё ниже на <b>${n} дн. ${dir}</b>:\n\n` +
    views.map((v) => eventBlock(v)).join('\n\n');
  if (more > 0) out += `\n\n…и ещё ${more} — тоже будут перенесены.`;
  return out + '\n\nТочно переносим?';
}
export function moveButtons(pendingKey) {
  return [[
    { text: '✅ Да, перенести', callback_data: `cal:add:${pendingKey}` },
    { text: '❌ Нет', callback_data: `cal:cancel:${pendingKey}` },
  ]];
}
export function rMoveCancelled() {
  return head('❌ Отмена') + 'Ничего не переношу.';
}

// За период встреч не нашлось (массовые операции).
export function rNoEventsRange(header) {
  return head('🤷 Встреч нет') + `За период ${header} ничего не нашёл.`;
}
export function deleteButtons(pendingKey) {
  return [[
    { text: '✅ Да, удалить', callback_data: `cal:add:${pendingKey}` },
    { text: '❌ Нет', callback_data: `cal:cancel:${pendingKey}` },
  ]];
}
export function rDeleteCancelled() {
  return head('❌ Отмена') + 'Ничего не удалил.';
}

// ── Участник ответил на приглашение (правка 23.07 вечер) ─────────
export function rAttendeeResponse(v, email, status) {
  const M = {
    accepted: '✅ принял(а) приглашение',
    declined: '❌ отклонил(а) приглашение',
    tentative: '🤔 ответил(а) «возможно»',
  };
  return head('👥 Ответ на приглашение') +
    `<b>${esc(email)}</b> ${M[status] || status}\n\n` +
    eventBlock(v, { withOpen: true });
}

// Кнопки под найденной встречей (правка Стаса 23.07 вечер, тест 46)
export function foundButtons(pendingKey) {
  return [[
    { text: '🔁 Перенести', callback_data: `cal:fmove:${pendingKey}` },
    { text: '✏️ Переименовать', callback_data: `cal:fren:${pendingKey}` },
  ], [
    { text: '👥 Пригласить', callback_data: `cal:finv:${pendingKey}` },
    { text: '🗑 Удалить', callback_data: `cal:fdel:${pendingKey}` },
  ]];
}
export function rAskRename() {
  return head('✏️ Новое название?') + 'Ответь на это сообщение новым названием встречи.';
}
export function rAskInvite() {
  return head('👥 Кого пригласить?') + 'Ответь почтой участника — можно несколько, через запятую.';
}

// ── Интент find — найдено по запросу (правка 23.07) ──────────────
export function rFound(views) {
  const title = views.length > 1 ? '🔍 Нашёл встречи' : '🔍 Нашёл встречу';
  return head(title) +
    views.map((v) => eventBlock(v, { withAttendees: true, withLocation: true, withLinks: true, withOpen: true })).join('\n\n');
}

// ── 6.15 Встреча не найдена ──────────────────────────────────────
export function rNotFound(titles) {
  return head('❌ Встреча не найдена') +
    `📌 <b>${titles.map(esc).join(', ')}</b>\n📝 В календаре нет события с таким названием.`;
}

// ── 6.16 Найдено несколько ───────────────────────────────────────
// items: [{title, dayMonth:'13 июля', clock, t1, zone}]; action: 'delete'|'update'
export function rAmbiguous(items, action = 'update') {
  const q = action === 'delete' ? '🗑 Какую удалить?'
    : action === 'find' ? '👀 С какой работаем?' : '🔄 Какую изменить?';
  const hint = 'Жми кнопку с номером или напиши цифру.' +
    (action === 'delete' && items.length > 1 ? ' Все сразу — кнопка «Удалить все».' : '');
  return head('🔍 Найдено несколько встреч') +
    q + '\n\n' +
    items.map((it, i) => `${i + 1}) <b>${esc(it.title)}</b> — ${it.dayMonth}, ${it.clock} ${it.t1} ${it.zone}`).join('\n') +
    `\n\n<i>${hint}</i>`;
}

// Кнопки выбора встречи: 1 кнопка = 1 ряд, в один столбец (правка Стаса 23.07),
// подпись «1 · ПТ, 24 июля»; + «Удалить все» для удаления.
export function pickButtons(pendingKey, n, { withAll = false, labels = null } = {}) {
  const rows = Array.from({ length: n }, (_, i) => [{
    text: labels ? labels[i] : String(i + 1),
    callback_data: `cal:pick:${pendingKey}:${i}`,
  }]);
  if (withAll && n > 1) rows.push([{ text: '🗑 Удалить все', callback_data: `cal:pick:${pendingKey}:all` }]);
  return rows;
}

// ── 6.17 Ошибка календаря ────────────────────────────────────────
export function rCalError() {
  return head('⚠️ Ошибка календаря') + 'Не удалось получить список событий. Попробуй позже.';
}

// ── 6.18 Напоминание ─────────────────────────────────────────────
// tierLabel: 'сутки' | 'час' | '5 минут'
export function rReminder(v, tierLabel) {
  return head(`🔔 Встреча через ${tierLabel}!`) +
    eventBlock(v, { withLocation: true, withLinks: true, withOpen: true });
}

// ── 6.19 Утреннее расписание ─────────────────────────────────────
export function rMorning(dayHdr, lines) {
  return rDaySchedule('на сегодня', dayHdr, lines, { morning: true });
}

// ── 6.20 Свободный ответ ─────────────────────────────────────────
export function rFree(text) {
  return esc(text);
}

// ── /next — ближайшая встреча (кнопка меню, только код) ─────────
export function rNext(v) {
  return head('⏭ Ближайшая встреча') +
    eventBlock(v, { withAttendees: true, withLocation: true, withLinks: true, withOpen: true });
}
export function rNextNone() {
  return head('⏭ Ближайшая встреча') + '<i>Впереди встреч нет (горизонт — 60 дней).</i>';
}

// ── /free — свободные окна (кнопки меню, только код) ─────────────
const FREE_HINT = '\n\n<i>Занять окно: /add или просто скажи голосом.</i>';
const slotLine = (s) => `${s.clock} <b>${s.t1} – ${s.t2}</b> · ${s.dur}`;

// slots: [{clock, t1, t2, dur}]
export function rFreeSlots(dayHdr, slots) {
  const out = `🗒 <b>Свободные окна на сегодня</b>\n${DIV}\n\n🗓 <b>${dayHdr}</b>\n\n`;
  if (!slots.length) return out + '<i>Свободных окон не осталось.</i>';
  return out + slots.map(slotLine).join('\n') + FREE_HINT;
}

// header: 'на этой неделе (22–26 июля 2026)' | 'на следующей неделе (…)'
// days: [{hdr:'СР, 22 июля', slots:[…]}] — только дни, где есть окна
export function rFreeWeek(header, days) {
  const out = `🗒 <b>Свободные окна ${header}</b>\n${DIV}\n\n`;
  if (!days.length) return out + '<i>Свободных окон нет.</i>';
  return out +
    days.map((d) => `🗓 <b>${d.hdr}:</b>\n\n${d.slots.map(slotLine).join('\n')}`).join('\n\n') +
    FREE_HINT;
}

// ── /add — запрос новой встречи (forceReply) ─────────────────────
export function rAskWhat() {
  return head('➕ Новая встреча') +
    'Ответь на это сообщение — текстом или голосом 🎙\n\n' +
    '📌 Что за встреча\n' +
    '🗓 Когда и во сколько (и город, если не твоя зона)\n' +
    '👥 Кого позвать — почтой\n\n' +
    '<i>Например: «Встреча с Иваном завтра в 15:00 по Москве, позови petya@mail.ru»</i>';
}

// ── /new — сброс ожиданий (кнопка меню, только код) ──────────────
export function rReset(hadPending) {
  if (hadPending) {
    return head('🧹 Сброшено') + 'Отменил незавершённое действие. Начинаем с чистого листа — что планируем?';
  }
  return head('🧹 Чистый лист') + 'Незавершённых действий не было. Что планируем?';
}

// Неизвестная /команда — детерминированный ответ кодом, без модели.
export function rUnknownCmd() {
  return head('🤷 Не знаю такую команду') + 'Жми синюю кнопку «Меню» внизу или /help.';
}

// ── /reminders — настройки напоминаний (кнопки, только код) ──────
const DAY_ABBR = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
export const TIER_MINUTES = [1440, 60, 30, 10, 5];
export const TIER_LABELS = { 1440: 'сутки', 60: 'час', 30: '30 минут', 10: '10 минут', 5: '5 минут' };
const TIER_SHORT = { 1440: 'Сутки', 60: 'Час', 30: '30м', 10: '10м', 5: '5м' };

export function rReminderSettings(s, zone) {
  const days = s.morning.days.length === 7 ? 'каждый день'
    : (s.morning.days.length ? s.morning.days.map((d) => DAY_ABBR[d - 1]).join(' ') : 'дни не выбраны');
  const tiersOn = TIER_MINUTES.filter((m) => s.tiers[m]).map((m) => TIER_LABELS[m]);
  return head('⚙️ Напоминания') +
    `🌅 План дня: ${s.morning.enabled ? `${s.morning.time} · ${days}` : 'выкл'}\n` +
    `🗓 План недели: ${s.weekly.enabled ? `ПН ${s.weekly.time}` : 'выкл'}\n` +
    `🔔 Перед встречей: ${tiersOn.length ? 'за ' + tiersOn.join(' · ') : 'выкл'}\n\n` +
    `<i>Все времена — в твоей зоне: ${zone}. Жми кнопки — карточка обновится.</i>`;
}

export function settingsButtons(s) {
  const on = (flag, label) => (flag ? `${label} ✓` : label);
  return [
    [{ text: s.morning.enabled ? '🌅 План дня: вкл' : '🌅 План дня: выкл', callback_data: 'set:mo' }],
    [1, 2, 3, 4, 5, 6, 7].map((d) => ({ text: on(s.morning.days.includes(d), DAY_ABBR[d - 1]), callback_data: `set:md:${d}` })),
    ['07:00', '08:00', '09:00', '10:00'].map((t) => ({ text: s.morning.time === t ? `${t} •` : t, callback_data: `set:mt:${t}` })),
    TIER_MINUTES.map((m) => ({ text: on(Boolean(s.tiers[m]), TIER_SHORT[m]), callback_data: `set:t:${m}` })),
    [
      { text: s.weekly.enabled ? '🗓 План недели: вкл' : '🗓 План недели: выкл', callback_data: 'set:wo' },
      { text: `ПН ${s.weekly.time}`, callback_data: 'set:wt' },
    ],
  ];
}

// Приветствие на /start — рендерится кодом, модель не участвует.
export function rWelcome() {
  return head('👋 Привет! Я — твой ИИ-секретарь') +
    'Веду твой Google Календарь голосом и текстом. В каждую встречу сам вшиваю ссылки <b>Google Meet</b> и <b>Zoom</b>.\n\n' +
    '📌 <b>Создать:</b> «Встреча с Иваном завтра в 15:00 по Москве, на полтора часа, позови petya@mail.ru»\n' +
    '🗒 <b>Посмотреть:</b> «Что у меня сегодня / на этой неделе» или /today, /week\n' +
    '🟢 <b>Свободные окна:</b> /free — сегодня, /free_week и /free_next — по неделям\n' +
    '🔄 <b>Изменить:</b> «Перенеси Ивана на пятницу на 20:00», «Увеличь до двух часов», «Добавь описание и позови…»\n' +
    '❌ <b>Удалить:</b> «Удали Тест-1 и Тест-2» — спрошу подтверждение кнопками\n' +
    '🧹 <b>Массово:</b> «Удали все встречи сегодня», «Перенеси все встречи на неделю вперёд»\n' +
    '🔁 <b>Серии:</b> «Йога каждый ПН и ПТ с 11:00 на 8 недель» — при удалении/переносе спрошу: только эту, эту и следующие или всю серию\n' +
    '🌍 <b>Таймзоны:</b> «Переключи зону на Москву» · «Какая у меня зона»\n\n' +
    '⚠️ Пересечения замечу сам и сразу предложу свободные окна дня.\n' +
    '🔍 Встреч с одним названием несколько — дам выбрать кнопкой-номером.\n' +
    '🔔 Напоминания (за сутки/час/30/10/5 мин), план дня и план недели — настрой кнопками в ⚙️ /reminders.\n\n' +
    '🎙 Говори голосом — я понимаю.';
}

// ── Повторяющиеся встречи (24.07) ────────────────────────────────

// Карточка серии перед созданием: полная карточка + строка 🔁 (recurDesc в view).
export function rConfirmRecur(v) {
  return head('🔁 Повторяющаяся встреча') +
    eventBlock(v, { withAttendees: true, withLocation: true, withDescription: true }) +
    '\n\nСтавим серию?';
}
export function recurButtons(pendingKey) {
  return [[
    { text: '✅ Поставить', callback_data: `cal:add:${pendingKey}` },
    { text: '❌ Отмена', callback_data: `cal:cancel:${pendingKey}` },
  ]];
}

// Конфликты экземпляров серии (решение Стаса №3: три кнопки сразу).
// conflicts: [{dayMonth:'ПН, 28 июля', title, t1, t2, zone}], more — не влезло в карточку.
export function rRecurConflict(v, conflicts, more = 0) {
  let out = head('⚠️ Конфликты в серии') + eventBlock(v) +
    '\n\n⛔ Пересекаются:\n' +
    conflicts.map((c) => `• ${c.dayMonth} — <b>${esc(c.title)}</b> ${c.t1}–${c.t2} ${c.zone}`).join('\n');
  if (more > 0) out += `\n…и ещё ${more}`;
  return out + '\n\nЧто делаем? «Пропустить эти дни» — серия встанет, конфликтные даты останутся пустыми.';
}
export function recurConflictButtons(pendingKey) {
  return [[
    { text: '✅ Всё равно', callback_data: `cal:add:${pendingKey}` },
    { text: '⏭ Пропустить эти дни', callback_data: `cal:skipdays:${pendingKey}` },
  ], [
    { text: '❌ Отмена', callback_data: `cal:cancel:${pendingKey}` },
  ]];
}

// Доспрос частоты (forceReply): «повторяющуюся встречу» без деталей.
export function rAskRecurFreq(title) {
  return head('🔁 Как часто повторять?') +
    (title ? `📌 <b>${esc(title)}</b>\n` : '') +
    'Ответь на это сообщение — например «каждый понедельник и пятницу», «по будням», «каждый день», «раз в 2 недели».';
}
// Несколько создаваемых встреч в одной фразе — бот ведёт по очереди сам
// (приёмка 24.07: «Тест 2» сначала терялся, потом требовал отдельную фразу).
export function rMoreTitles(titles) {
  return head('📝 Ставлю по очереди') +
    `Сначала первая встреча, потом сам продолжу со: <b>${titles.map(esc).join(', ')}</b>.`;
}

// Разные времена в разные дни — одной серией не бывает (RRULE), честно говорим.
export function rRecurMultiTime() {
  return head('🕒 Разные времена — это разные серии') +
    'В одной серии время одно на все дни. Давай по очереди: сначала, например, «каждый ПН в 6:30», ' +
    'а вторую поставим следом отдельной фразой.\n\nИтак: как часто повторять эту встречу?';
}

export function rBadRecur() {
  return head('⚠️ Не понял, как часто') +
    'Скажи, например: «каждый вторник», «по будням», «каждый день» или «каждую вторую субботу».';
}

// Доспрос конца серии (решение Стаса №2: спрашиваем всегда, если не сказал).
export function rAskRecurEnd(title) {
  return head('📅 Докуда повторять?') +
    (title ? `📌 <b>${esc(title)}</b>\n` : '') +
    'Ответь на это сообщение — например «до конца августа», «на 8 недель», «10 раз» или «бессрочно».';
}
export function rBadRecurEnd() {
  return head('⚠️ Не понял, докуда') +
    'Скажи, например: «до конца августа», «до 15 сентября», «на 8 недель», «10 раз» или «бессрочно».';
}

// Вопрос объёма операции с серией (решение Стаса №1: все три варианта).
// action: 'delete' | 'move'.
export function rAskSeriesScope(action, v) {
  const q = action === 'delete' ? 'Что удаляем?' : 'Что переносим?';
  return head('🔁 Это повторяющаяся встреча') + eventBlock(v, { boldTime: false }) + `\n\n${q}`;
}
export function seriesScopeButtons(pendingKey, dateLabel) {
  return [
    [{ text: `Только эту (${dateLabel})`, callback_data: `cal:scope:${pendingKey}:one` }],
    [{ text: 'Эту и все следующие', callback_data: `cal:scope:${pendingKey}:fol` }],
    [{ text: 'Всю серию', callback_data: `cal:scope:${pendingKey}:all` }],
    [{ text: '❌ Отмена', callback_data: `cal:scope:${pendingKey}:x` }],
  ];
}

// Пометка объёма в подтверждении удаления серии.
export const SCOPE_LABELS = { one: 'только это занятие', fol: 'это занятие и все следующие', all: 'вся серия' };

// Для всей серии бот меняет только время — дни серии меняются пересозданием.
export function rSeriesMoveHint() {
  return head('🤔 Для всей серии меняю только время') +
    'Скажи, например: «перенеси всю йогу на 12:00» или «сдвинь всю серию на час позже».\n' +
    'Поменять дни недели — удали серию и поставь заново: «йога каждый ВТ и ЧТ в 11».';
}

// Детерминированная заглушка при внутренней ошибке (не молчать — урок дефекта №3).
export function rFail() {
  return head('⚠️ Ошибка') + 'Что-то пошло не так. Попробуй ещё раз.';
}
