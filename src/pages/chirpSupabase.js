import { supabase } from '../supabaseClient'
import {
  CHIRP_PLANETS,
  getAllPersonas,
  formatActivityTime,
  getPersonasForPlanet,
  getPlanetRecent,
  hydratePlanet,
  truncateRecentMessage
} from './chirpShared'

const byType = (type) => CHIRP_PLANETS.find(planet => planet.id === type) || CHIRP_PLANETS[0]

const toClientPlanet = (row) => {
  const template = byType(row.type)
  return hydratePlanet({
    ...template,
    id: row.type || template.id,
    dbId: row.id,
    roomName: row.name || template.roomName,
    cardTitle: row.name || template.roomName,
    tone: row.tone || template.tone,
    background: row.background || template.background,
    avatarKey: row.avatar_key || template.id,
    updatedAt: row.updated_at,
    createdAt: row.created_at
  })
}

const defaultPlanetPayload = (userId, planet) => ({
  owner_id: userId,
  name: planet.roomName,
  type: planet.id,
  tone: planet.tone,
  background: planet.background,
  avatar_key: planet.id
})

const BIRD_MEMBER = {
  member_type: 'bird',
  member_id: 'bird',
  agent_role: 'bird',
  listen_mode: 'mention_only',
  position: 1
}

const toClientMessage = (row) => ({
  id: row.id,
  type: row.sender_type,
  agentId: row.sender_type === 'agent' ? row.sender_id : undefined,
  text: row.text || '',
  tapbacks: Array.isArray(row.tapbacks) ? row.tapbacks : [],
  read: row.sender_type === 'user',
  isPersonalRecord: row.is_personal_record || row.sender_type === 'memo',
  createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
})

const toClientPersona = (row) => ({
  id: row.persona_key || row.id,
  dbId: row.id,
  personaKey: row.persona_key || null,
  name: row.name,
  role: row.role || 'custom persona',
  description: row.description || 'A custom persona created by you for private Planet conversations.',
  systemPrompt: row.system_prompt || '',
  skills: row.skills || '',
  avatarUrl: row.avatar_url || '',
  color: row.color || '#F5C878',
  pricing: row.pricing || 'free',
  usageCount: row.usage_count || 0,
  isOfficial: row.is_official || false,
  identity: row.identity || {},
  relationship: row.relationship || {},
  voice_style: row.voice_style || {},
  boundaries: row.boundaries || {},
  reply_policy: row.reply_policy || {},
  memory_policy: row.memory_policy || {},
  examples: Array.isArray(row.examples) ? row.examples : [],
  agent_role: row.agent_role || 'persona',
  listen_mode: row.listen_mode || 'passive',
  metadata: row.metadata || {},
  createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
})

export async function loadChirpProfile(user) {
  if (!user) return null
  const { data, error } = await supabase
    .from('chirp_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    animal: data.animal,
    animalName: data.animal_name,
    birdName: data.bird_name || 'Bird',
    focus: data.focus,
    completedAt: data.updated_at ? new Date(data.updated_at).getTime() : Date.now()
  }
}

