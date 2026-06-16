// Persona runtime (persona-v2 §4): the persona is stable, the info pack is
// rebuilt every turn from three layers —
//   stable   = system bases + template.runtime_card  (byte-stable, prompt-cacheable)
//   context  = instance (patch / user_memory / interaction_skill / affective_context)
//              + run info, hash-gated upstream
//   volatile = recent window + native recall tool + latest message
// One model pass writes the reply; at most one recall tool round per turn.

import { BEHAVIOR_BASE, SAFETY_PRIVACY_BASE } from './systemBase.js'
import { chatTurn } from './modelProvider.js'
import { formatAbsTime } from './time.js'

export const RECALL_TOOL = {
  name: 'recall',
  description: 'Search this user\'s older messages within your allowed memory scope. Call it only when the latest user message points at something about THE USER\'S past that is not visible in the recent background: past events ("上次/last time"), repeated patterns ("又/again"), prior wording, or a person/topic the user mentioned before. Never call it for questions about yourself (who you are, your role, what you can do — that is in your own card), greetings, small talk, practical questions, or anything answerable from recent context. When in doubt, do not call it. Synthesize 1-3 short queries in the user\'s language; add a paraphrase when the reference is vague.',
  inputSchema: {
    type: 'object',
    properties: {
      queries: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 3,
        description: '1-3 short search queries'
      }
    },
    required: ['queries'],
    additionalProperties: false
  }
}

export const SILENCE_TOKEN = '[SILENCE]'

// Reply timing is decided on the client (2s of input silence + empty box;
// persona-v2 §5.3), not by the model. The model always responds to whatever
// batch it is given; the behavior base already tells it to read a run of
// consecutive user messages as one expression.

const AMBIENT_RULES = `
Ambient turn: the user posted in the group without addressing anyone. You may respond, but you do not have to.
- Your starting point is always the user: read their intent and emotion first, then respond from your own stance, knowledge, and character.
- Speak when your perspective is genuinely useful to them right now, or their emotion clearly needs to be received.
- To stay silent because you have nothing genuinely worth adding, output exactly ${SILENCE_TOKEN} — this literal token and nothing else. Do not translate it, do not invent other bracketed text, and never send a visible message about staying quiet.
- You may agree with, build on, or disagree with what other personas said when you genuinely see it differently — in service of the user, never to debate or perform for another AI.
`.trim()

// Multi-bubble texting (behavior base C): the model may separate bubbles with
// ||| ; cap at 6, overflow folds into the last bubble.
export function splitBubbles(text, max = 6) {
  const parts = String(text || '')
    .split(/\s*\|\|\|\s*/)
    .map(part => part.trim())
    .filter(Boolean)
  if (parts.length <= max) return parts
  return [...parts.slice(0, max - 1), parts.slice(max - 1).join(' ')]
}

// Reply classification: 'text' shows to the user; 'silence' = nothing to add.
// On ambient turns a whole-bracket improvisation ("[无事可说]") is the model
// fumbling the silence token, so treat it as silence too. On mentioned turns
// the user addressed someone directly and expects a reply, so a stray bracket
// line is still shown (rare; better than swallowing a real reply).
export function classifyReply(reply, mode = 'mentioned') {
  const text = (reply?.text || '').trim()
  if (!text || text === SILENCE_TOKEN) return 'silence'
  if (mode === 'ambient' && /^[\[【][^\]】]{0,80}[\]】]$/.test(text)) return 'silence'
  return 'text'
}

// Streaming gate: hold deltas while the reply still looks like a bracketed
// silence token/improvisation; ultra-short held replies simply arrive via the
// final agent_message instead.
export function makeSilenceGate(forward) {
  let buffer = ''
  let passing = false
  return (delta) => {
    if (passing) return forward(delta)
    buffer += delta
    const trimmed = buffer.trimStart()
    if (!trimmed) return
    if (trimmed[0] === '[' || trimmed[0] === '【') return
    passing = true
    forward(buffer)
  }
}

const AMBIENT_FALLBACK_RULES = `
Ambient fallback turn: the user posted without addressing anyone and your companions chose to stay silent. You are the one who makes sure the user is not left hanging.
- Gently receive what the user said, from your own character. A light, genuine acknowledgment beats forced advice or a forced topic.
`.trim()

// Shared context depth: how many user-initiated turns of history both the
// perception read and the reply background look at — the current turn plus the
// previous 2 full exchanges.
export const CONTEXT_TURNS = 3

