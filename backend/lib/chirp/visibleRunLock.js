import crypto from 'node:crypto'

const DEFAULT_VISIBLE_RUN_LOCK_TTL_SECONDS = 120

export function createVisibleRunLockConflict(conversationId) {
  const error = new Error('visible_run_in_flight')
  error.status = 409
  error.code = 'visible_run_in_flight'
  error.conversationId = conversationId
  return error
}

export async function acquireVisibleRunLock({
  supabase,
  ownerId,
  conversationId,
  ttlSeconds = DEFAULT_VISIBLE_RUN_LOCK_TTL_SECONDS
}) {
  if (!supabase || !ownerId || !conversationId) return null

  const lockToken = crypto.randomUUID()
  const { data, error } = await supabase.rpc('acquire_chirp_visible_run_lock', {
    p_owner_id: ownerId,
    p_conversation_id: conversationId,
    p_lock_token: lockToken,
    p_ttl_seconds: ttlSeconds
  })

  if (error) throw error
  if (!data) throw createVisibleRunLockConflict(conversationId)

  return {
    conversationId,
    lockToken
  }
}

export async function releaseVisibleRunLock({ supabase, lock }) {
  if (!supabase || !lock?.conversationId || !lock?.lockToken) return

  const { error } = await supabase
    .from('chirp_visible_run_locks')
    .delete()
    .eq('conversation_id', lock.conversationId)
    .eq('lock_token', lock.lockToken)

  if (error) {
    console.warn('Failed to release Chirp visible run lock:', error)
  }
}
