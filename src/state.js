// Состояние (ТЗ §8): pending_events (TTL 1ч), events_cache (обновление раз в час),
// alerted_events (24ч), даты утренней/недельной рассылки. Персистентно в JSON.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const HOUR = 3600_000;

// Настройки напоминаний (управляются кнопками /reminders).
// Дефолты = поведение из ТЗ: план дня 08:00 ежедневно, план недели Пн 09:00,
// перед встречей — за сутки/час/5 минут (30 и 10 минут выключены).
export const DEFAULT_SETTINGS = {
  morning: { enabled: true, days: [1, 2, 3, 4, 5, 6, 7], time: '08:00' },
  weekly: { enabled: true, time: '09:00' },
  tiers: { 1440: true, 60: true, 30: false, 10: false, 5: true },
};

export function createState(file) {
  let data = {
    pending: {},        // chatId -> {key, kind, ev, createdAt, promptMsgId?, eventId?}
    alerted: {},        // `${eventId}:${tier}` -> ts
    lastMorning: '',    // 'YYYY-MM-DD' в зоне календаря
    lastWeekly: '',     // 'YYYY-Wnn'
    cache: { tz: '', events: [], fetchedAt: 0 },
    settings: null,
  };
  try { data = { ...data, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { /* первый запуск */ }
  // Миграция/дозаполнение настроек (старые state.json без settings)
  data.settings = {
    morning: { ...DEFAULT_SETTINGS.morning, ...(data.settings?.morning || {}) },
    weekly: { ...DEFAULT_SETTINGS.weekly, ...(data.settings?.weekly || {}) },
    tiers: { ...DEFAULT_SETTINGS.tiers, ...(data.settings?.tiers || {}) },
  };

  function save() {
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, file);
    } catch (e) { console.error('state save failed:', e.message); }
  }

  // Чистка по TTL. Вызывается тикером раз в минуту.
  function sweep(nowMs = Date.now()) {
    let changed = false;
    for (const [chatId, p] of Object.entries(data.pending)) {
      if (nowMs - p.createdAt > HOUR) { delete data.pending[chatId]; changed = true; }
    }
    for (const [k, ts] of Object.entries(data.alerted)) {
      if (nowMs - ts > 24 * HOUR) { delete data.alerted[k]; changed = true; }
    }
    if (changed) save();
    return changed;
  }

  return { data, save, sweep };
}

// pending_key = <chat_id>_<8 случайных символов>; только latin+цифры (лимит 64 байта, без кириллицы).
export function newPendingKey(chatId) {
  return `${chatId}_${randomBytes(6).toString('base64url').slice(0, 8)}`;
}
