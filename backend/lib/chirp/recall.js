import { readRecentMessagesForScope, resolveMemoryScope } from './memoryScope.js'
import { formatAbsTime } from './time.js'

const MIN_TOKEN_LENGTH = 2
const MAX_QUERIES = 3
const RRF_K = 60

// Scoped recall (persona-v2 §5.1): the model synthesizes 1-3 queries inside its
// own loop; this tool runs each query through cheap DB-side search and merges
// the ranked lists with reciprocal rank fusion. Scope stays a DB-layer WHERE.
// Vector search is a later plug-in (embedding provider not chosen yet).
export async function recall({ supabase, ownerId, query, queries, scope, limit = 5 }) {
  const normalizedQueries = normalizeQueries(queries ?? query)
  if (!normalizedQueries.length) {
    return { queries: [], scope, items: [] }
  }

  const resolvedScope = scope.allowed_conversation_ids
    ? scope
    : await resolveMemoryScope({ supabase, ownerId, scope })

  const rankedLists = await Promise.all(
    normalizedQueries.map(singleQuery =>
      searchOneQuery({ supabase, ownerId, query: singleQuery, scope: resolvedScope, limit })
    )
  )

  return {
    queries: normalizedQueries,
    scope: publicScope(resolvedScope),
    items: mergeRankedLists(rankedLists, limit)
  }
}

export function normalizeQueries(value) {
  const list = Array.isArray(value) ? value : [value]
  return [...new Set(
    list
      .map(item => String(item ?? '').trim())
      .filter(Boolean)
  )].slice(0, MAX_QUERIES)
}

// Reciprocal rank fusion across per-query ranked lists, deduped by item id.
export function mergeRankedLists(lists, limit = 5) {
  const scored = new Map()

  for (const list of lists) {
    (list || []).forEach((item, rank) => {
      if (!item?.id) return
      const existing = scored.get(item.id)
      const score = 1 / (RRF_K + rank)
      if (existing) {
        existing.score += score
      } else {
        scored.set(item.id, { item, score })
      }
    })
  }

  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, score }) => ({ ...item, score }))
}

export function formatRecallForPrompt(recallResult, tzOffset = null) {
  if (!recallResult?.items?.length) return 'NONE'
  return recallResult.items
    .map(item => {
      const at = formatAbsTime(item.created_at, tzOffset)
      const stamp = at ? `[${at}] ` : ''
      return `- ${stamp}${item.sender_type}${item.sender_id ? `(${item.sender_id})` : ''}: ${item.text}`
    })
    .join('\n')
}

async function searchOneQuery({ supabase, ownerId, query, scope, limit }) {
  const textSearchItems = await readTextSearchMessagesForScope({ supabase, query, scope, limit })
  if (textSearchItems) return textSearchItems

  const recent = await readRecentMessagesForScope({
    supabase,
    ownerId,
    scope,
    limit: 120
  })

  const tokens = tokenize(query)
  return recent
    .map(message => ({ message, score: scoreMessage(message, tokens) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ message }) => ({
      id: message.id,
      conversation_id: message.conversation_id,
      sender_type: message.sender_type,
      sender_id: message.sender_id,
      text: message.text,
      created_at: message.created_at
    }))
}

function tokenize(value) {
  return String(value)
    .toLowerCase()
    .split(/[\s,，。！？；："'“”‘’()[\]{}<>/@#]+/u)
    .map(token => token.trim())
    .filter(token => token.length >= MIN_TOKEN_LENGTH)
}

function scoreMessage(message, tokens) {
  const text = String(message.text || '').toLowerCase()
  if (!text || !tokens.length) return 0
  return tokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0)
}

async function readTextSearchMessagesForScope({ supabase, query, scope, limit }) {
  if (!scope.allowed_conversation_ids?.length) return []

  try {
    const { data, error } = await supabase
      .from('chirp_messages')
      .select('id,planet_id,conversation_id,sender_type,sender_id,sender_role,is_personal_record,text,created_at')
      .in('conversation_id', scope.allowed_conversation_ids)
      .textSearch('search_vector', query, {
        type: 'websearch',
        config: 'simple'
      })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.warn('Chirp DB text recall failed; falling back to recent scan:', error.message || error)
      return null
    }

    if (!(data || []).length) return null

    return (data || []).map(row => ({
      id: row.id,
      conversation_id: row.conversation_id,
      sender_type: row.sender_type,
      sender_id: row.sender_id,
      text: row.text,
      created_at: row.created_at
    }))
  } catch (error) {
    console.warn('Chirp DB text recall failed; falling back to recent scan:', error.message || error)
    return null
  }
}

function publicScope(scope = {}) {
  return {
    type: scope.type,
    agent_id: scope.agent_id,
    agent_role: scope.agent_role,
    planet_id: scope.planet_id,
    allowed_conversation_ids: scope.allowed_conversation_ids
  }
}
