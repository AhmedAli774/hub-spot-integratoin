// Tracks recently-synced contacts to prevent A→B→A infinite loops.
// Key: `${source}:${contactId}`, value: timestamp synced.
const DEDUP_WINDOW_MS = 60_000; // 1 minute
const _synced = new Map();

export function markAsSynced(contactId, source) {
  _synced.set(`${source}:${contactId}`, Date.now());
}

export function wasRecentlySynced(contactId, source) {
  const ts = _synced.get(`${source}:${contactId}`);
  if (!ts) return false;
  if (Date.now() - ts > DEDUP_WINDOW_MS) {
    _synced.delete(`${source}:${contactId}`);
    return false;
  }
  return true;
}

// Purge expired entries (call periodically to prevent memory growth)
export function purgeExpired() {
  const now = Date.now();
  for (const [key, ts] of _synced) {
    if (now - ts > DEDUP_WINDOW_MS) _synced.delete(key);
  }
}