export async function saveChirpProfile(user, profile) {
  if (!user) return null
  const payload = {
    user_id: user.id,
    animal: profile.animal,
    animal_name: profile.animalName,
    bird_name: profile.birdName || 'Bird',
    focus: profile.focus || null,
    updated_at: new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('chirp_profiles')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function loadChirpPlanets(user) {
  if (!user) return CHIRP_PLANETS.map(hydratePlanet)

  const { data, error } = await supabase
    .from('chirp_planets')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true })

  if (error) throw error

  const existing = []
  const seenTypes = new Set()
  const supportedTypes = new Set(CHIRP_PLANETS.map(planet => planet.id))
  ;(data || []).forEach(row => {
    const key = row.type || row.id
    if (!supportedTypes.has(key)) return
    if (seenTypes.has(key)) return
    seenTypes.add(key)
    existing.push(row)
  })
  const existingTypes = new Set(existing.map(row => row.type))
  const missingDefaults = CHIRP_PLANETS.filter(planet => !existingTypes.has(planet.id))

  if (missingDefaults.length > 0) {
    const { error: insertError } = await supabase
      .from('chirp_planets')
      .insert(missingDefaults.map(planet => defaultPlanetPayload(user.id, planet)))

    if (insertError) throw insertError

    const { data: refreshed, error: refreshError } = await supabase
      .from('chirp_planets')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true })

    if (refreshError) throw refreshError
    const planets = (refreshed || [])
      .filter(row => supportedTypes.has(row.type || row.id))
      .map(toClientPlanet)
    return Promise.all(planets.map(planet => ensureChirpConversations(user, planet)))
  }

  const planets = existing.map(toClientPlanet)
  return Promise.all(planets.map(planet => ensureChirpConversations(user, planet)))
}

export async function ensureChirpConversations(user, planet, agents = getPersonasForPlanet(planet)) {
  if (!user || !planet?.dbId) return planet

  const groupConversation = await ensureConversation({
    userId: user.id,
    planetId: planet.dbId,
    type: 'group',
    title: planet.roomName || planet.name || 'relationship'
  })

  await ensureConversation({
    userId: user.id,
    planetId: null,
    type: 'bird_dm',
    title: 'Bird'
  })

  if (groupConversation?.id) {
    await ensureConversationMembers(groupConversation.id, [
      {
        member_type: 'user',
        member_id: user.id,
        agent_role: 'user',
        listen_mode: 'active',
        position: 0
      },
      BIRD_MEMBER,
      ...agents.map((agent, index) => ({
        member_type: 'persona',
        member_id: agent.id,
        persona_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(agent.id) ? agent.id : null,
        agent_role: 'persona',
        listen_mode: 'passive',
        position: index + 2
      }))
    ])
  }

  return {
    ...planet,
    conversationId: groupConversation?.id || planet.conversationId
  }
}

async function ensureConversation({ userId, planetId, type, title }) {
  const findExisting = async () => {
    let query = supabase
      .from('chirp_conversations')
      .select('*')
      .eq('owner_id', userId)
      .eq('type', type)
      .order('created_at', { ascending: true })   // earliest wins → stable across duplicate rows
      .limit(1)
    query = planetId === null ? query.is('planet_id', null) : query.eq('planet_id', planetId)
    const { data, error } = await query.maybeSingle()
    if (error) throw error
    return data
  }

  const existing = await findExisting()
  if (existing) return existing

  const { data, error } = await supabase
    .from('chirp_conversations')
    .insert({ owner_id: userId, planet_id: planetId, type, title })
    .select()
    .single()

  // Lost the create race (unique index) — re-find the winning row.
  if (error?.code === '23505') {
    const raced = await findExisting()
    if (raced) return raced
  }
  if (error) throw error
  return data
}

async function ensureConversationMembers(conversationId, members) {
  if (!conversationId || !members.length) return []

  const rows = members.map(member => ({
    conversation_id: conversationId,
    member_type: member.member_type,
    member_id: member.member_id,
    persona_id: member.persona_id || null,
    agent_role: member.agent_role || member.member_type,
    listen_mode: member.listen_mode || 'passive',
    position: member.position || 0
  }))

  const { data, error } = await supabase
    .from('chirp_conversation_members')
    .upsert(rows, { onConflict: 'conversation_id,member_type,member_id' })
    .select()

  if (error) throw error
  return data || []
}

export async function updateChirpPlanet(planet, patch) {
  if (!planet?.dbId) return null

  const payload = {
    updated_at: new Date().toISOString()
  }
  if (patch.roomName || patch.name) payload.name = patch.roomName || patch.name
  if (patch.background) payload.background = patch.background
  if (patch.tone) payload.tone = patch.tone
  if (patch.avatarKey) payload.avatar_key = patch.avatarKey

  const { data, error } = await supabase
    .from('chirp_planets')
    .update(payload)
    .eq('id', planet.dbId)
    .select()
    .single()

  if (error) throw error
  return toClientPlanet(data)
}

