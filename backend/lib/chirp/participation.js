// Per-persona participation gate (decentralized — each persona judges itself).
// Runs only for no-@ (ambient) turns. Two gates in a funnel:
//   义务闸 obligation (any one true → MUST reply, skip motivation):
//     ① 续聊: continues my thread / reacts to my words (continues_thread_of == me)
//     ② 指向: addressed to me without @ (addressed_to == me)
//     ③ 提问: it's a question and I'm the most fitting answerer
//     ④ 情绪求接: emotional bid and I'm the right presence to catch it
//   动机闸 motivation (only if obligation failed): ONE holistic judgment —
//     given who I am (personality/traits) + the user's message + the shared
//     emotion, do I genuinely feel moved to chime in / think it's worth it?
//     (Less scaffolding, trust the model's character judgment.)
// Structural parts of the obligation gate (①②) are computed in code from the
// shared perception; the judgment parts (③④ + motivation) go to the cheap
// model with THIS persona's card so the call is authentically its own.

import { cheapChat } from './modelProvider.js'

// Fast structural pass: obligation that needs no judgment.
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

export function buildGatePrompt({ template, perception, members, latestText }) {
  const others = (members || []).map(m => m.name).join(', ')
  const ownerNote = (perception?.continues_thread_of || perception?.addressed_to)
    ? `This message continues / is aimed at "${perception.continues_thread_of || perception.addressed_to}" — that is NOT you. So it is already being handled. Do not claim obligation just because it's a question; only speak if YOU genuinely have something to add.`
    : `This message is not aimed at anyone in particular.`
  const system = `You decide, AS this persona, whether to speak in a group chat where the user did NOT @ anyone. Judge as this character, in its own voice and lane — not as a neutral assistant. Default to staying quiet unless you have a real reason; a calm room beats everyone piling on. Output ONLY JSON.

This persona:
${cardSummary(template)}

Others in the room: ${others || 'none'}.
${ownerNote}

Shared read of the user right now:
- emotion: ${perception?.emotion_summary || 'unknown'} (valence ${perception?.valence}, intensity ${perception?.intensity}, vulnerability ${perception?.vulnerability})
- intent: ${perception?.intent || 'unknown'}
- is a question: ${perception?.is_question}
- reaching out to be received: ${perception?.emotional_bid}
- hidden insight: ${perception?.hidden_insight || 'none'}

Decide via two gates, in order:
OBLIGATION (rare for you — only if the message is clearly meant for YOU over anyone else; if true → speak=true, gate="obligation"):
- the question lands on YOU specifically and no one is more fitting
- the user is reaching out emotionally and you, more than the others, are the right presence to catch it
MOTIVATION (otherwise): as THIS character, reading the user's message and how they feel right now — do you genuinely feel moved to chime in, or think it's worth saying something? Judge from your own personality and traits, not as a helpful assistant. If yes → speak=true, gate="motivation".
Otherwise speak=false, gate=null.

Output: {"speak": true|false, "gate": "obligation"|"motivation"|null, "reason": "short"}`

  const user = `User's latest message:
${latestText || '(none)'}`
  return { system, user }
}

export async function decideParticipation({ template, perception, members, latestText, chat = cheapChat }) {
  // Structural obligation short-circuits the model call.
  const structural = structuralObligation(perception, template.id)
  if (structural) return { speak: true, gate: 'obligation', reason: structural }

  try {
    const { system, user } = buildGatePrompt({ template, perception, members, latestText })
    const text = await chat({ system, user, maxTokens: 200 })
    const match = String(text).match(/\{[\s\S]*\}/)
    if (!match) return { speak: false, gate: null, reason: 'unparsed' }
    const d = JSON.parse(match[0])
    return {
      speak: Boolean(d.speak),
      gate: d.speak ? (d.gate === 'obligation' ? 'obligation' : 'motivation') : null,
      reason: typeof d.reason === 'string' ? d.reason : ''
    }
  } catch (error) {
    console.warn('Chirp participation gate failed; defaulting to silent:', error.message || error)
    return { speak: false, gate: null, reason: 'error' }
  }
}

function sameId(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}
