// Детект конфликта (ТЗ §10): пересечение интервалов по кэшу,
// события со status === 'cancelled' пропускаются.

// events: [{id, summary, startMs, endMs, status}]
export function findConflicts(newStartMs, newEndMs, events, exceptId = null) {
  return events.filter((ev) =>
    ev.status !== 'cancelled' &&
    ev.id !== exceptId &&
    ev.startMs < newEndMs && ev.endMs > newStartMs
  );
}