// How many messages to load per page (initial open + each scroll-up fetch).
export const HISTORY_PAGE_SIZE = 60

// Fetch the most recent `limit` messages for a filter, returned in ascending
// (display) order. `hasMore` is true when a full page came back — i.e. there may
// be older messages to load when the user scrolls up.
async function fetchRecentMessages(column, value, limit) {
  const { data, error } = await supabase
    .from('chirp_messages')
    .select('*')
    .eq(column, value)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  const rows = data || []
  return { messages: rows.slice().reverse().map(toClientMessage), hasMore: rows.length === limit }
}

// Returns { messages, hasMore }. Loads only the most recent page so opening a
// long conversation is fast and lands on the latest message.
export async function loadChirpMessages(planet, limit = HISTORY_PAGE_SIZE) {
  if (!planet?.dbId) return { messages: [], hasMore: false }
  if (planet.conversationId) return fetchRecentMessages('conversation_id', planet.conversationId, limit)
  return fetchRecentMessages('planet_id', planet.dbId, limit)
}

// Older page for "scroll up to load more": messages strictly before
// `beforeCreatedAt` (the oldest message currently on screen). Returns
// { messages, hasMore } with messages in ascending order, ready to prepend.
export async function loadOlderChirpMessages({ conversationId, planetId, beforeCreatedAt, limit = HISTORY_PAGE_SIZE }) {
  const column = conversationId ? 'conversation_id' : 'planet_id'
  const value = conversationId || planetId
  if (!value || !beforeCreatedAt) return { messages: [], hasMore: false }
  const { data, error } = await supabase
    .from('chirp_messages')
    .select('*')
    .eq(column, value)
    .lt('created_at', beforeCreatedAt)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.warn('Failed to load older messages:', error)
    return { messages: [], hasMore: false }
  }
  const rows = data || []
  return { messages: rows.slice().reverse().map(toClientMessage), hasMore: rows.length === limit }
}

// DM history, loaded strictly by conversation id (never by planet) so a DM
// never picks up a planet's group messages.
// Group chat name lives on the conversation (title), separate from the planet
// name. RLS lets the owner update their own conversation.
export async function updateChirpConversationTitle(conversationId, title) {
  if (!conversationId || !title) return
  const { error } = await supabase
    .from('chirp_conversations')
    .update({ title })
    .eq('id', conversationId)
  if (error) console.warn('Failed to update conversation title:', error)
}

// Returns { messages, hasMore }. Loads only the most recent page.
export async function loadChirpMessagesByConversation(conversationId, limit = HISTORY_PAGE_SIZE) {
  if (!conversationId) return { messages: [], hasMore: false }
  try {
    return await fetchRecentMessages('conversation_id', conversationId, limit)
  } catch (error) {
    console.warn('Failed to load DM messages:', error)
    return { messages: [], hasMore: false }
  }
}

