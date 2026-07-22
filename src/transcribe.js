// Голос → текст: Groq Whisper Large V3 (OpenAI-совместимый endpoint).

export function createTranscriber({ apiKey, fetchFn = fetch }) {
  return {
    async transcribe(buf, filename = 'voice.ogg') {
      const form = new FormData();
      form.append('file', new Blob([buf]), filename);
      form.append('model', 'whisper-large-v3');
      form.append('language', 'ru');
      const r = await fetchFn('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || typeof j?.text !== 'string') throw new Error(`groq stt failed: ${r.status}`);
      return j.text.trim();
    },
  };
}
