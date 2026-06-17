// persona_instance store (persona-v2 §2.2) + L0 interaction ledger (§2.3).
// An instance is the per user×template private relationship copy. "Using" a
// persona = ensuring an instance that references the template (托管引用, §6.2).

const INSTANCE_SELECT = [
  'id',
  'user_id',
  'template_id',
  'user_personal_patch',
  'user_memory',
  'interaction_skill'
].join(',')

export function mapInstanceRow(row = {}) {
  return {
    id: row.id,
    userId: row.user_id,
    templateId: row.template_id,
    user_personal_patch: row.user_personal_patch || {},
    user_memory: Array.isArray(row.user_memory) ? row.user_memory : [],
    interaction_skill: Array.isArray(row.interaction_skill) ? row.interaction_skill : []
  }
}

export async function ensureInstance({ supabase, userId, templateId }) {
  if (!supabase || !userId || !templateId) return null

  const { error: upsertError } = await supabase
    .from('chirp_persona_instances')
    .upsert(
      { user_id: userId, template_id: templateId },
      { onConflict: 'user_id,template_id', ignoreDuplicates: true }
    )

  if (upsertError) throw upsertError

  const { data, error } = await supabase
    .from('chirp_persona_instances')
    .select(INSTANCE_SELECT)
    .eq('user_id', userId)
    .eq('template_id', templateId)
    .single()

  if (error) throw error
  return mapInstanceRow(data)
}

// L0 ledger: one row per turn, no LLM. Failures must never block the reply.
export async function recordInteractionEvent({
  supabase,
  userId,
  planetId = null,
  conversationId = null,
  conversationType,
  speakerId,
  messageIds = []
}) {
  if (!supabase || !userId || !conversationType || !speakerId) return

  const { error } = await supabase
    .from('chirp_interaction_events')
    .insert({
      user_id: userId,
      planet_id: planetId,
      conversation_id: conversationId,
      conversation_type: conversationType,
      speaker_id: speakerId,
      message_ids: messageIds.filter(Boolean)
    })

  if (error) console.warn('Chirp interaction event write failed:', error.message || error)
}
