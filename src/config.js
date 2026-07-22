// Конфигурация из env. Секреты живут только в .env на сервере.
function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export function loadConfig(env = process.env) {
  return {
    tgToken: req('TG_TOKEN'),
    ownerChatId: Number(req('OWNER_CHAT_ID')),
    googleCredsFile: req('GOOGLE_CREDS_FILE'),
    calendarId: env.CALENDAR_ID || 'primary',
    // Модель-классификатор, два варианта (MODEL_FORMAT):
    //   'minimax' — MiniMax по API-ключу (по умолчанию);
    //   'openai'  — OpenAI-совместимый endpoint: OpenClaw gateway /v1 с Codex по подписке ChatGPT.
    // MINIMAX_* — старые имена переменных, поддерживаются для совместимости.
    minimaxKey: env.MODEL_API_KEY || req('MINIMAX_API_KEY'),
    minimaxBaseUrl: env.MODEL_BASE_URL || env.MINIMAX_BASE_URL || 'https://api.minimax.io/anthropic',
    minimaxModel: env.MODEL_NAME || env.MINIMAX_MODEL || 'MiniMax-M3',
    modelFormat: (env.MODEL_FORMAT || 'minimax').toLowerCase() === 'openai' ? 'openai' : 'minimax',
    groqKey: req('GROQ_API_KEY'),
    zoomAccountId: env.ZOOM_ACCOUNT_ID || '',
    zoomClientId: env.ZOOM_CLIENT_ID || '',
    zoomClientSecret: env.ZOOM_CLIENT_SECRET || '',
    stateFile: env.STATE_FILE || '/data/state.json',
    fallbackTz: env.FALLBACK_TZ || 'Europe/Moscow',
  };
}