export async function saveChirpMessage(planet, message) {
  if (!planet?.dbId || !message?.type) return null

  const payload = {
    planet_id: planet.dbId,
    conversation_id: planet.conversationId || null,
    sender_type: message.type,
    sender_id: message.agentId || (message.type === 'user' ? 'user' : null),
    sender_role: message.type === 'agent'
      ? (message.agentId === 'bird' ? 'bird' : 'persona')
      : (message.type === 'user' ? 'user' : 'record'),
    is_personal_record: Boolean(message.isPersonalRecord || message.type === 'memo'),
    text: message.text || '',
    tapbacks: message.tapbacks || []
  }

  const { data, error } = await supabase
    .from('chirp_messages')
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function loadChirpMomentEntries(planet, momentKey = 'default') {
  if (!planet?.dbId) return null

  const { data, error } = await supabase
    .from('chirp_messages')
    .select('*')
    .eq('planet_id', planet.dbId)
    .eq('sender_type', 'memo')
    .eq('sender_id', `moment:${momentKey}`)
    .order('created_at', { ascending: true })

  if (error) throw error

  return (data || []).map(row => ({
    id: row.id,
    text: row.text || '',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
  }))
}

export async function saveChirpMomentEntry(planet, text, entryId, momentKey = 'default') {
  if (!planet?.dbId || !text?.trim()) return null

  if (entryId && !String(entryId).startsWith('local-')) {
    const { data, error } = await supabase
      .from('chirp_messages')
      .update({
        text: text.trim()
      })
      .eq('id', entryId)
      .eq('planet_id', planet.dbId)
      .eq('sender_type', 'memo')
      .eq('sender_id', `moment:${momentKey}`)
      .select()
      .single()

    if (error) throw error
    return {
      id: data.id,
      text: data.text || '',
      createdAt: data.created_at ? new Date(data.created_at).getTime() : Date.now()
    }
  }

  const { data, error } = await supabase
    .from('chirp_messages')
    .insert({
      planet_id: planet.dbId,
      sender_type: 'memo',
      sender_id: `moment:${momentKey}`,
      text: text.trim(),
      tapbacks: []
    })
    .select()
    .single()

  if (error) throw error
  return {
    id: data.id,
    text: data.text || '',
    createdAt: data.created_at ? new Date(data.created_at).getTime() : Date.now()
  }
}

// The user's persona DMs, for the persistent conversation list. Read directly
// (RLS scopes to the owner); each entry carries the persona id + last message.
export async function loadChirpDmConversations(user) {
  if (!user) return []
  const { data: convs, error } = await supabase
    .from('chirp_conversations')
    .select('id,type,title,metadata,created_at')
    .eq('owner_id', user.id)
    .in('type', ['persona_dm', 'bird_dm'])
  if (error || !convs?.length) return []

  const ids = convs.map(conversation => conversation.id)
  const { data: msgs } = await supabase
    .from('chirp_messages')
    .select('conversation_id,text,created_at')
    .in('conversation_id', ids)
    .order('created_at', { ascending: false })

  const last = {}
  for (const message of (msgs || [])) {
    if (!last[message.conversation_id]) last[message.conversation_id] = message
  }

  // Earliest conversation per agent wins (matches the backend's "earliest"
  // resolution), so duplicate rows from past races collapse to one list entry.
  const byAgent = new Map()
  for (const conversation of [...convs].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))) {
    const agentId = conversation.metadata?.agent_id || (conversation.type === 'bird_dm' ? 'bird' : null)
    if (!agentId || byAgent.has(agentId)) continue
    byAgent.set(agentId, {
      conversationId: conversation.id,
      agentId,
      title: conversation.title,
      lastText: last[conversation.id]?.text || '',
      lastAt: last[conversation.id]?.created_at || null
    })
  }
  return [...byAgent.values()].sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')))
}

export async function loadPlanetActivityFromMessages(planets) {
  const dbIds = planets.map(planet => planet.dbId).filter(Boolean)
  if (!dbIds.length) return {}

  // Last message of the conversation, ANY sender (user / memo / agent) — the
  // list preview should match "the last line in the chat", like WeChat.
  const { data, error } = await supabase
    .from('chirp_messages')
    .select('planet_id,text,created_at,sender_type')
    .in('planet_id', dbIds)
    .neq('sender_type', 'system')
    .order('created_at', { ascending: false })

  if (error) throw error

  const activity = {}
  const byDbId = new Map(planets.map(planet => [planet.dbId, planet]))
  ;(data || []).forEach(row => {
    const planet = byDbId.get(row.planet_id)
    if (!planet || activity[planet.id]) return
    const timestamp = row.created_at ? new Date(row.created_at).getTime() : Date.now()
    activity[planet.id] = {
      text: truncateRecentMessage(row.text, 25),
      rawText: row.text,
      timestamp,
      time: formatActivityTime(timestamp)
    }
  })

  planets.forEach(planet => {
    if (!activity[planet.id]) activity[planet.id] = getPlanetRecent(planet)
  })

  return activity
}

