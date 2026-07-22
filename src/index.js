// Точка входа: сборка зависимостей, начальный кэш, long polling + тикер.
import { loadConfig } from './config.js';
import { createState } from './state.js';
import { createTelegram } from './telegram.js';
import { createGcal } from './gcal.js';
import { createZoomClient } from './zoom.js';
import { createClassifier } from './classifier.js';
import { createTranscriber } from './transcribe.js';
import { createRouter } from './router.js';
import { createScheduler } from './scheduler.js';

const cfg = loadConfig();
const state = createState(cfg.stateFile);
const tg = createTelegram({ token: cfg.tgToken });
const gcal = createGcal({ credsFile: cfg.googleCredsFile, calendarId: cfg.calendarId });
const zoom = createZoomClient({
  accountId: cfg.zoomAccountId, clientId: cfg.zoomClientId, clientSecret: cfg.zoomClientSecret,
});
const classifier = createClassifier({
  baseUrl: cfg.minimaxBaseUrl, apiKey: cfg.minimaxKey, model: cfg.minimaxModel, format: cfg.modelFormat,
});
const transcriber = createTranscriber({ apiKey: cfg.groqKey });

const router = createRouter({ tg, gcal, zoom, classifier, transcriber, state, cfg });
const scheduler = createScheduler({ tg, gcal, state, cfg, refreshCache: router.refreshCache });

console.log('secretary-bot starting…');
await router.refreshCache().catch((e) => console.error('initial cache failed:', e.message));
console.log(`calendar tz: ${router.calTz()}, events cached: ${state.data.cache.events.length}`);

// Меню бота — персонально владельцу (scope chat перебивает default,
// см. заметку telegram-role-menus-openclaw). Регистрируется кодом при старте.
// Порядок = UX: смотрю (каждый день) → действую → планирую окна → настраиваю (редко).
const MENU = [
  { command: 'today', description: '📅 Встречи сегодня' },
  { command: 'tomorrow', description: '📅 Встречи завтра' },
  { command: 'week', description: '📅 Встречи на неделе' },
  { command: 'next', description: '⏭ Ближайшая встреча + ссылки' },
  { command: 'add', description: '➕ Добавить встречу' },
  { command: 'free', description: '🟢 Свободные окна сегодня' },
  { command: 'free_week', description: '🟢 Окна на этой неделе' },
  { command: 'free_next', description: '🟢 Окна на следующей неделе' },
  { command: 'reminders', description: '⚙️ Настройки напоминаний' },
  { command: 'tz', description: '🌍 Моя таймзона' },
  { command: 'help', description: '❓ Что я умею' },
  { command: 'new', description: '🧹 Сброс — начать с чистого листа' },
];
await tg.api('setMyCommands', {
  commands: MENU,
  scope: { type: 'chat', chat_id: cfg.ownerChatId },
}).then(() => console.log('menu registered for owner'))
  .catch((e) => console.error('setMyCommands failed:', e.message));

// Описание бота (экран «что умеет бот» и строка в профиле) — тоже кодом.
await tg.api('setMyDescription', {
  description: 'Личный ИИ-секретарь: веду Google Календарь голосом и текстом. Создаю встречи с Google Meet и Zoom, переношу и удаляю (с подтверждением), показываю расписание и свободные окна, напоминаю за сутки/час/30/10/5 минут, присылаю план дня и недели. Понимаю таймзоны и массовые команды: «удали все встречи сегодня», «перенеси всё на неделю вперёд».',
}).catch((e) => console.error('setMyDescription failed:', e.message));
await tg.api('setMyShortDescription', {
  short_description: 'ИИ-секретарь: Google Календарь голосом. Meet+Zoom, напоминания, свободные окна.',
}).catch((e) => console.error('setMyShortDescription failed:', e.message));

setInterval(() => scheduler.tick().catch((e) => console.error('tick:', e)), 60_000);
tg.poll(router.handleUpdate);
