import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeNotes, parseDistillation } from '../lib/chirp/distiller.js'

test('parseDistillation extracts notes', () => {
  const parsed = parseDistillation(`{
    "user_memory": [{"text": "User is anxious when J replies slowly", "confidence": 1.7}],
    "interaction_skill": [{"text": "Lead with a judgment before comfort", "confidence": -1}]
  }`)

  assert.equal(parsed.user_memory.length, 1)
  assert.equal(parsed.user_memory[0].confidence, 1)
  assert.equal(parsed.interaction_skill[0].confidence, 0)
})

test('parseDistillation tolerates prose around the JSON and rejects garbage', () => {
  assert.ok(parseDistillation('Here you go: {"user_memory":[],"interaction_skill":[]}'))
  assert.equal(parseDistillation('no json at all'), null)
  assert.equal(parseDistillation(''), null)
})

test('parseDistillation drops empty-text notes', () => {
  const parsed = parseDistillation('{"user_memory":[{"text":"  "},{"text":"real note"}],"interaction_skill":[]}')
  assert.equal(parsed.user_memory.length, 1)
  assert.equal(parsed.user_memory[0].text, 'real note')
})

test('mergeNotes appends deltas, dedupes by text, and caps the list', () => {
  const existing = [
    { text: 'old-a', confidence: 0.9 },
    { text: 'old-b', confidence: 0.8 }
  ]
  const deltas = [
    { text: 'old-a', confidence: 0.5 },
    { text: 'new-c', confidence: 0.7 }
  ]

  const merged = mergeNotes(existing, deltas, ['m1', 'm2'], 10)
  assert.equal(merged.length, 3)
  assert.equal(merged[2].text, 'new-c')
  assert.deepEqual(merged[2].source_message_ids, ['m1', 'm2'])
  assert.ok(merged[2].noted_at)

  const capped = mergeNotes(existing, [{ text: 'C' }, { text: 'D' }], [], 3)
  assert.equal(capped.length, 3)
  assert.equal(capped[0].text, 'old-b')
  assert.equal(capped[2].text, 'D')
})