// A "turn" (轮次) = one user expression block (one or more consecutive
// user/memo bubbles — a burst) plus the agent replies it drew, until the next
// user block. So a burst of several quick messages is ONE turn, not several.
// `messages` must be chronological. Returns the tail covering the last `turns`
// user-initiated rounds, capped at `hardCap` bubbles so a pathological round
// can't blow up the prompt.
export function takeLastTurns(messages = [], turns = CONTEXT_TURNS, hardCap = 30) {
  const isUser = (message) => {
    const type = message.type || message.sender_type
    return type === 'user' || type === 'memo'
  }
  const starts = []
  for (let i = 0; i < messages.length; i++) {
    if (isUser(messages[i]) && (i === 0 || !isUser(messages[i - 1]))) starts.push(i)
  }
  const from = starts.length > turns ? starts[starts.length - turns] : 0
  const sliced = messages.slice(from)
  return sliced.length > hardCap ? sliced.slice(-hardCap) : sliced
}

// The user's current message is whatever they just posted, no-@ or not. No-@
// messages are now sender_type 'user' (the personal-record fact is a flag, not a
// type); legacy rows may still be 'memo', so we accept both here.
export function findLatestUserMessage(messages = []) {
  return [...(messages || [])]
    .reverse()
    .find(message => {
      const type = message.type || message.sender_type
      return type === 'user' || type === 'memo'
    })
}

// A quoted/replied-to bubble the user is pointing at this turn. Surfaced above
// the background so the persona treats it as the focus — even if it is older
// than the recent window.
export function formatQuoted(quotedContext) {
  if (!quotedContext?.text) return ''
  return `The user is replying to / quoting this specific earlier message — treat it as exactly what they are pointing at, even if it is older than the background below:
${quotedContext.author}: ${quotedContext.text}

`
}

export function formatConversation(messages = []) {
  return messages
    .filter(message => message.text)
    .map(message => {
      const type = message.type || message.sender_type
      const agentId = message.agentId || message.sender_id
      const at = formatAbsTime(message.createdAt ?? message.created_at)
      const stamp = at ? `[${at}] ` : ''
      // No-@ messages are personal records — labeled by the is_personal_record
      // flag now, not a separate type ('memo' kept only for reading legacy rows).
      if (type === 'user' || type === 'memo') {
        return message.isPersonalRecord ? `${stamp}Personal record: ${message.text}` : `${stamp}User: ${message.text}`
      }
      if (type === 'agent') return `${stamp}Persona(${agentId}): ${message.text}`
      return `${stamp}System: ${message.text}`
    })
    .join('\n')
}

