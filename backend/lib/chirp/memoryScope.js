const DEFAULT_RECENT_LIMIT = 20

export function buildMemoryScope({ conversationId, planetId, target, conversationType = 'group', planetType = null }) {
  const isBird = target.agentRole === 'bird'
  // Bird inside a COUPLE group is scoped to that single conversation. A couple
  // space holds TWO humans, so bird's usual owner-wide omniscience (which
  // reaches into DMs) must never apply there — neither partner's Bird DM or
  // persona DMs may leak into the shared space.
  const isCoupleGroupBird = isBird && planetType === 'couple'

  return {
    type: isCoupleGroupBird ? 'couple_group_bird' : (isBird ? 'global_bird' : 'persona_membership_planet'),
    conversation_id: conversationId || null,
    conversation_type: conversationType,
    planet_id: isBird && conversationType === 'bird_dm' ? null : (planetId || null),
    agent_id: target.agentId,
    agent_role: target.agentRole,
    includes_user_profile: !isCoupleGroupBird,
    includes_planet_insights: !isBird,
    raw_bird_dm_visible: isBird && !isCoupleGroupBird,
    raw_persona_dm_visible: !isCoupleGroupBird
  }
}

export function canReadConversation(scope = {}, conversation = {}) {
  if (!conversation?.id && !conversation?.type) return false
  // couple-group bird: visibility is EXACTLY the group conversation itself —
  // this check must run BEFORE the bird all-pass below.
  if (scope.type === 'couple_group_bird') {
    return Boolean(conversation.id) && conversation.id === scope.conversation_id
  }
  if (scope.agent_role === 'bird') return true
  if (conversation.type === 'bird_dm') return false
  if (scope.planet_id && conversation.planet_id && conversation.planet_id !== scope.planet_id) return false
  return true
}

export function canReadMessage(scope = {}, message = {}) {
  // couple-group bird: only messages of that conversation, never any DM —
  // this check must run BEFORE the bird all-pass below.
  if (scope.type === 'couple_group_bird') {
    return Boolean(message.conversation_id) && message.conversation_id === scope.conversation_id
  }
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
  // couple-group bird: the allowed set is exactly [the group conversation].
  // Looked up by id, NOT by owner_id — partner B is a member, not the owner,
  // and scope.conversation_id was already membership-authorized upstream
  // (loadConversationForUser). This branch must run BEFORE the bird owner-wide
  // read below, which would otherwise pull in every conversation (incl. DMs).
  if (scope.type === 'couple_group_bird') {
    if (!scope.conversation_id) return []
    const { data, error } = await supabase
      .from('chirp_conversations')
      .select('id,type,planet_id')
      .eq('id', scope.conversation_id)

    if (error) throw error
    return (data || []).filter(conversation => canReadConversation(scope, conversation))
  }

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
