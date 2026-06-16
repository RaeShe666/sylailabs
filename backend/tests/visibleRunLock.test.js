import test from 'node:test'
import assert from 'node:assert/strict'
import { acquireVisibleRunLock, createVisibleRunLockConflict, releaseVisibleRunLock } from '../lib/chirp/visibleRunLock.js'

test('acquireVisibleRunLock returns a lock token when rpc succeeds', async () => {
  const supabase = {
    rpc: async (name, payload) => {
      assert.equal(name, 'acquire_chirp_visible_run_lock')
      assert.equal(payload.p_owner_id, 'user-1')
      assert.equal(payload.p_conversation_id, 'conversation-1')
      assert.equal(payload.p_ttl_seconds, 120)
      assert.ok(payload.p_lock_token)
      return { data: true, error: null }
    }
  }

  const lock = await acquireVisibleRunLock({
    supabase,
    ownerId: 'user-1',
    conversationId: 'conversation-1'
  })

  assert.equal(lock.conversationId, 'conversation-1')
  assert.ok(lock.lockToken)
})

test('acquireVisibleRunLock throws 409 conflict when conversation is busy', async () => {
  const supabase = {
    rpc: async () => ({ data: false, error: null })
  }

  await assert.rejects(
    acquireVisibleRunLock({
      supabase,
      ownerId: 'user-1',
      conversationId: 'conversation-1'
    }),
    error => error.status === 409 && error.code === 'visible_run_in_flight'
  )
})

test('releaseVisibleRunLock deletes only the matching token', async () => {
  const calls = []
  const supabase = {
    from: (table) => {
      calls.push(['from', table])
      return {
        delete: () => {
          calls.push(['delete'])
          return {
            eq: (key, value) => {
              calls.push(['eq', key, value])
              return calls.filter(call => call[0] === 'eq').length === 2
                ? { error: null }
                : {
                    eq: (nextKey, nextValue) => {
                      calls.push(['eq', nextKey, nextValue])
                      return { error: null }
                    }
                  }
            }
          }
        }
      }
    }
  }

  await releaseVisibleRunLock({
    supabase,
    lock: { conversationId: 'conversation-1', lockToken: 'token-1' }
  })

  assert.deepEqual(calls, [
    ['from', 'chirp_visible_run_locks'],
    ['delete'],
    ['eq', 'conversation_id', 'conversation-1'],
    ['eq', 'lock_token', 'token-1']
  ])
})

test('createVisibleRunLockConflict carries API status and stable code', () => {
  const error = createVisibleRunLockConflict('conversation-1')
  assert.equal(error.status, 409)
  assert.equal(error.code, 'visible_run_in_flight')
  assert.equal(error.conversationId, 'conversation-1')
})
