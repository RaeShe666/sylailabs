import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPerceptionPrompt, parsePerception } from '../lib/chirp/perceptionLayer.js'
import { takeLastTurns } from '../lib/chirp/personaRuntime.js'
import { buildGatePrompt } from '../lib/chirp/participation.js'

test('parsePerception extracts emotion fields and clamps intensity', () => {
  const p = parsePerception(`prose... {
    "emotion_summary": "sad but still holding it together",
    "valence": "neg",
    "intensity": 1.8,
    "vulnerability": "high",
    "intent": "venting",
    "hidden_insight": "third time avoiding the same topic",
    "addressed_to": "legacy-field"
  }`)
  assert.equal(p.emotion_summary, 'sad but still holding it together')
  assert.equal(p.valence, 'neg')
  assert.equal(p.intensity, 1)
  assert.equal(p.vulnerability, 'high')
  assert.equal(p.intent, 'venting')
  assert.equal(p.hidden_insight, 'third time avoiding the same topic')
  assert.equal(p.addressed_to, undefined)
})

test('perception prompt is emotion-only', () => {
  const { system } = buildPerceptionPrompt({ latestText: 'today feels heavy' })
  assert.match(system, /emotion_summary/)
  assert.match(system, /hidden_insight/)
  assert.ok(!system.includes('addressed_to'))
  assert.ok(!system.includes('continues_thread_of'))
  assert.ok(!system.includes('emotional_bid'))
})

test('parsePerception rejects garbage', () => {
  assert.equal(parsePerception('no json'), null)
  assert.equal(parsePerception(''), null)
})

test('takeLastTurns groups a burst as one turn and keeps the last N rounds', () => {
  const msgs = [
    { id: 'a1', type: 'memo', text: 'old self-talk' },
    { id: 'a2', type: 'agent', agentId: 'danzong', text: 'r1' },
    { id: 'b1', type: 'user', text: 'first line' },
    { id: 'b2', type: 'user', text: 'second line' },
    { id: 'b3', type: 'user', text: 'third line' },
    { id: 'b4', type: 'agent', agentId: 'danzong', text: 'r2' },
    { id: 'c1', type: 'memo', text: 'current line' }
  ]
  assert.deepEqual(takeLastTurns(msgs, 2).map(m => m.id), ['b1', 'b2', 'b3', 'b4', 'c1'])
  assert.deepEqual(takeLastTurns(msgs).map(m => m.id), ['a1', 'a2', 'b1', 'b2', 'b3', 'b4', 'c1'])
})

test('takeLastTurns returns everything when fewer turns exist, and caps runaway rounds', () => {
  const few = [
    { id: 'u', type: 'user', text: 'hi' },
    { id: 'a', type: 'agent', agentId: 'danzong', text: 'yo' }
  ]
  assert.deepEqual(takeLastTurns(few, 2).map(m => m.id), ['u', 'a'])

  const huge = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, type: 'user', text: `${i}` }))
  assert.equal(takeLastTurns(huge, 2, 24).length, 24)
})

test('second gate is pure self-judgment: no pile-on suppression, no injected prior emotion', () => {
  const { system, user } = buildGatePrompt({
    template: {
      id: 'danzong',
      runtime_card: { identity_summary: 'relaxed deconstructive friend' }
    },
    members: [{ id: 'danzong', name: 'Dan' }, { id: 'barry', name: 'Barry' }],
    latestText: 'are you sure I am being too cold?',
    recentMessages: [
      { type: 'agent', agentId: 'danzong', text: 'you are still asking at 3am' }
    ],
    targeting: { must_reply: 'none', trigger: 'open', target_personas: [] }
  })

  assert.match(system, /decide ONLY for THIS persona/)
  assert.match(system, /similar to another persona is completely fine/)
  assert.match(system, /never stay silent just because someone else/)
  assert.doesNotMatch(system, /Default to staying quiet|calm room|Do not pile on/i)
  assert.doesNotMatch(system, /Previous emotional read/i)
  assert.match(user, /Recent context before latest:\nPersona\(danzong\): you are still asking at 3am/)
  assert.match(user, /Current user turn:\nare you sure I am being too cold?/)
})
