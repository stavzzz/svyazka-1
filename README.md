# Связка 1 — Личный ИИ-секретарь в Telegram

Бот ведёт ваш Google Календарь голосом и текстом: ставит, переносит и удаляет встречи, вшивает ссылки Google Meet и Zoom, напоминает, присылает план дня и показывает свободные окна.

Пошаговая инструкция сборки: **https://edu.stas-pankov.app/svyazka-1/**
Техзадание и чек-лист приёмки — в папке [docs/](docs/).

## Как это устроено

```
Telegram (текст/голос) → Whisper (голос → текст)
  → Модель — ТОЛЬКО классификация: фраза → строгий JSON {команда, поля}
  → Программный код: зоны, даты, конфликты, все сообщения, кнопки, планировщики
  → Google Calendar API (+ Google Meet) и Zoom
```

Главное правило: **модель не считает время и не пишет ответы**. Одна и та же фраза даёт побайтово одинаковый ответ. Кнопки меню и /start работают вообще без модели — токены не тратятся.

## Модель-классификатор: два варианта

| Вариант | Что нужно | Настройки в `.env` |
|---|---|---|
| **MiniMax** | API-ключ MiniMax | `MODEL_FORMAT=minimax` (по умолчанию) |
| **Codex — подписка ChatGPT через OpenClaw** | OpenClaw на этом же VPS с подключённой подпиской | `MODEL_FORMAT=openai`, `MODEL_BASE_URL=http://172.17.0.1:18789/v1`, `MODEL_API_KEY=<gateway-токен OpenClaw>`, `MODEL_NAME=openclaw/default` |

Во втором варианте бот ходит в OpenAI-совместимый эндпоинт gateway OpenClaw (`/v1/chat/completions`), а OpenClaw уже сам обращается к модели вашей подписки. `172.17.0.1` — адрес хоста из docker-контейнера на Linux.

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

В `docker-compose.yml` поправьте путь к файлу Google-кредов на свой.

## Проверка

```bash
npm install && npm test     # 98 автотестов
docker compose run --rm secretary-bot node scripts/live-smoke.js   # живые API
```

Полный чек-лист приёмки — [docs/ТЕСТЫ-ПРИЁМКИ.md](docs/ТЕСТЫ-ПРИЁМКИ.md) (44 пункта).

## Структура

| Файл | Что делает |
|---|---|
| `src/classifier.js` | Модель: фраза → JSON (единственное место, где тратятся токены) |
| `src/render.js` | Все сообщения бота — шаблоны в коде |
| `src/router.js` | Оркестратор: команды, кнопки, сценарии |
| `src/scheduler.js` | Напоминания, план дня и недели |
| `src/tz.js` / `src/dates.js` | 33 региона, часовые пояса, диапазоны дат |
| `src/gcal.js` / `src/zoom.js` / `src/telegram.js` / `src/transcribe.js` | Клиенты API |
| `src/state.js` / `src/slots.js` / `src/conflict.js` / `src/views.js` | Состояние, свободные окна, конфликты, карточки |
| `test/` | 98 автотестов (`node --test`) |

## Безопасность

- Бот отвечает только владельцу (`OWNER_CHAT_ID` в `.env`), остальных игнорирует.
- Секреты живут только в `.env` (в git не попадает) и не печатаются в логи.

---

Курс «ИИ-ВИЗАЦИЯ» · Стас Паньков · Telegram: [@stavzzz](https://t.me/stavzzz)
