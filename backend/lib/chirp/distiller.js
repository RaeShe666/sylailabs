// L1 fragment distillation (persona-v2 §5.2): replies go first, memory is
// written afterwards. Per instance we only keep a ledger each turn; an async
// job distills the new segment into short deltas when the conversation pauses
// (idle) or enough turns pile up (cap), whichever comes first.
//
// Writes go to chirp_persona_instances: user_memory (declarative) and
// interaction_skill (procedural: how to accompany THIS user). Silent recall
// means the reply path never waits for this.

import { chatTurn } from './modelProvider.js'
import { buildMemoryScope, resolveMemoryScope } from './memoryScope.js'

// Tunable knobs (产品旋钮，可调.
const TURN_CAP = 5                       // distill after this many persona turns
const IDLE_MS = 5 * 60 * 1000            // ...or after this much silence
const MIN_NEW_MESSAGES = 3               // skip tiny segments
const SEGMENT_LIMIT = 80                 // max messages read per distill run
const USER_MEMORY_CAP = 30               // keep long-term profile short (写入纪律)
const SKILL_CAP = 20

const trackers = new Map() // instanceId -> { turns, timer, running }

function getTracker(instanceId) {
  let tracker = trackers.get(instanceId)
  if (!tracker) {
    tracker = { turns: 0, timer: null, running: false }
    trackers.set(instanceId, tracker)
  }
  return tracker
}

// Called fire-and-forget after every completed persona run.
export function noteDistillTurn({ supabase, userId, template, instance }) {
  if (!supabase || !userId || !template?.id || !instance?.id) return

  const tracker = getTracker(instance.id)
  tracker.turns += 1
  if (tracker.timer) clearTimeout(tracker.timer)
  tracker.timer = null

  const fire = () => {
    runDistillation({ supabase, userId, template, instanceId: instance.id })
      .catch(error => console.warn('Chirp L1 distillation failed:', error.message || error))
  }

  if (tracker.turns >= TURN_CAP) {
    fire()
  } else {
    tracker.timer = setTimeout(fire, IDLE_MS)
    tracker.timer.unref?.()
  }
}

