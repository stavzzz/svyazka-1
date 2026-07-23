# Связка 1 — Личный ИИ-секретарь в Telegram

Бот ведёт ваш Google Календарь голосом и текстом: ставит, переносит и удаляет встречи, вшивает ссылки Google Meet и Zoom, напоминает, присылает план дня и показывает свободные окна.

Пошаговая инструкция сборки: **https://edu.stas-pankov.app/svyazka-1/**
Техзадание и чек-лист приёмки — в папке [docs/](docs/).

## Как это устроено

Сам агент — **самописный код** (Node 22 в докере): все ответы, кнопки, даты, конфликты и напоминания считает программа — детерминированно, одна и та же фраза даёт побайтово одинаковый ответ, кнопки меню работают вообще без модели. Модель (LLM) используется ровно в одном месте — понять фразу и превратить её в строгий JSON-команду:

```
Telegram (текст/голос) → Whisper (голос → текст)
  → Модель — ТОЛЬКО классификация: фраза → строгий JSON {команда, поля}
  → Программный код: зоны, даты, конфликты, все сообщения, кнопки, планировщики
  → Google Calendar API (+ Google Meet) и Zoom
```

## Модель-классификатор: два варианта на выбор

| | **Вариант 1 (основной): подписка ChatGPT (Codex)** | Вариант 2: MiniMax |
|---|---|---|
| Что нужно | Подписка ChatGPT (Plus и выше) + **OpenClaw на этом же VPS** | API-ключ MiniMax |
| Нужен ли OpenClaw | **Да** — модель ходит через OpenClaw gateway | **Нет** — OpenClaw не обязателен вообще |
| Оплата за токены | Нет — тратится квота вашей подписки | Да, по ключу (классификация стоит копейки) |

### Вариант 1: подписка ChatGPT (Codex) через OpenClaw

У подписки ChatGPT нет официального API — напрямую из кода её использовать нельзя. Мост делает OpenClaw: он умеет авторизоваться в вашу подписку (как это делает Codex) и выдаёт боту обычный OpenAI-совместимый эндпоинт `/v1/chat/completions`. Агент остаётся самописным — через OpenClaw ходит только модель.

1. Подключите подписку (откроется браузер, логин в ваш ChatGPT-аккаунт):
   ```bash
   openclaw models auth login --provider openai
   ```
2. В `~/.openclaw/openclaw.json` включите эндпоинт и заведите лёгкого агента-классификатора (без инструментов — он только парсит фразы):
   ```json5
   {
     "gateway": { "http": { "endpoints": { "chatCompletions": { "enabled": true } } } },
     "agents": { "list": [
       // ...ваши агенты...
       {
         "id": "secretary-clf",
         "name": "Secretary Classifier",
         "workspace": "/root/.openclaw/workspace-secretary-clf",
         "model": { "primary": "openai/gpt-5.6-sol", "fallbacks": [] },
         "skills": [],
         "tools": { "allow": [], "deny": ["read","write","edit","apply_patch","browser","canvas","cron","exec","message","sessions_history","sessions_list","memory_search","memory_get"] }
       }
     ] }
   }
   ```
3. Положите агенту «душу парсера» (иначе модель будет болтать вместо JSON):
   ```bash
   mkdir -p ~/.openclaw/workspace-secretary-clf
   cp docs/SOUL-classifier.md ~/.openclaw/workspace-secretary-clf/SOUL.md
   ```
4. Перезапустите gateway: `openclaw gateway restart`.
5. В `.env` оставьте блок «Вариант 1» (см. `.env.example`): `MODEL_API_KEY` — это `gateway.auth.token` из `~/.openclaw/openclaw.json`.

Бонус: каждая фраза видна в OpenClaw как сессия агента `secretary-clf` — удобно дебажить.

### Вариант 2: MiniMax (OpenClaw не нужен)

Просто API-ключ MiniMax: в `.env.example` раскомментируйте блок «Вариант 2» и закомментируйте первый. Никакого OpenClaw на сервере не требуется — бот ходит в API напрямую.

## Что ещё нужно

- Telegram-бот от @BotFather (токен)
- Google OAuth-креды с доступом к календарю (client_id, client_secret, refresh_token) — например, от Google Workspace MCP
- Ключ Groq (распознавание голоса)
- Zoom Server-to-Server OAuth — опционально
- Сервер с Docker

## Запуск

```bash
cp .env.example .env        # заполните своими ключами
docker compose up -d --build
docker logs secretary-bot   # должно быть: calendar tz: …, menu registered
```

Контейнер работает в `network_mode: host` — так бот достаёт до OpenClaw gateway на `127.0.0.1` (для варианта MiniMax это тоже безвредно). В `docker-compose.yml` поправьте путь к файлу Google-кредов на свой.

В `docker logs secretary-bot` пишется весь диалог: каждая фраза (`msg …`), ответ классификатора (`intent {…}`) и результат (`done …`) — если что-то пошло не так, сразу видно, где.

## Проверка

```bash
npm install && npm test     # 134 автотеста
docker compose run --rm secretary-bot node scripts/live-smoke.js   # живые API
```

Полный чек-лист приёмки — [docs/ТЕСТЫ-ПРИЁМКИ.md](docs/ТЕСТЫ-ПРИЁМКИ.md).

## Структура

| Файл | Что делает |
|---|---|
| `src/classifier.js` | Модель: фраза → JSON (единственное место, где тратятся токены) |
| `src/render.js` | Все сообщения бота — шаблоны в коде |
| `src/router.js` | Оркестратор: команды, кнопки, сценарии, поиск встреч |
| `src/scheduler.js` | Напоминания, план дня и недели |
| `src/tz.js` / `src/dates.js` | ~130 городов мира + GMT±N, часовые пояса, диапазоны дат |
| `src/gcal.js` / `src/zoom.js` / `src/telegram.js` / `src/transcribe.js` | Клиенты API |
| `src/state.js` / `src/slots.js` / `src/conflict.js` / `src/views.js` | Состояние, свободные окна, конфликты, карточки |
| `test/` | 134 автотеста (`node --test`) |

## Безопасность

- Бот отвечает только владельцу (`OWNER_CHAT_ID` в `.env`), остальных игнорирует.
- Секреты живут только в `.env` (в git не попадает) и не печатаются в логи.

---

Курс «ИИ-ВИЗАЦИЯ» · Стас Паньков · Telegram: [@stavzzz](https://t.me/stavzzz)
