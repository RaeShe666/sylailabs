// In-memory, per-tab history cache so re-entering a conversation renders
// instantly instead of flashing blank while the network refetches.
//
// Lives entirely in the visitor's own browser (the page's JS heap) — nothing is
// stored on the server and nothing is shared between users. It is cleared on
// refresh / tab close; it only speeds up revisits within the same session.
//
// Two bounds keep memory tiny (a few MB at most, even with images, since image
// messages only hold a URL — never the bytes):
//   - at most MAX_CONVERSATIONS conversations are kept (LRU: least-recently
//     entered conversation is dropped first)
//   - each conversation keeps at most MAX_MESSAGES_PER_CONVERSATION messages
//     (the most recent ones)

const MAX_CONVERSATIONS = 20
const MAX_MESSAGES_PER_CONVERSATION = 300

// key (conversationId) -> { messages: [...] }. A Map preserves insertion order,
// which we use for LRU: touching an entry re-inserts it at the end, so the head
// is always the least-recently-used.
const CACHE = new Map()

export function getCachedMessages(key) {
  if (!key || !CACHE.has(key)) return null
  const entry = CACHE.get(key)
  CACHE.delete(key)
  CACHE.set(key, entry)   // mark as most-recently-used
  return entry.messages
}

export function setCachedMessages(key, messages) {
  if (!key || !Array.isArray(messages)) return
  const trimmed = messages.length > MAX_MESSAGES_PER_CONVERSATION
    ? messages.slice(messages.length - MAX_MESSAGES_PER_CONVERSATION)
    : messages
  CACHE.delete(key)
  CACHE.set(key, { messages: trimmed })
  if (CACHE.size > MAX_CONVERSATIONS) {
    CACHE.delete(CACHE.keys().next().value)   // drop the least-recently-used
  }
}

export function updateCachedMessages(key, updater) {
  if (!key || typeof updater !== 'function') return []
  const current = getCachedMessages(key) || []
  const next = updater(current)
  const normalized = Array.isArray(next) ? next : current
  setCachedMessages(key, normalized)
  return normalized
}

export function getMessageCacheKey(message = {}, fallbackKey = null) {
  return message.conversationId
    || message.conversation_id
    || message.planetId
    || message.planet_id
    || fallbackKey
    || null
}

export function clearHistoryCache() {
  CACHE.clear()
}
