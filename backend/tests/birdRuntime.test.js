import test from 'node:test'
import assert from 'node:assert/strict'
import { runBird } from '../lib/chirp/birdRuntime.js'

// couple group v0: same Bird persona/engine, plus one scene-level line in the
// volatile run-context block; the read-broadly run line is dropped there.
test('runBird in a couple group swaps the read-broadly run line for the couple scene note', async () => {
  let capturedSystem = null
  const reply = await runBird({
    planet: { name: 'us' },
    user: { nickname: 'Rae' },
    members: [{ name: 'Rae', role: 'user' }, { name: 'Partner', role: 'user' }],
    messages: [{ id: 'm1', type: 'user', text: 'we argued about dishes again' }],
    currentUserText: 'we argued about dishes again',
    currentMessageIds: ['m1'],
    memoryScope: { type: 'couple_group_bird', allowed_conversation_ids: ['couple-group-1'] },
    recallTool: async () => ({ summary: 'NONE' }),
    turn: async ({ system }) => {
      capturedSystem = system
      return { text: 'maybe dishes are not the real topic.', toolCalls: [], stopReason: 'end_turn' }
    }
  })

  assert.equal(reply.text, 'maybe dishes are not the real topic.')
  // stable persona block untouched (still cacheable, same bytes as any run)
  assert.equal(capturedSystem[0].cache, true)
  // run-context block: scene note in, read-broadly run line out
  const runContext = capturedSystem[1].text
  assert.match(runContext, /couple's shared space/)
  assert.match(runContext, /limited to this conversation only/)
  assert.match(runContext, /Memory scope type: couple_group_bird/)
  assert.doesNotMatch(runContext, /Bird may read broadly/)
})

test('runBird outside a couple group keeps the read-broadly run line and no couple scene', async () => {
  let capturedSystem = null
  await runBird({
    planet: { name: 'Love' },
    user: { nickname: 'Rae' },
    members: [{ name: 'Bird', role: 'bird' }],
    messages: [{ id: 'm1', type: 'user', text: '@bird what pattern do you see?' }],
    currentUserText: '@bird what pattern do you see?',
    currentMessageIds: ['m1'],
    memoryScope: { type: 'global_bird' },
    recallTool: async () => ({ summary: 'NONE' }),
    turn: async ({ system }) => {
      capturedSystem = system
      return { text: 'maybe a small one.', toolCalls: [], stopReason: 'end_turn' }
    }
  })

  const runContext = capturedSystem[1].text
  assert.match(runContext, /Bird may read broadly/)
  assert.doesNotMatch(runContext, /couple's shared space/)
})
