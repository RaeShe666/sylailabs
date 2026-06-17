import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearHistoryCache,
  getCachedMessages,
  getMessageCacheKey,
  setCachedMessages,
  updateCachedMessages
} from './chirpHistoryCache.js'

test('getMessageCacheKey prefers a message conversation id over the visible fallback key', () => {
  assert.equal(
    getMessageCacheKey({ conversationId: 'dm-2', planetId: 'planet-love' }, 'dm-1'),
    'dm-2'
  )
  assert.equal(
    getMessageCacheKey({ planetId: 'planet-love' }, 'visible-key'),
    'planet-love'
  )
  assert.equal(getMessageCacheKey({}, 'visible-key'), 'visible-key')
})

test('updateCachedMessages updates one conversation cache without touching another', () => {
  clearHistoryCache()
  setCachedMessages('conversation-a', [{ id: 'a1', text: 'old' }])
  setCachedMessages('conversation-b', [{ id: 'b1', text: 'keep' }])

  updateCachedMessages('conversation-a', messages => [...messages, { id: 'a2', text: 'new' }])

  assert.deepEqual(getCachedMessages('conversation-a').map(message => message.id), ['a1', 'a2'])
  assert.deepEqual(getCachedMessages('conversation-b').map(message => message.id), ['b1'])
})
