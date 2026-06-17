export function serializeChirpAgent(agent = {}) {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    systemPrompt: agent.systemPrompt,
    skills: snapshotValue(agent.skills),
    identity: snapshotValue(agent.identity),
    relationship: snapshotValue(agent.relationship),
    voice_style: snapshotValue(agent.voice_style),
    boundaries: snapshotValue(agent.boundaries),
    reply_policy: snapshotValue(agent.reply_policy),
    memory_policy: snapshotValue(agent.memory_policy),
    examples: snapshotValue(agent.examples)
  }
}

export function serializeChirpMember(member = {}) {
  return {
    id: member.id,
    name: member.name,
    role: member.role
  }
}

export function serializeChirpMessage(message = {}) {
  return {
    type: message.type,
    text: message.text,
    agentId: message.agentId
  }
}

export function buildChirpTurnPayload({
  texts,
  currentMessages = [],
  replyTo = null,
  planet = {},
  planetConfig = {},
  recent = {},
  isDM = false,
  isBirdDM = false,
  dmAgent = null,
  dmConversationId = null,
  userProfile = {},
  agents = [],
  visibleMembers = [],
  tzOffset = 0
}) {
  return {
    planet: {
      ...structuredCloneSafe(planet),
      recentUserMessage: recent.rawText || recent.text,
      recentUserMessageAt: recent.timestamp
    },
    conversation: buildConversationSnapshot({
      isDM,
      isBirdDM,
      dmAgent,
      dmConversationId,
      planet,
      planetConfig
    }),
    user: structuredCloneSafe(userProfile),
    texts: [...(texts || [])],
    tzOffset,
    ...(replyTo ? { replyTo: structuredCloneSafe(replyTo) } : {}),
    agents: agents.map(serializeChirpAgent),
    members: visibleMembers.map(serializeChirpMember),
    messages: currentMessages.slice(-12).map(serializeChirpMessage)
  }
}

function buildConversationSnapshot({ isDM, isBirdDM, dmAgent, dmConversationId, planet, planetConfig }) {
  if (!isDM) {
    return { id: planet.conversationId || planetConfig.conversationId, type: 'group' }
  }

  if (isBirdDM) {
    return { id: dmConversationId || null, type: 'bird_dm', title: dmAgent?.name }
  }

  return {
    id: dmConversationId || null,
    type: 'persona_dm',
    agentId: dmAgent?.id,
    personaId: dmAgent?.id,
    title: dmAgent?.name
  }
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

function snapshotValue(value) {
  if (value === undefined || value === null) return value
  return structuredCloneSafe(value)
}
