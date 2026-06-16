// Live emotion state store (persona-v2 §5.3). One row per (user, conversation);
// the perception layer reads the prior state and writes the refreshed one each
// turn. Best-effort: failures never block the reply path.

export async function readEmotionState({ supabase, userId, conversationId }) {
  if (!supabase || !userId || !conversationId) return null
  try {
    const { data, error } = await supabase
      .from('chirp_emotion_state')
      .select('state, updated_at')
      .eq('user_id', userId)
      .eq('conversation_id', conversationId)
      .maybeSingle()
    if (error) throw error
    return data?.state || null
  } catch (error) {
    console.warn('Chirp emotion state read failed:', error.message || error)
    return null
  }
}

// Like readEmotionState but also returns when it was captured (updated_at), so
// the reply can tell the model the absolute time of this (previous-turn) read.
export async function readEmotionStateRow({ supabase, userId, conversationId }) {
  if (!supabase || !userId || !conversationId) return null
  try {
    const { data, error } = await supabase
      .from('chirp_emotion_state')
      .select('state, updated_at')
      .eq('user_id', userId)
      .eq('conversation_id', conversationId)
      .maybeSingle()
    if (error) throw error
    return data?.state ? { state: data.state, updatedAt: data.updated_at } : null
  } catch (error) {
    console.warn('Chirp emotion state row read failed:', error.message || error)
    return null
  }
}

export async function writeEmotionState({ supabase, userId, conversationId, state }) {
  if (!supabase || !userId || !conversationId || !state) return
  try {
    const { error } = await supabase
      .from('chirp_emotion_state')
      .upsert(
        { user_id: userId, conversation_id: conversationId, state, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,conversation_id' }
      )
    if (error) throw error
  } catch (error) {
    console.warn('Chirp emotion state write failed:', error.message || error)
  }
}

// Append one perception slice to the trajectory log (history for emotion-memory
// analysis). chirp_emotion_state holds only the latest; this keeps every turn.
export async function appendEmotionLog({ supabase, userId, conversationId, state }) {
  if (!supabase || !userId || !conversationId || !state) return
  try {
    const { error } = await supabase
      .from('chirp_emotion_log')
      .insert({ user_id: userId, conversation_id: conversationId, state })
    if (error) throw error
  } catch (error) {
    console.warn('Chirp emotion log append failed:', error.message || error)
  }
}
