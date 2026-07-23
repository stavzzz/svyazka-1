// Классификатор: оба формата API — anthropic (MiniMax) и openai (OpenClaw gateway / Codex).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassifier } from '../src/classifier.js';

const CTX = { todayISO: '2026-07-22', tomorrowISO: '2026-07-23', weekdayRu: 'среда', tz: 'Europe/Moscow' };

function mockFetch(responseJson, capture) {
  return async (url, opts) => {
    capture.url = String(url);
    capture.headers = opts.headers;
    capture.body = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => responseJson };
  };
}

test('minimax-формат: /v1/messages, x-api-key, парсинг content-блоков', async () => {
  const cap = {};
  const c = createClassifier({
    baseUrl: 'https://api.minimax.io/anthropic', apiKey: 'KEY', model: 'MiniMax-M3',
    fetchFn: mockFetch({ content: [{ type: 'text', text: '{"intent":"today"}' }] }, cap),
  });
  const out = await c.classify('что сегодня', CTX);
  assert.equal(out.intent, 'today');
  assert.equal(cap.url, 'https://api.minimax.io/anthropic/v1/messages');
  assert.equal(cap.headers['x-api-key'], 'KEY');
  assert.equal(cap.body.temperature, 0);
  assert.ok(cap.body.system.includes('Сегодня: 2026-07-22'));
});

test('промпт: инструкции recurrence (recur, series_scope) на месте', async () => {
  const cap = {};
  const c = createClassifier({
    baseUrl: 'x://b', apiKey: 'k', model: 'm',
    fetchFn: mockFetch({ content: [{ type: 'text', text: '{"intent":"other"}' }] }, cap),
  });
  await c.classify('тест', CTX);
  assert.ok(cap.body.system.includes('"recur"'));
  assert.ok(cap.body.system.includes('"series_scope"'));
  assert.ok(cap.body.system.includes('каждую вторую субботу'));
  assert.ok(cap.body.system.includes('повторяющуюся встречу'));
});

test('openai-формат: /chat/completions, Bearer, парсинг choices (Codex через OpenClaw gateway)', async () => {
  const cap = {};
  const c = createClassifier({
    baseUrl: 'http://172.17.0.1:18789/v1', apiKey: 'GATEWAY_TOKEN', model: 'openclaw/default', format: 'openai',
    fetchFn: mockFetch({ choices: [{ message: { content: '{"intent":"week"}' } }] }, cap),
  });
  const out = await c.classify('что на неделе', CTX);
  assert.equal(out.intent, 'week');
  assert.equal(cap.url, 'http://172.17.0.1:18789/v1/chat/completions');
  assert.equal(cap.headers.Authorization, 'Bearer GATEWAY_TOKEN');
  assert.equal(cap.body.messages[0].role, 'system');
  assert.equal(cap.body.messages[1].content, 'что на неделе');
});

test('невалидный intent или мусор → {intent:"other"}', async () => {
  const cap = {};
  const c = createClassifier({
    baseUrl: 'x://b', apiKey: 'k', model: 'm',
    fetchFn: mockFetch({ content: [{ type: 'text', text: 'просто текст без json' }] }, cap),
  });
  const out = await c.classify('абракадабра', CTX);
  assert.equal(out.intent, 'other');
});