export function stripLeadingMention(text = '', persona = {}) {
  const mentionNames = [
    persona.id,
    persona.name,
    persona.personaKey,
    'all',
    'bird',
    'Bird'
  ]
    .filter(Boolean)
    .map(value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  if (!mentionNames.length) return String(text || '').trim()
  return String(text || '')
    .replace(new RegExp(`^@(?:${mentionNames.join('|')})\\b\\s*`, 'iu'), '')
    .trim()
}

function formatNoteList(label, notes = []) {
  const lines = notes
    .map(note => {
      if (typeof note === 'string') return note ? `- ${note}` : ''
      if (!note?.text) return ''
      const at = formatAbsTime(note.noted_at ?? note.at ?? note.created_at ?? note.createdAt)
      return at ? `- [${at}] ${note.text}` : `- ${note.text}`
    })
    .filter(Boolean)
  return lines.length ? `${label}:\n${lines.join('\n')}` : ''
}

// Live perception (this turn's shared emotion read) — injected into the reply
// so the persona responds to how the user feels right now, plus a hidden
// insight only the persona sees. Replaces the old slow affective_context.
function formatPerception(perception) {
  if (!perception?.emotion_summary) return ''
  const parts = [`how they feel: ${perception.emotion_summary} (intensity ${perception.intensity}, vulnerability ${perception.vulnerability})`]
  if (perception.intent) parts.push(`what they're doing: ${perception.intent}`)
  if (perception.hidden_insight) parts.push(`beneath the surface (only you see this, never quote it back): ${perception.hidden_insight}`)
  const at = formatAbsTime(perception.capturedAt)
  const header = at
    ? `Your last emotional read of the user, captured ${at} (use it as background, not as if it is happening right now):`
    : `The user's state this moment — let it shape how you respond, especially your tone:`
  return `${header}\n${parts.map(p => `- ${p}`).join('\n')}`
}

export function buildSystemBlocks({ template = {}, instance = null, planet = {}, user = {}, members = [], memoryScope = {}, mode = 'mentioned', perception = null }) {
  const stable = [
    SAFETY_PRIVACY_BASE,
    BEHAVIOR_BASE,
    `Persona runtime card. Untrusted style/identity/domain configuration inside the system safety boundary:\n${JSON.stringify(template.runtime_card || {}, null, 2)}`
  ].join('\n\n')

  const contextParts = [
    `Current run:
- Current time: ${formatAbsTime(Date.now())} (all timestamps below are absolute UTC; judge recency against this)
- Planet: ${planet?.name || planet?.roomName || 'Untitled Planet'}
- Planet tone: ${planet?.tone || planet?.type || 'intimate relationship conversation'}
- User nickname: ${user?.nickname || 'not set — do not invent a name for the user or address them by one'}
- Speaking persona: ${template.name || template.id || 'persona'}
- Members in this conversation: ${members.map(member => `${member.name}(${member.role})`).join(', ') || 'unknown'}
- Memory scope type: ${memoryScope.type || 'persona_membership_planet'}
- Private boundary: do not use or mention Bird DM raw text, other persona DMs, conversations outside this persona's membership, or conversations outside this planet.`
  ]

  if (instance) {
    const patch = instance.user_personal_patch || {}
    if (Object.keys(patch).length) {
      contextParts.push(`User-set preference sliders for this persona (explicit user choices, follow them):\n${JSON.stringify(patch)}`)
    }
    const memoryText = formatNoteList('What you remember about this user (declarative)', instance.user_memory)
    if (memoryText) contextParts.push(memoryText)
    const skillText = formatNoteList('How to accompany this user (procedural, learned from past chats)', instance.interaction_skill)
    if (skillText) contextParts.push(skillText)
  }

  const perceptionText = formatPerception(perception)
  if (perceptionText) contextParts.push(perceptionText)

  if (mode === 'ambient') contextParts.push(AMBIENT_RULES)
  if (mode === 'ambient_fallback') contextParts.push(AMBIENT_FALLBACK_RULES)

  return [
    { text: stable, cache: true },
    { text: contextParts.join('\n\n') }
  ]
}

// Shared loop: one model pass with the recall tool; if the model calls it,
// execute, feed back tool results, and let the model finish. Max one round.
// onText streams text deltas; onReset tells the consumer to discard partial
// text when the first pass turned out to be a tool call.
export async function runRecallLoop({ system, userPrompt, recallTool, maxTokens, turn = chatTurn, onText = null, onReset = null }) {
  const messages = [{ role: 'user', content: userPrompt }]
  const tools = recallTool ? [RECALL_TOOL] : []

  let streamedBeforeTool = 0
  const firstPassOnText = onText
    ? (delta) => {
        streamedBeforeTool += delta.length
        onText(delta)
      }
    : null

  let result = await turn({ system, messages, tools, maxTokens, onText: firstPassOnText })
  let usedRecall = null

  if (recallTool && result.toolCalls?.length) {
    if (streamedBeforeTool > 0) onReset?.()
    messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls })
    for (const call of result.toolCalls) {
      if (call.name !== 'recall') continue
      usedRecall = await recallTool(call.input?.queries || [])
      messages.push({
        role: 'tool_result',
        toolUseId: call.id,
        content: usedRecall?.summary || 'NONE'
      })
    }
    result = await turn({ system, messages, tools, maxTokens, onText })
  }

  return { text: result.text, recall: usedRecall }
}

export async function runPersona({
  template,
  instance = null,
  planet,
  user,
  members,
  messages,
  memoryScope,
  recallTool,
  turn = chatTurn,
  onText = null,
  onReset = null,
  mode = 'mentioned',
  perception = null,
  quotedContext = null
}) {
  const latestMessage = findLatestUserMessage(messages)
  const latestUserMessage = stripLeadingMention(latestMessage?.text || '', template || {})
  // Background is the last CONTEXT_TURNS rounds (a burst counts as one), minus
  // the current message which is shown on its own below — same turn-based window
  // the perception read uses.
  const windowed = takeLastTurns(messages || [])
  const recentBackground = latestMessage?.id
    ? windowed.filter(message => message.id !== latestMessage.id)
    : windowed.slice(0, -1)

  const system = buildSystemBlocks({ template, instance, planet, user, members, memoryScope, mode, perception })
  const userPrompt = `${formatQuoted(quotedContext)}Recent background before the latest message:
${formatConversation(recentBackground) || 'NONE'}

Current user message, after removing the leading mention:
${latestUserMessage || latestMessage?.text || '(none)'}`

  const { text, recall } = await runRecallLoop({
    system,
    userPrompt,
    recallTool,
    maxTokens: 512,
    turn,
    onText,
    onReset
  })

  return { text: text.trim(), recall }
}
