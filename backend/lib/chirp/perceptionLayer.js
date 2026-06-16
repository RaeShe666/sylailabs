// Real-time perception layer (persona-v2 §5.3 实时情绪并行系统).
// ONE shared, persona-agnostic call per turn (cheap model) that reads the
// user's current state: emotion + intent + a hidden insight, plus the
// structural signals the participation gates need (who is addressed, is it a
// question, whose thread does it continue). It is about the USER, so it runs
// once and is reused by every persona that turn. Runs in parallel inside the
// client's input-silence window → ~zero added latency.
//
// Output is ephemeral per turn but the emotion slice persists (emotionStore)
// so the next turn's read builds on the trajectory, not just raw messages.

import { cheapChat } from './modelProvider.js'
import { formatAbsTime } from './time.js'

function memberList(members = []) {
  return members.map(m => `${m.name}(${m.id || m.role})`).join(', ') || 'unknown'
}

function formatRecent(messages = []) {
  return messages
    .filter(m => m.text)
    .map(m => {
      const type = m.type || m.sender_type
      const who = type === 'user' || type === 'memo' ? 'User' : `Persona(${m.agentId || m.sender_id})`
      const at = formatAbsTime(m.createdAt ?? m.created_at)
      const stamp = at ? `[${at}] ` : ''
      return `${stamp}${who}: ${m.text}`
    })
    .join('\n') || '(none)'
}

export function buildPerceptionPrompt({ members, recentMessages, latestText, priorState, includeStructural = true }) {
  // Structural signals (who it's aimed at / whose thread it continues / etc.)
  // only drive the group participation funnel. DMs don't gate, so they request
  // the emotion read only — lighter prompt, no wasted reasoning.
  const emotionFields = `  "emotion_summary": "one short sentence, in the user's language, on how they feel right now",
  "valence": "pos" | "neu" | "neg",
  "intensity": 0.0,            // 0 calm … 1 intense
  "vulnerability": "low" | "med" | "high",
  "intent": "what the user is doing: venting / asking / sharing / smalltalk / meta-question / self-talk / ...",
  "hidden_insight": "one short insight BENEATH the words that the user themselves may not see (e.g. 'says it's fine but this is the 3rd time she deflects this'); empty string if nothing real"`
  const structuralFields = `,
  "addressed_to": "persona id if the message is aimed at a specific persona even without @, else \\"room\\" if it's for the room, else null",
  "is_question": true,
  "continues_thread_of": "persona id whose ongoing topic this message continues (same topic, no switch); null if it's a new topic or a switch",
  "emotional_bid": true        // is the user reaching out to be received/comforted right now`
  const roomLine = includeStructural
    ? `\n\nPersonas in this room (for the address/thread fields, use their id): ${memberList(members)}.`
    : ''
  const system = `You are chirp's real-time perception layer. You silently read how the user is doing right now and output a compact JSON. You do NOT reply to the user and you are never shown to them.${roomLine}

Read the user's latest message in the context of the recent turns and the prior emotional read, then output ONLY this JSON (no prose, no markdown):
{
${emotionFields}${includeStructural ? structuralFields : ''}
}
Be honest and specific. Do not flatter. Most messages are mundane — say so plainly.
ALWAYS write emotion_summary and hidden_insight in the SAME language the user is writing in (if they write Chinese, write them in Chinese). Never switch to another language.`

  const user = `Recent turns:
${formatRecent(recentMessages)}

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
      hidden_insight: typeof p.hidden_insight === 'string' ? p.hidden_insight : '',
      addressed_to: normalizeRef(p.addressed_to),
      is_question: Boolean(p.is_question),
      continues_thread_of: normalizeRef(p.continues_thread_of),
      emotional_bid: Boolean(p.emotional_bid)
    }
  } catch {
    return null
  }
}

export async function perceiveTurn({ members = [], recentMessages = [], latestText = '', priorState = null, chat = cheapChat, includeStructural = true }) {
  const { system, user } = buildPerceptionPrompt({ members, recentMessages, latestText, priorState, includeStructural })
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

function normalizeRef(value) {
  if (value === null || value === undefined) return null
  const s = String(value).trim().toLowerCase()
  if (!s || s === 'null' || s === 'none') return null
  return String(value).trim()
}
