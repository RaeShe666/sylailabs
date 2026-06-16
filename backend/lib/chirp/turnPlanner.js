const AMBIENT_TRIGGERS = new Set(['ambient', 'group_personal_record'])
const EXPLICIT_MENTION_TRIGGERS = new Set(['mention_persona', 'mention_personas', 'mention_all'])

const sameId = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

function uniqueTargets(targets = []) {
  const seen = new Set()
  const out = []
  for (const target of targets) {
    if (!target?.agentId || !target?.agentRole) continue
    const key = `${target.agentRole}:${target.agentId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(target)
  }
  return out
}

// Per-target plan: { target, mode, gate }.
//   gate=false → reply directly (no judgment): DM, @-mentioned, quoted persona,
//                and ambient personas the FIRST gate (targeting) marked must-reply.
//   gate=true  → second gate: that persona self-decides whether to reply.
// `targeting` is the first-gate read; it only affects ambient turns.
export function buildSpeakerPlans({ isDM = false, activation = {}, agents = [], targeting = null }) {
  if (isDM) {
    return uniqueTargets(activation.targets).map(target => ({
      target,
      mode: 'mentioned',
      gate: false
    }))
  }

  const triggerType = activation.triggerType || 'ambient'
  const hardTargets = uniqueTargets(activation.targets || [])
  const hardPersonaIds = new Set(
    hardTargets
      .filter(target => target.agentRole === 'persona')
      .map(target => String(target.agentId).toLowerCase())
  )

  // @-mentions: only the mentioned reply. No second gate.
  if (EXPLICIT_MENTION_TRIGGERS.has(triggerType)) {
    return hardTargets.map(target => ({
      target,
      mode: 'mentioned',
      gate: false
    }))
  }

  // Quote: the quoted persona replies directly; everyone else goes straight to
  // the second gate (self-decide). No first gate / targeting here.
  if (triggerType === 'reply_persona') {
    return [
      ...hardTargets.map(target => ({
        target,
        mode: 'mentioned',
        gate: false
      })),
      ...agents
        .filter(agent => ![...hardPersonaIds].some(id => sameId(id, agent.id) || sameId(id, agent.personaKey) || sameId(id, agent.persona_key)))
        .map(agent => ({
          target: { agentRole: 'persona', agentId: agent.id },
          mode: 'ambient',
          gate: true
        }))
    ]
  }

  // Ambient (no @, no quote): the FIRST gate (targeting) picks who must reply;
  // everyone else falls through to the second gate.
  if (AMBIENT_TRIGGERS.has(triggerType)) {
    const mustReply = targeting?.must_reply || 'none'
    if (mustReply === 'all') {
      return agents.map(agent => ({
        target: { agentRole: 'persona', agentId: agent.id },
        mode: 'mentioned',
        gate: false
      }))
    }
    const obligated = new Set()
    if (mustReply === 'specific') {
      for (const ref of (targeting.target_personas || [])) {
        const agent = agents.find(a => sameId(a.id, ref) || sameId(a.personaKey, ref) || sameId(a.persona_key, ref))
        if (agent) obligated.add(String(agent.id).toLowerCase())
      }
    }
    return agents.map(agent => {
      const isObligated = obligated.has(String(agent.id).toLowerCase())
      return {
        target: { agentRole: 'persona', agentId: agent.id },
        mode: isObligated ? 'mentioned' : 'ambient',
        gate: !isObligated
      }
    })
  }

  return hardTargets.map(target => ({
    target,
    mode: 'mentioned',
    gate: false
  }))
}
