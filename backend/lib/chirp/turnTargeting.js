import { cheapChat } from './modelProvider.js'

function memberList(members = []) {
  return members.map(member => `${member.name || member.id}(${member.id || member.role || 'persona'})`).join(', ') || 'unknown'
}

export function formatTargetingConversation(messages = [], max = 8) {
  return (messages || [])
    .filter(message => message?.text)
    .slice(-max)
    .map(message => {
      const type = message.type || message.sender_type
      const agentId = message.agentId || message.sender_id
      const who = type === 'user' || type === 'memo' ? 'User' : `Persona(${agentId || 'unknown'})`
      return `${who}: ${message.text}`
    })
    .join('\n') || 'NONE'
}

// FIRST GATE (turn-taking, ambient turns only — no @, no quote): decides WHO must
// reply directly. Personas it picks reply without a second judgment; everyone it
// does NOT pick falls through to the second gate (each persona self-decides).
// MECE, no priority — the criteria below are a union:
//   - low emotion  → everyone gathers (must_reply = all)
//   - whole room   → everyone answers   (must_reply = all)
//   - aimed at some → those personas    (must_reply = specific)
//   - none of the above                 (must_reply = none → all self-decide)
export function buildTargetingPrompt({ members = [], recentMessages = [], latestText = '' }) {
  const system = `You are Chirp's first gate for a private group chat: decide WHO must reply to the user's latest turn. You do not write replies, analyze emotion in depth, or give advice. Output ONLY compact JSON.

Decide must_reply (these criteria are a union — if more than one fits, "all" wins over "specific"):
- "all" when EITHER:
  - the user is clearly in a low or hurting state (sad, breaking down, hopeless, anxious, reaching out for comfort), so everyone should gather; OR
  - the turn is put to the whole room / everyone (asks the group, greets everyone, shares/announces something to the group, "你们觉得呢").
- "specific" when the turn points at, continues, questions, corrects, or reacts to particular persona(s) — by naming them (without @), replying to what they just said, continuing their topic, or putting a question to them. List those persona ids in target_personas.
- "none" when it is a general statement, share, or vent not aimed at anyone and not in a low/hurting state. No one is obligated.

Output:
{
  "must_reply": "all" | "specific" | "none",
  "trigger": "low_emotion" | "group" | "addressed" | "open",
  "target_personas": ["persona ids; [] unless must_reply is specific"],
  "why": "short reason, in the user's language"
}

Use persona ids exactly as listed. Personas in this room: ${memberList(members)}.`

  const user = `Recent context before latest:
${formatTargetingConversation(recentMessages)}

Latest user turn:
${latestText || '(none)'}`

  return { system, user }
}

export function parseTurnTargeting(text) {
  if (!text) return null
  const match = String(text).match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    const mustReply = ['all', 'specific', 'none'].includes(parsed.must_reply) ? parsed.must_reply : 'none'
    return {
      must_reply: mustReply,
      trigger: ['low_emotion', 'group', 'addressed', 'open'].includes(parsed.trigger) ? parsed.trigger : (mustReply === 'all' ? 'group' : mustReply === 'specific' ? 'addressed' : 'open'),
      target_personas: mustReply === 'specific' && Array.isArray(parsed.target_personas)
        ? parsed.target_personas.map(item => normalizeRef(item)).filter(Boolean)
        : [],
      why: typeof parsed.why === 'string' ? parsed.why : ''
    }
  } catch {
    return null
  }
}

export async function assessTurnTargeting({ members = [], recentMessages = [], latestText = '', chat = cheapChat }) {
  try {
    const { system, user } = buildTargetingPrompt({ members, recentMessages, latestText })
    const text = await chat({ system, user, maxTokens: 220 })
    return parseTurnTargeting(text)
  } catch (error) {
    console.warn('Chirp turn-targeting failed; proceeding without it:', error.message || error)
    return null
  }
}

function normalizeRef(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text) return null
  const lower = text.toLowerCase()
  if (lower === 'null' || lower === 'none' || lower === 'room' || lower === 'all') return null
  return text
}
