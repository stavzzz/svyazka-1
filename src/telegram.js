// Telegram Bot API напрямую (long polling). HTML parse_mode, inline-кнопки,
// forceReply, answerCallbackQuery, скачивание голосовых.

export function createTelegram({ token, fetchFn = fetch }) {
  const base = `https://api.telegram.org/bot${token}`;

  // Сетевые сбои (fetch failed/таймаут) ретраим ×3; ошибки Telegram (4xx) — нет.
  async function api(method, params = {}) {
    let lastErr;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetchFn(`${base}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
        const j = await r.json().catch(() => null);
        if (!j?.ok) throw new Error(`tg ${method} failed: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
        return j.result;
      } catch (e) {
        lastErr = e;
        const transient = /fetch failed|ETIMEDOUT|ECONNRESET|socket|network|50\d/i.test(e.message);
        if (!transient || i === 2) throw e;
        await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
      }
    }
    throw lastErr;
  }

  return {
    api,
    // → message (для message_id под forceReply-корреляцию)
    async send(chatId, html, { buttons = null, forceReply = false, replyTo = null } = {}) {
      const params = {
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      };
      if (buttons) params.reply_markup = { inline_keyboard: buttons };
      else if (forceReply) params.reply_markup = { force_reply: true };
      if (replyTo) params.reply_to_message_id = replyTo;
      return api('sendMessage', params);
    },
    // Перерисовка карточки на месте (настройки). Ошибку «not modified» глотаем.
    async edit(chatId, messageId, html, { buttons = null } = {}) {
      const params = {
        chat_id: chatId, message_id: messageId, text: html,
        parse_mode: 'HTML', disable_web_page_preview: true,
      };
      if (buttons) params.reply_markup = { inline_keyboard: buttons };
      try { return await api('editMessageText', params); }
      catch (e) {
        // Повторный клик по кнопке шлёт тот же текст — это не ошибка (правка 23.07).
        if (!/message is not modified/.test(e.message)) console.error('edit failed:', e.message);
        return null;
      }
    },
    // «Печатает…» пока задача в работе (правка Стаса 23.07). Живёт ~5 с
    // или до первого отправленного сообщения; сбой индикации не критичен.
    async typing(chatId) {
      try { await api('sendChatAction', { chat_id: chatId, action: 'typing' }); } catch { /* не критично */ }
    },
    async answerCallback(callbackQueryId) {
      try { await api('answerCallbackQuery', { callback_query_id: callbackQueryId }); } catch { /* не критично */ }
    },
    async getVoice(fileId) {
      const f = await api('getFile', { file_id: fileId });
      const r = await fetchFn(`https://api.telegram.org/file/bot${token}/${f.file_path}`);
      if (!r.ok) throw new Error(`tg file download failed: ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    },
    // Вечный цикл long polling; handler(update) вызывается последовательно.
    async poll(handler, { signal } = {}) {
      let offset = 0;
      while (!signal?.aborted) {
        try {
          const updates = await api('getUpdates', {
            offset, timeout: 50,
            allowed_updates: ['message', 'callback_query'],
          });
          for (const u of updates) {
            offset = u.update_id + 1;
            try { await handler(u); } catch (e) { console.error('handler error:', e); }
          }
        } catch (e) {
          console.error('poll error:', e.message);
          await new Promise((res) => setTimeout(res, 5000));
        }
      }
    },
  };
}
