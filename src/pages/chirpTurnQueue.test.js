import assert from 'node:assert/strict'
import test from 'node:test'

import { takeNextReadyTurn } from './chirpTurnQueue.js'

test('takeNextReadyTurn skips queued turns for conversations already in flight', () => {
  const queue = [
    { conversationIdentity: 'group:old', texts: ['second old'] },
    { conversationIdentity: 'group:new', texts: ['first new'] }
  ]
  const inFlight = new Set(['group:old'])

  const next = takeNextReadyTurn(queue, inFlight)

  assert.deepEqual(next, { conversationIdentity: 'group:new', texts: ['first new'] })
  assert.deepEqual(queue, [{ conversationIdentity: 'group:old', texts: ['second old'] }])
})

test('takeNextReadyTurn returns null when every queued conversation is in flight', () => {
  const queue = [
    { conversationIdentity: 'group:old', texts: ['second old'] },
    { conversationIdentity: 'dm:duck', texts: ['second duck'] }
  ]
  const inFlight = new Set(['group:old', 'dm:duck'])

  assert.equal(takeNextReadyTurn(queue, inFlight), null)
  assert.deepEqual(queue, [
    { conversationIdentity: 'group:old', texts: ['second old'] },
    { conversationIdentity: 'dm:duck', texts: ['second duck'] }
  ])
})
