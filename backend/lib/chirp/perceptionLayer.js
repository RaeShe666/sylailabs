// Real-time perception layer (persona-v2 section 5.3).
// One shared, persona-agnostic call per turn reads the user's current emotion,
// intent, and hidden insight. Turn targeting/participation is handled by the
// separate targeting funnel, so this layer stays emotion-only.

import { cheapChat } from './modelProvider.js'
import { formatAbsTime } from './time.js'

function formatRecent(messages = [], tzOffset = null) {
  return messages
    .filter(m => m.text)
    .map(m => {
      const type = m.type || m.sender_type
      const who = type === 'user' || type === 'memo' ? 'User' : `Persona(${m.agentId || m.sender_id})`
      const at = formatAbsTime(m.createdAt ?? m.created_at, tzOffset)
      const stamp = at ? `[${at}] ` : ''
      return `${stamp}${who}: ${m.text}`
    })
    .join('\n') || '(none)'
}

export function buildPerceptionPrompt({ recentMessages, latestText, priorState, tzOffset = null }) {
  const system = `You are chirp's real-time perception layer. You silently read how the user is doing right now and output a compact JSON. You do NOT reply to the user and you are never shown to them.

Read the user's latest message in the context of the recent turns and the prior emotional read, then output ONLY this JSON (no prose, no markdown):
{
  "emotion_summary": "one short sentence, in the user's language, on how they feel right now",
  "valence": "pos" | "neu" | "neg",
  "intensity": 0.0,
  "vulnerability": "low" | "med" | "high",
  "intent": "what the user is doing: venting / asking / sharing / smalltalk / meta-question / self-talk / ...",
  "hidden_insight": "one short insight BENEATH the words that the user themselves may not see; empty string if nothing real"
}
Be honest and specific. Do not flatter. Most messages are mundane, say so plainly.
ALWAYS write emotion_summary and hidden_insight in the SAME language the user is writing in (if they write Chinese, write them in Chinese). Never switch to another language.`

  const user = `Current time: ${formatAbsTime(Date.now(), tzOffset)} (timestamps below are absolute, in the user's local timezone)
Recent turns:
${formatRecent(recentMessages, tzOffset)}

Prior emotional read (may be stale): ${priorState?.emotion_summary ? JSON.stringify({ emotion_summary: priorState.emotion_summary, intent: priorState.intent }) : 'none'}

The user's latest message:
${latestText || '(none)'}`

  return { system, user }
}

export function parsePerception(text) {
  if (!text) return null
  const match = String(text).match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const p = JSON.parse(match[0])
    return {
      emotion_summary: typeof p.emotion_summary === 'string' ? p.emotion_summary : '',
      valence: ['pos', 'neu', 'neg'].includes(p.valence) ? p.valence : 'neu',
      intensity: clamp01(p.intensity),
      vulnerability: ['low', 'med', 'high'].includes(p.vulnerability) ? p.vulnerability : 'low',
      intent: typeof p.intent === 'string' ? p.intent : '',
      hidden_insight: typeof p.hidden_insight === 'string' ? p.hidden_insight : ''
    }
  } catch {
    return null
  }
}

export async function perceiveTurn({ recentMessages = [], latestText = '', priorState = null, chat = cheapChat, tzOffset = null }) {
  const { system, user } = buildPerceptionPrompt({ recentMessages, latestText, priorState, tzOffset })
  try {
    const text = await chat({ system, user, maxTokens: 500 })
    return parsePerception(text)
  } catch (error) {
    console.warn('Chirp perception failed; proceeding without it:', error.message || error)
    return null
  }
}

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0.3
  return Math.min(1, Math.max(0, n))
}
