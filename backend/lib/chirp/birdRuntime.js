// Bird runtime: global observer. Same recall loop as personas, different
// identity and scope (bird reads broadly; personas are membership-scoped).

import { BEHAVIOR_BASE, SAFETY_PRIVACY_BASE } from './systemBase.js'
import { findLatestUserMessage, formatConversation, formatQuoted, runRecallLoop, stripLeadingMention, takeLastTurns } from './personaRuntime.js'
import { formatAbsTime } from './time.js'

const BIRD_SYSTEM = `
Bird runtime:
- You are Bird, Chirp's global observer and insight keeper.
- In group chat, speak only when explicitly mentioned or replied to.
- You do not route tasks. The Activation Router already decided this run.
- You can read broadly, but do not quote private Bird-DM source text in group chat.
- Offer one grounded observation or one clarifying question.
- Keep a low-monitoring feel. Use "maybe" and "I notice a possible pattern" when discussing patterns.
`.trim()

// Bird inherits the behavior base; only Bird-specific deltas live here.
const BIRD_REPLY_RULES = `
Bird reply rules:
- Default to even shorter replies than personas: one or two short sentences.
`.trim()

export async function runBird({ planet, user, members, messages, memoryScope, recallTool, turn, onText = null, onReset = null, quotedContext = null, currentUserText = null, currentMessageIds = [] }) {
  const latestMessage = findLatestUserMessage(messages)
  const latestUserMessage = stripLeadingMention(currentUserText || latestMessage?.text || '', { id: 'bird', name: 'Bird' })
  const windowed = takeLastTurns(messages || [])
  const currentIds = new Set((currentMessageIds || []).filter(Boolean))
  const recentBackground = currentIds.size
    ? windowed.filter(message => !currentIds.has(message.id))
    : latestMessage?.id
      ? windowed.filter(message => message.id !== latestMessage.id)
      : windowed.slice(0, -1)

  const tzOffset = typeof user?.tzOffset === 'number' ? user.tzOffset : null
  // Couple shared space: one scene-level note (persona untouched, no new
  // identity here — Rae will spec details later). It supersedes the group-chat
  // mention-only / read-broadly notes in the stable block above, matching the
  // narrowed couple_group_bird memory scope enforced DB-side.
  const isCoupleGroup = memoryScope?.type === 'couple_group_bird'
  const sceneLine = isCoupleGroup
    ? "- Scene: you are in a couple's shared space — a private group chat between two partners; here you reply to every message directly (no mention needed) and everything you can see or recall is limited to this conversation only (this supersedes the mention-only and read-broadly notes above)."
    : '- Bird may read broadly, but raw Bird-DM text must not be quoted in group chat.'
  const system = [
    { text: [SAFETY_PRIVACY_BASE, BEHAVIOR_BASE, BIRD_SYSTEM].join('\n\n'), cache: true },
    {
      text: `Current run:
- Current time: ${formatAbsTime(Date.now(), tzOffset)} (timestamps below are absolute, in the user's local timezone)
- Planet: ${planet?.name || planet?.roomName || 'Untitled Planet'}
- User nickname: ${user?.nickname || 'not set — do not invent a name for the user or address them by one'}
- Members in this conversation: ${(members || []).map(member => `${member.name}(${member.role})`).join(', ') || 'unknown'}
- Memory scope type: ${memoryScope?.type || 'global_bird'}
${sceneLine}

${BIRD_REPLY_RULES}`
    }
  ]

  const userPrompt = `${formatQuoted(quotedContext)}Recent background before the latest message:
${formatConversation(recentBackground, tzOffset) || 'NONE'}

Current user message, after removing the leading mention:
${latestUserMessage || latestMessage?.text || '(none)'}`

  const { text, recall } = await runRecallLoop({
    system,
    userPrompt,
    recallTool,
    maxTokens: 400,
    onText,
    onReset,
    ...(turn ? { turn } : {})
  })

  return { text: text.trim(), recall }
}
