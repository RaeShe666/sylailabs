// couple 空间的数据层：定位/创建当前用户的 couple planet + 群会话。
// A（创建方）：首次进入时建 planet + group conversation + 成员行（自己 + bird）。
// B（受邀方）：redeem 后已是群成员，按成员关系找到共享空间，绝不自建。
// 幂等由 DB 约束兜底：couple planet 每 owner 唯一、group 会话每 planet 唯一（23505 → 重查）。
import { supabase } from '../../supabaseClient'

const COUPLE_SPACE_DEFAULT_NAME = 'our space'

const buildSpaceConfig = (planetRow, conversationRow) => ({
  id: 'couple',
  type: 'couple',
  dbId: planetRow.id,
  conversationId: conversationRow?.id || null,
  roomName: planetRow.name || COUPLE_SPACE_DEFAULT_NAME,
  groupName: conversationRow?.title || planetRow.name || COUPLE_SPACE_DEFAULT_NAME,
  tone: planetRow.tone || '',
  background: planetRow.background || '',
  avatarKey: 'couple',
  agents: []   // couple 空间没有 persona，只有 bird（见 getPersonasForPlanet 的 ?? 语义）
})

/** 受邀方/回访路径：按"我是哪些群会话的成员"反查 couple 空间。 */
async function findCoupleSpaceByMembership(user) {
  const { data: memberRows, error: memberError } = await supabase
    .from('chirp_conversation_members')
    .select('conversation_id')
    .eq('member_type', 'user')
    .eq('member_id', user.id)
  if (memberError) throw memberError
  const conversationIds = (memberRows || []).map(row => row.conversation_id)
  if (!conversationIds.length) return null

  const { data: conversations, error: conversationError } = await supabase
    .from('chirp_conversations')
    .select('*')
    .in('id', conversationIds)
    .eq('type', 'group')
  if (conversationError) throw conversationError
  const planetIds = (conversations || []).map(row => row.planet_id).filter(Boolean)
  if (!planetIds.length) return null

  const { data: planets, error: planetError } = await supabase
    .from('chirp_planets')
    .select('*')
    .in('id', planetIds)
    .eq('type', 'couple')
    .order('created_at', { ascending: true })
  if (planetError) throw planetError
  if (!planets?.length) return null

  const planet = planets[0]
  const conversation = conversations.find(row => row.planet_id === planet.id)
  return buildSpaceConfig(planet, conversation)
}

async function ensureCouplePlanet(user) {
  const findExisting = async () => {
    const { data, error } = await supabase
      .from('chirp_planets')
      .select('*')
      .eq('owner_id', user.id)
      .eq('type', 'couple')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data
  }

  const existing = await findExisting()
  if (existing) return existing

  const { data: created, error } = await supabase
    .from('chirp_planets')
    .insert({ owner_id: user.id, name: COUPLE_SPACE_DEFAULT_NAME, type: 'couple', avatar_key: 'couple' })
    .select()
    .single()
  if (error?.code === '23505') {
    const raced = await findExisting()
    if (raced) return raced
  }
  if (error) throw error
  return created
}

async function ensureCoupleConversation(user, planetId) {
  // group 会话唯一键是 planet 维度（不含 owner）：按 planet 查
  const findExisting = async () => {
    const { data, error } = await supabase
      .from('chirp_conversations')
      .select('*')
      .eq('planet_id', planetId)
      .eq('type', 'group')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data
  }

  const existing = await findExisting()
  if (existing) return existing

  const { data: created, error } = await supabase
    .from('chirp_conversations')
    .insert({ owner_id: user.id, planet_id: planetId, type: 'group', title: null })
    .select()
    .single()
  if (error?.code === '23505') {
    const raced = await findExisting()
    if (raced) return raced
  }
  if (error) throw error
  return created
}

async function ensureCoupleMembers(user, conversationId) {
  const { error } = await supabase
    .from('chirp_conversation_members')
    .upsert([
      { conversation_id: conversationId, member_type: 'user', member_id: user.id, agent_role: 'user', listen_mode: 'active', position: 0 },
      { conversation_id: conversationId, member_type: 'bird', member_id: 'bird', agent_role: 'bird', listen_mode: 'active', position: 1 }
    ], { onConflict: 'conversation_id,member_type,member_id' })
  if (error) throw error
}

/**
 * 定位或创建当前用户的 couple 空间。
 * @returns {Promise<object>} ChirpPage 可直接消费的 planetConfig
 */
export async function ensureCoupleSpace(user) {
  if (!user) throw new Error('ensureCoupleSpace requires a signed-in user')

  const shared = await findCoupleSpaceByMembership(user)
  if (shared) return shared

  const planet = await ensureCouplePlanet(user)
  const conversation = await ensureCoupleConversation(user, planet.id)
  await ensureCoupleMembers(user, conversation.id)
  return buildSpaceConfig(planet, conversation)
}
