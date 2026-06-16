const DEFAULT_RECENT_LIMIT = 20

export function buildMemoryScope({ conversationId, planetId, target, conversationType = 'group' }) {
  const isBird = target.agentRole === 'bird'

  return {
    type: isBird ? 'global_bird' : 'persona_membership_planet',
    conversation_id: conversationId || null,
    conversation_type: conversationType,
    planet_id: isBird && conversationType === 'bird_dm' ? null : (planetId || null),
    agent_id: target.agentId,
    agent_role: target.agentRole,
    includes_user_profile: true,
    includes_planet_insights: !isBird,
    raw_bird_dm_visible: isBird,
    raw_persona_dm_visible: true
  }
}

export function canReadConversation(scope = {}, conversation = {}) {
  if (!conversation?.id && !conversation?.type) return false
  if (scope.agent_role === 'bird') return true
  if (conversation.type === 'bird_dm') return false
  if (scope.planet_id && conversation.planet_id && conversation.planet_id !== scope.planet_id) return false
  return true
}

export function canReadMessage(scope = {}, message = {}) {
  if (scope.agent_role === 'bird') return true
  if (message.conversation_type === 'bird_dm') return false
  if (scope.allowed_conversation_ids?.length) {
    return scope.allowed_conversation_ids.includes(message.conversation_id)
  }
  return !scope.conversation_id || message.conversation_id === scope.conversation_id
}

export async function resolveMemoryScope({ supabase, ownerId, scope }) {
  if (!supabase || !ownerId || !scope) return scope

  const conversations = await loadAllowedConversations({ supabase, ownerId, scope })
  return {
    ...scope,
    allowed_conversation_ids: conversations.map(conversation => conversation.id),
    allowed_conversations: conversations.map(conversation => ({
      id: conversation.id,
      type: conversation.type,
      planet_id: conversation.planet_id
    }))
  }
}

export async function readRecentMessagesForScope({ supabase, ownerId, scope, limit = DEFAULT_RECENT_LIMIT }) {
  const resolvedScope = scope.allowed_conversation_ids
    ? scope
    : await resolveMemoryScope({ supabase, ownerId, scope })

  if (!resolvedScope.allowed_conversation_ids?.length) return []

  const { data, error } = await supabase
    .from('chirp_messages')
    .select('id,planet_id,conversation_id,run_id,sender_type,sender_id,sender_role,is_personal_record,text,tapbacks,created_at')
    .in('conversation_id', resolvedScope.allowed_conversation_ids)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const conversationTypes = new Map(
    (resolvedScope.allowed_conversations || []).map(conversation => [conversation.id, conversation.type])
  )

  return (data || [])
    .map(row => ({
      ...row,
      conversation_type: conversationTypes.get(row.conversation_id)
    }))
    .filter(row => canReadMessage(resolvedScope, row))
    .reverse()
}

async function loadAllowedConversations({ supabase, ownerId, scope }) {
  if (scope.agent_role === 'bird') {
    const { data, error } = await supabase
      .from('chirp_conversations')
      .select('id,type,planet_id')
      .eq('owner_id', ownerId)

    if (error) throw error
    return data || []
  }

  const { data: memberships, error: membershipError } = await supabase
    .from('chirp_conversation_members')
    .select('conversation_id')
    .eq('member_type', 'persona')
    .eq('member_id', scope.agent_id)

  if (membershipError) throw membershipError
  const ids = [...new Set((memberships || []).map(row => row.conversation_id).filter(Boolean))]
  if (!ids.length) return []

  const { data, error } = await supabase
    .from('chirp_conversations')
    .select('id,type,planet_id')
    .eq('owner_id', ownerId)
    .in('id', ids)

  if (error) throw error

  return (data || []).filter(conversation => canReadConversation(scope, conversation))
}