export async function runDistillation({ supabase, userId, template, instanceId }) {
  const tracker = getTracker(instanceId)
  if (tracker.running) return
  tracker.running = true
  tracker.turns = 0
  if (tracker.timer) clearTimeout(tracker.timer)
  tracker.timer = null

  try {
    const { data: instanceRow, error: instanceError } = await supabase
      .from('chirp_persona_instances')
      .select('id,user_id,template_id,user_memory,interaction_skill,last_distilled_at')
      .eq('id', instanceId)
      .single()
    if (instanceError) throw instanceError

    const segment = await readNewSegment({ supabase, userId, template, instanceRow })
    if (segment.messages.length < MIN_NEW_MESSAGES) return

    const existingMemory = Array.isArray(instanceRow.user_memory) ? instanceRow.user_memory : []
    const existingSkills = Array.isArray(instanceRow.interaction_skill) ? instanceRow.interaction_skill : []

    const result = await chatTurn({
      system: [{ text: buildDistillerSystem({ template, existingMemory, existingSkills }) }],
      messages: [{ role: 'user', content: formatSegment(segment.messages) }],
      maxTokens: 700
    })

    const parsed = parseDistillation(result.text)
    if (!parsed) return

    const sourceIds = segment.messages.map(message => message.id).filter(Boolean)
    const update = {
      user_memory: mergeNotes(existingMemory, parsed.user_memory, sourceIds, USER_MEMORY_CAP),
      interaction_skill: mergeNotes(existingSkills, parsed.interaction_skill, sourceIds, SKILL_CAP),
      last_distilled_at: segment.latestAt || new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    const { error: updateError } = await supabase
      .from('chirp_persona_instances')
      .update(update)
      .eq('id', instanceId)
    if (updateError) throw updateError
  } finally {
    tracker.running = false
  }
}

async function readNewSegment({ supabase, userId, template, instanceRow }) {
  const scope = await resolveMemoryScope({
    supabase,
    ownerId: userId,
    scope: buildMemoryScope({
      conversationId: null,
      planetId: null,
      conversationType: 'group',
      target: { agentId: template.id, agentRole: 'persona' }
    })
  })

  if (!scope.allowed_conversation_ids?.length) return { messages: [], latestAt: null }

  let query = supabase
    .from('chirp_messages')
    .select('id,conversation_id,sender_type,sender_id,text,created_at')
    .in('conversation_id', scope.allowed_conversation_ids)
    .order('created_at', { ascending: true })
    .limit(SEGMENT_LIMIT)

  if (instanceRow.last_distilled_at) {
    query = query.gt('created_at', instanceRow.last_distilled_at)
  }

  const { data, error } = await query
  if (error) throw error

  const messages = (data || []).filter(message => message.text)
  return {
    messages,
    latestAt: messages.length ? messages[messages.length - 1].created_at : null
  }
}

function buildDistillerSystem({ template, existingMemory, existingSkills }) {
  const today = new Date().toISOString().slice(0, 10)
  return `You are the silent memory distiller for the chirp persona "${template.name || template.id}". You read a new segment of conversation and decide what this persona should remember about the user long-term. The user never sees your output.

Discipline:
- Distill, don't transcribe. Short conclusions, not quotes.
- Every note must pass three gates: durable (still true in a month), specific (names, facts, patterns —not vibes), future-leverageable (changes how the persona accompanies this user).
- Convert relative time to absolute dates. Today is ${today}.
- Do not duplicate or rephrase existing notes (listed below). Only genuinely new information.
- If nothing passes the gates, return empty arrays. Most small segments deserve nothing.

Note types:
- user_memory (declarative): facts and recurring patterns about the user and their relationships.
- interaction_skill (procedural): how to accompany THIS user —style corrections they gave, what kind of response landed or fell flat.

Existing user_memory:
${existingMemory.map(note => `- ${note.text}`).join('\n') || '(none)'}

Existing interaction_skill:
${existingSkills.map(note => `- ${note.text}`).join('\n') || '(none)'}

Output ONLY valid JSON:
{"user_memory":[{"text":"...","confidence":0.0}],"interaction_skill":[{"text":"...","confidence":0.0}]}`
}

function formatSegment(messages) {
  return `New conversation segment to distill:\n${messages
    .map(message => {
      const speaker = message.sender_type === 'user' || message.sender_type === 'memo'
        ? 'User'
        : `Persona(${message.sender_id})`
      return `${speaker}: ${message.text}`
    })
    .join('\n')}`
}

export function parseDistillation(text) {
  if (!text) return null
  const jsonMatch = String(text).match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      user_memory: normalizeNotes(parsed.user_memory),
      interaction_skill: normalizeNotes(parsed.interaction_skill)
    }
  } catch {
    return null
  }
}

function normalizeNotes(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(note => ({
      text: typeof note?.text === 'string' ? note.text.trim() : '',
      confidence: clamp01(note?.confidence)
    }))
    .filter(note => note.text)
}

// Append new deltas, dedupe by exact text, keep the newest `cap` entries
// (写入纪律: long-term profile stays short and overwritable).
export function mergeNotes(existing, deltas, sourceIds, cap) {
  const seen = new Set((existing || []).map(note => note.text))
  const fresh = (deltas || [])
    .filter(note => !seen.has(note.text))
    .map(note => ({
      text: note.text,
      confidence: note.confidence,
      source_message_ids: (sourceIds || []).slice(-10),
      noted_at: new Date().toISOString()
    }))

  return [...(existing || []), ...fresh].slice(-cap)
}

function clamp01(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0.5
  return Math.min(1, Math.max(0, num))
}
