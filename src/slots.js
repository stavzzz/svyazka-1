// Свободные окна: вычитание занятых интервалов из рабочего окна дня.
// Чистая функция — без API и без модели.

// busy: [{startMs, endMs}] → свободные [{startMs, endMs}], каждое ≥ minMs
export function freeSlots(busy, fromMs, toMs, minMs = 30 * 60_000) {
  if (fromMs >= toMs) return [];
  const iv = busy
    .filter((b) => b.endMs > fromMs && b.startMs < toMs)
    .map((b) => [Math.max(b.startMs, fromMs), Math.min(b.endMs, toMs)])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of iv) {
    if (merged.length && s <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else merged.push([s, e]);
  }
  const out = [];
  let cur = fromMs;
  for (const [s, e] of merged) {
    if (s - cur >= minMs) out.push({ startMs: cur, endMs: s });
    cur = Math.max(cur, e);
  }
  if (toMs - cur >= minMs) out.push({ startMs: cur, endMs: toMs });
  return out;
}

// 90 мин → '1 ч 30 мин', 120 → '2 ч', 45 → '45 мин'
export function fmtDur(ms) {
  const m = Math.round(ms / 60_000);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h && mm) return `${h} ч ${mm} мин`;
  if (h) return `${h} ч`;
  return `${mm} мин`;
}
