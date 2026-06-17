const normalize = (value = '') => String(value).trim()

// Mentions count anywhere in the message, not only at the start (Chinese text
// has no spaces, so users naturally type "一行字@诞总"). If several personas
// are mentioned, the earliest one wins; @all / @bird take precedence.
export function parseMention(text = '', agents = []) {
  const value = normalize(text)
  if (/@all\b/i.test(value)) return { type: 'all' }
  if (/@(bird\b|小鸟|小草)/i.test(value)) return { type: 'bird', agentId: 'bird' }

  const lower = value.toLowerCase()
  const mentioned = agents
    .map(agent => {
      const aliases = [agent.name, agent.id]
        .map(alias => normalize(alias).toLowerCase())
        .filter(Boolean)
      const positions = aliases
        .map(alias => lower.indexOf(`@${alias}`))
        .filter(index => index >= 0)
      return positions.length ? { agentId: agent.id, index: Math.min(...positions) } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)

  // Mentioning 2+ personas fans out to all of them (same parallel run as
  // @all), displayed in mention-appearance order.
  if (mentioned.length) return { type: 'persona', agentIds: mentioned.map(item => item.agentId) }
  return { type: 'none' }
}

export function routeActivation({ conversation = {}, message = {}, agents = [], replyTo = null }) {
  const conversationType = conversation.type || 'group'
  const mention = parseMention(message.text, agents)

  if (conversationType === 'bird_dm') {
    return {
      triggerType: 'bird_dm',
      isPersonalRecord: true,
      targets: [{ agentRole: 'bird', agentId: 'bird' }]
    }
  }

  if (conversationType === 'persona_dm') {
    const agentId = conversation.agentId || conversation.personaId || agents[0]?.id
    return {
      triggerType: 'persona_dm',
      isPersonalRecord: false,
      targets: agentId ? [{ agentRole: 'persona', agentId }] : []
    }
  }

  // @-mentions and a quoted bubble COMPOSE into the target set. A quoted
  // persona must reply (it's an obligation) and is added alongside any @ —
  // it never overrides it, so there is no quote-vs-@ conflict. Quoting the
  // user's own bubble forces no target: routing then follows the text (@ or
  // ambient) and the quote is carried only as prompt context.
  const quoted = resolveQuotedTarget(replyTo)
  // Bird is DM-only now — it never participates in a group, so @bird / quoting
  // bird inside a group does nothing (the message falls through to ambient).
  const personaIds = []
  if (mention.type === 'all') agents.forEach(agent => personaIds.push(agent.id))
  else if (mention.type === 'persona') mention.agentIds.forEach(id => personaIds.push(id))
  if (quoted?.type === 'persona' && !personaIds.includes(quoted.agentId)) personaIds.push(quoted.agentId)

  const targets = personaIds.map(agentId => ({ agentRole: 'persona', agentId }))

  if (targets.length) {
    let triggerType
    if (mention.type === 'all') triggerType = 'mention_all'
    else if (personaIds.length > 1) triggerType = 'mention_personas'
    else triggerType = mention.type === 'persona' ? 'mention_persona' : 'reply_persona'
    return { triggerType, isPersonalRecord: false, targets }
  }

  // No mention, no quoted target: ambient. The first gate (turntargeting) +
  // second gate (per-persona self-judgment) decide who replies — no hardcoded
  // primary persona. Targets stay empty; the planner works off `agents`.
  return {
    triggerType: agents.length ? 'ambient' : 'group_personal_record',
    isPersonalRecord: true,
    ambient: true,
    targets: []
  }
}

// A quoted bubble becomes a forced reply target only when it belongs to an
// agent. Quoting the user's own message returns null (routing follows the text).
function resolveQuotedTarget(replyTo) {
  if (!replyTo) return null
  if (replyTo.agentRole === 'bird' || replyTo.agentId === 'bird') return null
  if (replyTo.agentRole === 'persona' || (replyTo.agentId && replyTo.agentId !== 'user')) {
    return { type: 'persona', agentId: replyTo.agentId }
  }
  return null
}
