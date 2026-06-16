// persona_template store (persona-v2 §2.1).
// Templates are the public persona asset; the old per-user chirp_personas
// table is deprecated and no longer written.

const TEMPLATE_SELECT = [
  'id',
  'persona_key',
  'name',
  'short_intro',
  'avatar_url',
  'color',
  'creator_id',
  'creator_type',
  'persona_kind',
  'model_preference',
  'visibility',
  'runtime_card',
  'runtime_card_hash',
  'is_active'
].join(',')

const KEY_ALIASES = { dantotal: 'danzong' }

// Templates change rarely (official assets edited by hand); a short in-process
// cache removes one Supabase round trip from every reply.
const CACHE_TTL_MS = 60_000
const templateCache = new Map()

function readCache(key) {
  const entry = templateCache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    templateCache.delete(key)
    return undefined
  }
  return entry.value
}

function writeCache(key, value) {
  templateCache.set(key, { value, at: Date.now() })
}

export function clearTemplateCache() {
  templateCache.clear()
}

export function mapTemplateRow(row = {}) {
  return {
    id: row.persona_key || row.id,
    dbId: row.id,
    personaKey: row.persona_key || null,
    name: row.name,
    role: row.short_intro || '',
    description: row.short_intro || '',
    avatarUrl: row.avatar_url || '',
    color: row.color || '#F5C878',
    creatorType: row.creator_type || 'official',
    personaKind: row.persona_kind || 'original_companion',
    modelPreference: row.model_preference || null,
    isOfficial: row.creator_type === 'official',
    runtime_card: row.runtime_card || {},
    runtimeCardHash: row.runtime_card_hash || ''
  }
}

export async function loadOfficialTemplates({ supabase }) {
  const cached = readCache('__officials__')
  if (cached !== undefined) return cached

  const { data, error } = await supabase
    .from('chirp_persona_templates')
    .select(TEMPLATE_SELECT)
    .eq('visibility', 'public')
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (error) throw error
  const templates = (data || []).map(mapTemplateRow)
  writeCache('__officials__', templates)
  return templates
}

export async function loadTemplateByKey({ supabase, key }) {
  if (!supabase || !key) return null
  const normalizedKey = KEY_ALIASES[key] || key

  const cached = readCache(normalizedKey)
  if (cached !== undefined) return cached

  const query = supabase
    .from('chirp_persona_templates')
    .select(TEMPLATE_SELECT)
    .eq('is_active', true)

  const { data, error } = await (isUuid(normalizedKey)
    ? query.eq('id', normalizedKey)
    : query.eq('persona_key', normalizedKey)
  ).maybeSingle()

  if (error) throw error
  const template = data ? mapTemplateRow(data) : null
  writeCache(normalizedKey, template)
  return template
}

function isUuid(value = '') {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