export async function loadCustomPersonas(user) {
  if (!user) return []

  // persona-v2: official personas are global public templates; using one
  // creates a per-user instance server-side, nothing is copied per user.
  const { data, error } = await supabase
    .from('chirp_persona_templates')
    .select('id,persona_key,name,short_intro,avatar_url,color,creator_type,is_active')
    .eq('visibility', 'public')
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (error) throw error

  return (data || []).map(row => toClientPersona({
    id: row.id,
    persona_key: row.persona_key,
    name: row.name,
    role: row.short_intro,
    description: row.short_intro,
    avatar_url: row.avatar_url,
    color: row.color,
    is_official: row.creator_type === 'official'
  }))
}

export async function saveCustomPersonaToSupabase(user, persona) {
  if (!user) return null

  const payload = {
    creator_id: user.id,
    name: persona.name,
    role: persona.role || 'custom persona',
    description: persona.description || '',
    system_prompt: persona.systemPrompt || '',
    skills: persona.skills || '',
    avatar_url: persona.avatarUrl || '',
    color: persona.color || '#F5C878',
    pricing: persona.pricing || 'free',
    usage_count: persona.usageCount || 0,
    is_official: false,
    updated_at: new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('chirp_personas')
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function uploadPersonaAvatar(user, file) {
  if (!user || !file) return ''

  const extension = file.name.split('.').pop()?.toLowerCase() || 'png'
  const safeExtension = extension.replace(/[^a-z0-9]/g, '') || 'png'
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExtension}`

  const { error } = await supabase
    .storage
    .from('chirp-avatars')
    .upload(path, file, {
      cacheControl: '31536000',
      contentType: file.type || 'image/png',
      upsert: false
    })

  if (error) throw error

  const { data } = supabase
    .storage
    .from('chirp-avatars')
    .getPublicUrl(path)

  return data.publicUrl || ''
}

const uniquePersonasById = (personas) => {
  const seen = new Set()
  return personas.filter(persona => {
    if (!persona?.id || seen.has(persona.id)) return false
    seen.add(persona.id)
    return true
  })
}

export async function loadPlanetMemberPersonas(planet, fallbackAgents = [], personaCatalog = []) {
  if (!planet?.dbId) return fallbackAgents

  const { data, error } = await supabase
    .from('chirp_planet_members')
    .select('*')
    .eq('planet_id', planet.dbId)
    .order('position', { ascending: true })

  if (error) throw error
  if (!data?.length) return fallbackAgents

  const allPersonas = uniquePersonasById([
    ...getAllPersonas(),
    ...fallbackAgents,
    ...personaCatalog
  ])
  const mapped = data
    .filter(row => row.member_type === 'persona')
    .map(row => allPersonas.find(persona => (
      persona.id === row.persona_key || persona.id === row.persona_id
    )))
    .filter(Boolean)

  return mapped.length ? mapped : fallbackAgents
}

export async function savePlanetMemberPersonas(planet, personas) {
  if (!planet?.dbId) return null

  const { error: deleteError } = await supabase
    .from('chirp_planet_members')
    .delete()
    .eq('planet_id', planet.dbId)
    .eq('member_type', 'persona')

  if (deleteError) throw deleteError

  const rows = personas.map((persona, index) => ({
    planet_id: planet.dbId,
    member_type: 'persona',
    persona_key: persona.id,
    persona_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(persona.id) ? persona.id : null,
    position: index
  }))

  if (!rows.length) return []

  const { data, error } = await supabase
    .from('chirp_planet_members')
    .insert(rows)
    .select()

  if (error) throw error
  window.dispatchEvent(new CustomEvent('chirp:planet-personas-updated', { detail: { planetId: planet.id } }))
  return data
}
