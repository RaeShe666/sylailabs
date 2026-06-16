import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeNotes, parseDistillation } from '../lib/chirp/distiller.js'

test('parseDistillation extracts notes and clamps confidence', () => {
  const parsed = parseDistillation(`{
    "user_memory": [{"text": "用户和 J 处于暧昧期，J 回消息变慢会让她反复检查手机。", "confidence": 1.7}],
    "interaction_skill": [{"text": "她不吃安慰，先给判断再给温度更有效。", "confidence": -1}],
    "affective_context": {"summary": "今晚因为 J 只回了嗯嗯而焦虑", "sensitivity": "medium", "confidence": 0.8, "ttl_hours": 24}
  }`)

  assert.equal(parsed.user_memory.length, 1)
  assert.equal(parsed.user_memory[0].confidence, 1)
  assert.equal(parsed.interaction_skill[0].confidence, 0)
  assert.equal(parsed.affective_context.sensitivity, 'medium')
})

test('parseDistillation tolerates prose around the JSON and rejects garbage', () => {
  assert.ok(parseDistillation('Here you go: {"user_memory":[],"interaction_skill":[],"affective_context":null}'))
  assert.equal(parseDistillation('no json at all'), null)
  assert.equal(parseDistillation(''), null)
})

test('parseDistillation drops empty-text notes', () => {
  const parsed = parseDistillation('{"user_memory":[{"text":"  "},{"text":"真实条目"}],"interaction_skill":[],"affective_context":null}')
  assert.equal(parsed.user_memory.length, 1)
  assert.equal(parsed.user_memory[0].text, '真实条目')
})

test('mergeNotes appends deltas, dedupes by text, and caps the list', () => {
  const existing = [
    { text: '旧条目A', confidence: 0.9 },
    { text: '旧条目B', confidence: 0.8 }
  ]
  const deltas = [
    { text: '旧条目A', confidence: 0.5 },
    { text: '新条目C', confidence: 0.7 }
  ]

  const merged = mergeNotes(existing, deltas, ['m1', 'm2'], 10)
  assert.equal(merged.length, 3)
  assert.equal(merged[2].text, '新条目C')
  assert.deepEqual(merged[2].source_message_ids, ['m1', 'm2'])
  assert.ok(merged[2].noted_at)

  const capped = mergeNotes(existing, [{ text: 'C' }, { text: 'D' }], [], 3)
  assert.equal(capped.length, 3)
  assert.equal(capped[0].text, '旧条目B')
  assert.equal(capped[2].text, 'D')
})
