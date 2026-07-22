// Классификатор (MiniMax-M3, anthropic-совместимый API).
// ЕДИНСТВЕННАЯ задача модели: фраза → строгий JSON {intent, поля}.
// Запрещено (ТЗ §3.1): считать зоны, конфликты, формулировать ответы,
// угадывать время, форматировать. Свободный ответ (6.20) — вторая функция ниже.

const INTENTS = new Set([
  'create', 'today', 'tomorrow', 'day_after_tomorrow', 'weekday', 'week',
  'next_week', 'specific_date', 'delete', 'update', 'delete_all', 'move_all',
  'set_timezone', 'get_timezone', 'other',
]);

function systemPrompt(ctx) {
  return `Ты — парсер команд календарного секретаря. Верни ТОЛЬКО один JSON-объект, без текста вокруг, без markdown.

Сегодня: ${ctx.todayISO} (${ctx.weekdayRu}). Часовой пояс пользователя: ${ctx.tz}.

Определи intent и поля из фразы пользователя.

intent — один из:
create (запланируй/запиши/создай/поставь/добавь/забронируй встречу),
today, tomorrow, day_after_tomorrow (расписание на сегодня/завтра/послезавтра),
weekday (расписание на день недели: «что в понедельник»),
week (эта неделя), next_week (следующая неделя),
specific_date (расписание на конкретную дату: «что 20 июля»),
delete (удали/отмени/убери ОДНУ named встречу),
update (перенеси/измени/отложи/увеличь/добавь описание или участников к встрече),
delete_all (удали ВСЕ встречи за период: «удали все встречи сегодня / на этой неделе»),
move_all (перенеси ВСЕ встречи за период: «перенеси все встречи на неделю вперёд», «я заболел, сдвинь всё на день»),
set_timezone (переключи/смени зону, «я теперь в X», «лечу в X»),
get_timezone (какая у меня зона),
other (всё остальное: вопросы, болтовня).

Поля:
- create: {"intent":"create","title":str,"date":"YYYY-MM-DD","time_start":"HH:MM"|"","time_end":"HH:MM"|"","duration_min":str,"attendees":[emails],"location":str,"description":str,"city":str}
- delete: {"intent":"delete","titles":[str]}
- update: {"intent":"update","title":str,"date":"YYYY-MM-DD"|"","time_start":"HH:MM"|"","duration_min":str|"","attendees_add":[emails],"description":str,"city":str}
- weekday|specific_date: {"intent":...,"date":"YYYY-MM-DD"}
- delete_all: {"intent":"delete_all","range":"today|tomorrow|week|next_week|specific_date","date":"YYYY-MM-DD"|""}
- move_all: {"intent":"move_all","range":"today|tomorrow|week|next_week|specific_date","date":"","shift_days":"7"} — «на неделю вперёд»→"7", «на день/на завтра»→"1", «на два дня»→"2". Период не назван → range:"week".
- set_timezone: {"intent":"set_timezone","city":str}
- остальные: {"intent":...}

Правила:
1. title — только название, без слов «встреча», «звонок», «созвон с»; кавычки убрать. «встреча с Иваном» → "Иван".
2. time_start — время В ТОМ ПОЯСЕ, КАК СКАЗАЛ пользователь, без пересчёта. Пояса НЕ конвертируй.
3. Если время не названо — time_start:"" (ПУСТАЯ строка). НИКОГДА не угадывай и не подставляй 00:00.
4. city — город/регион, если назван («по Москве» → "Москва"), иначе "".
5. duration_min: «5 минут»→"5", «полчаса»→"30", «2 часа»→"120". Не названа — "60". Для update не названа — "".
6. Относительные даты считай от сегодняшней: «завтра» → ${ctx.tomorrowISO}. Дата не названа — для create сегодняшняя, для update "".
7. Ответ — строго один JSON-объект.`;
}

// format — ровно два варианта:
//   'minimax' — MiniMax по API-ключу (эндпоинт /v1/messages);
//   'openai'  — OpenAI-совместимый /chat/completions (OpenClaw gateway /v1 → Codex по подписке ChatGPT).
export function createClassifier({ baseUrl, apiKey, model, format = 'minimax', fetchFn = fetch }) {
  async function callModel(system, user, maxTokens) {
    if (format === 'openai') {
      const r = await fetchFn(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature: 0,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(`model ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
      return j.choices?.[0]?.message?.content || '';
    }
    const r = await fetchFn(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        temperature: 0,
      }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`model ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
    const parts = j.content || [];
    return parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
  }

  async function withRetry(fn, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
      try { return await fn(); } catch (e) {
        last = e;
        await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
      }
    }
    throw last;
  }

  return {
    // → объект интента; при любом сбое → {intent:'other'} (код не молчит)
    async classify(text, ctx) {
      try {
        const raw = await withRetry(() => callModel(systemPrompt(ctx), text, 700));
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m) return { intent: 'other' };
        const obj = JSON.parse(m[0]);
        if (!INTENTS.has(obj.intent)) return { intent: 'other' };
        return obj;
      } catch (e) {
        console.error('classify failed:', e.message);
        return { intent: 'other', _error: true };
      }
    },
    // Свободный ответ (6.20): русский, без markdown; экранируется рендером.
    async freeAnswer(text) {
      try {
        return await withRetry(() => callModel(
          'Ты — краткий личный ассистент-секретарь. Отвечай по-русски, обычным текстом, без markdown, без HTML, коротко и по делу.',
          text, 800,
        ));
      } catch {
        return 'Не получилось обработать запрос. Попробуй ещё раз.';
      }
    },
  };
}
