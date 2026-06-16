// Per-persona participation gate. This is the turn-taking system, not the
// emotion perception system: it decides whether a persona should participate in
// the current group turn, using only compact conversation facts.

import { cheapChat } from './modelProvider.js'
import { formatTargetingConversation } from './turnTargeting.js'

// Kept for older tests/helpers. Current routing no longer depends on current
// turn emotion perception to short-circuit participation.
export function structuralObligation(perception, personaId) {
  if (!perception) return null
  if (perception.continues_thread_of && sameId(perception.continues_thread_of, personaId)) return 'continuation'
  if (perception.addressed_to && sameId(perception.addressed_to, personaId)) return 'addressed'
  return null
}

function cardSummary(template = {}) {
  const card = template.runtime_card || {}
  return [
    `id: ${template.id || template.personaKey}`,
    card.identity_summary && `identity: ${card.identity_summary}`,
    card.value_lens_summary && `lens: ${card.value_lens_summary}`,
    card.knows && `knows: ${card.knows}`
  ].filter(Boolean).join('\n')
}

// SECOND GATE: this persona self-decides whether to chime in. Pure character
// judgment — does THIS persona, reading what the user means and how they feel,
// naturally want to respond. Saying something similar to another persona is fine;
// it must never stay silent just because someone else might also reply. The
// turn-targeting read is one input (light context), not a command. Emotion is read
// from the user's message itself here — the previous turn's stored emotion (which
// shapes the reply's tone) is deliberately NOT fed in; it does not decide turns.
export function buildGatePrompt({
  template,
  members,
  latestText,
  recentMessages = [],
  targeting = null,
  quotedContext = null
}) {
  const others = (members || []).map(m => m.name).join(', ')
  const quotedText = quotedContext?.text
    ? `\nThe user is replying to this earlier message:\n${quotedContext.author}: ${quotedContext.text}`
    : ''
  const targetingHint = targeting && (targeting.trigger || (targeting.target_personas || []).length)
    ? `\n(Light context — the turn reads as: ${targeting.trigger || 'open'}${(targeting.target_personas || []).length ? `, aimed at ${targeting.target_personas.join(', ')}` : ''}. Not a command.)`
    : ''

  const system = `You decide ONLY for THIS persona whether to chime into a Chirp private group chat. Several personas may speak in the same turn. Judge purely as THIS character — your identity, lane, values — reading the user's latest turn: what they mean and how they feel right now. Output ONLY JSON.

This persona:
${cardSummary(template)}

Others in the room: ${others || 'none'}.${quotedText}${targetingHint}

speak=true if, as this persona, you naturally feel like responding — it interests you, it touches your lane, you have a real reaction, or the user's feeling pulls you in. You do NOT need to add something the others cannot; saying something similar to another persona is completely fine; never stay silent just because someone else might also reply.
speak=false only when, as this character, you genuinely have no reaction and would only produce filler.

Output: {"speak": true|false, "reason": "short"}`

  const user = `Recent context before latest:
${formatTargetingConversation(recentMessages)}

Current user turn:
${latestText || '(none)'}`
  return { system, user }
}

export async function decideParticipation({
  template,
  members,
  latestText,
  recentMessages = [],
  targeting = null,
  quotedContext = null,
  chat = cheapChat
}) {
  try {
    const { system, user } = buildGatePrompt({ template, members, latestText, recentMessages, targeting, quotedContext })
    const text = await chat({ system, user, maxTokens: 200 })
    const match = String(text).match(/\{[\s\S]*\}/)
    if (!match) return { speak: false, reason: 'unparsed' }
    const d = JSON.parse(match[0])
    return {
      speak: Boolean(d.speak),
      reason: typeof d.reason === 'string' ? d.reason : ''
    }
  } catch (error) {
    console.warn('Chirp participation gate failed; defaulting to silent:', error.message || error)
    return { speak: false, reason: 'error' }
  }
}

function sameId(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}
