// Живой смоук-тест на сервере: реальные API (Google, Zoom, MiniMax, Telegram).
// Создаёт тест-событие с Meet+Zoom, проверяет ссылки, удаляет; классифицирует фразу;
// шлёт отчёт владельцу в Telegram. Запуск: docker compose run --rm secretary-bot node scripts/live-smoke.js
import { DateTime } from 'luxon';
import { loadConfig } from '../src/config.js';
import { createGcal } from '../src/gcal.js';
import { createZoomClient } from '../src/zoom.js';
import { createClassifier } from '../src/classifier.js';
import { createTelegram } from '../src/telegram.js';
import { meetLink } from '../src/gcal.js';

const cfg = loadConfig();
const results = [];
const ok = (name, detail = '') => { results.push(`✅ ${name}${detail ? ': ' + detail : ''}`); console.log(results.at(-1)); };
const fail = (name, e) => { results.push(`❌ ${name}: ${e.message}`); console.error(results.at(-1)); };

const gcal = createGcal({ credsFile: cfg.googleCredsFile, calendarId: cfg.calendarId });
const zoom = createZoomClient({ accountId: cfg.zoomAccountId, clientId: cfg.zoomClientId, clientSecret: cfg.zoomClientSecret });
const classifier = createClassifier({ baseUrl: cfg.minimaxBaseUrl, apiKey: cfg.minimaxKey, model: cfg.minimaxModel });
const tg = createTelegram({ token: cfg.tgToken });

// 1. Календарь: зона
let tz = 'Europe/Moscow';
try { tz = await gcal.getCalendarTz(); ok('Google Calendar доступен', `зона ${tz}`); }
catch (e) { fail('Google Calendar', e); }

// 2. Zoom: создание встречи
const start = DateTime.now().setZone(tz).plus({ days: 1 }).set({ hour: 3, minute: 0, second: 0, millisecond: 0 });
let zoomUrl = '';
try {
  const z = await zoom.createMeeting('Смоук-тест секретаря', start.toFormat("yyyy-MM-dd'T'HH:mm:ss"), 30, tz);
  zoomUrl = z.joinUrl;
  ok('Zoom создаёт встречу', zoomUrl.split('?')[0]);
} catch (e) { fail('Zoom', e); }

// 3. Google: событие с Meet + Zoom в описании
let evId = '';
try {
  const raw = await gcal.createEvent({
    summary: 'Смоук-тест секретаря (удалится сам)',
    startISO: start.toISO(), endISO: start.plus({ minutes: 30 }).toISO(), tz,
    description: zoomUrl ? `Zoom: ${zoomUrl}` : '',
  }, { meet: true });
  evId = raw.id;
  const meet = meetLink(raw);
  if (meet) ok('Meet-ссылка создаётся', meet);
  else fail('Meet-ссылка', new Error('hangoutLink пуст (проверь allowedConferenceSolutionTypes)'));
  ok('Событие создано', raw.htmlLink ? 'htmlLink есть' : 'без htmlLink');
} catch (e) { fail('Создание события', e); }

// 4. Удаление тест-события
if (evId) {
  try { await gcal.deleteEvent(evId); ok('Событие удалено'); }
  catch (e) { fail('Удаление события', e); }
}

// 5. Классификатор MiniMax-M3
try {
  const now = DateTime.now().setZone(tz);
  const c = await classifier.classify('поставь встречу с Иваном завтра в 15:00 по Москве', {
    todayISO: now.toISODate(), tomorrowISO: now.plus({ days: 1 }).toISODate(),
    weekdayRu: 'среда', tz,
  });
  if (c.intent === 'create' && c.time_start === '15:00' && c.date === now.plus({ days: 1 }).toISODate()) {
    ok('Классификатор', `intent=create, date=${c.date}, time=${c.time_start}, title=${c.title}`);
  } else fail('Классификатор', new Error(`неожиданный ответ: ${JSON.stringify(c)}`));
} catch (e) { fail('Классификатор', e); }

// 6. Классификатор: время не названо → пустое (не угадывает)
try {
  const now = DateTime.now().setZone(tz);
  const c = await classifier.classify('поставь встречу с Петей завтра', {
    todayISO: now.toISODate(), tomorrowISO: now.plus({ days: 1 }).toISODate(), weekdayRu: 'среда', tz,
  });
  if (c.intent === 'create' && (c.time_start || '') === '') ok('Классификатор не угадывает время');
  else fail('Классификатор (пустое время)', new Error(JSON.stringify(c)));
} catch (e) { fail('Классификатор (пустое время)', e); }

// 7. Telegram: отчёт владельцу
try {
  await tg.send(cfg.ownerChatId, '<b>🤖 Смоук-тест секретаря</b>\n' + '━'.repeat(20) + '\n\n' + results.join('\n'));
  ok('Telegram-отправка владельцу');
} catch (e) {
  fail('Telegram-отправка', e);
  console.error('Подсказка: если 403 или chat not found — нажми Start у своего бота в Telegram.');
}

const failed = results.filter((r) => r.startsWith('❌')).length;
console.log(`\nИтог: ${results.length - failed}/${results.length} ок`);
process.exit(failed ? 1 : 0);
