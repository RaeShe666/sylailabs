import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePerception } from '../lib/chirp/perceptionLayer.js'
import { takeLastTurns } from '../lib/chirp/personaRuntime.js'
import { structuralObligation } from '../lib/chirp/participation.js'

test('parsePerception extracts fields, clamps, and normalizes refs', () => {
  const p = parsePerception(`prose... {
    "emotion_summary": "失落但强撑",
    "valence": "neg", "intensity": 1.8, "vulnerability": "high",
    "intent": "venting", "hidden_insight": "第三次回避",
    "addressed_to": "danzong", "is_question": true,
    "continues_thread_of": "DANZONG", "emotional_bid": true
  }`)
  assert.equal(p.emotion_summary, '失落但强撑')
  assert.equal(p.valence, 'neg')
  assert.equal(p.intensity, 1)              // clamped to 1
  assert.equal(p.addressed_to, 'danzong')
  assert.equal(p.continues_thread_of, 'DANZONG')   // preserved (case kept)
  assert.equal(p.is_question, true)
})

test('parsePerception normalizes null-ish refs and rejects garbage', () => {
  const p = parsePerception('{"emotion_summary":"x","addressed_to":"null","continues_thread_of":"none"}')
  assert.equal(p.addressed_to, null)
  assert.equal(p.continues_thread_of, null)
  assert.equal(parsePerception('no json'), null)
})

test('takeLastTurns groups a burst as one turn and keeps the last N rounds', () => {
  const msgs = [
    { id: 'a1', type: 'memo', text: 'old self-talk' },          // turn 1 (user)
    { id: 'a2', type: 'agent', agentId: 'danzong', text: 'r1' },
    { id: 'b1', type: 'user', text: '问题第一句' },              // turn 2 (burst)
    { id: 'b2', type: 'user', text: '第二句' },
    { id: 'b3', type: 'user', text: '第三句' },
    { id: 'b4', type: 'agent', agentId: 'danzong', text: 'r2' },
    { id: 'c1', type: 'memo', text: '此刻这句' }                 // turn 3 (current)
  ]
  // Last 2 turns = turn 2 (the whole burst + its reply) + turn 3.
  const got = takeLastTurns(msgs, 2).map(m => m.id)
  assert.deepEqual(got, ['b1', 'b2', 'b3', 'b4', 'c1'])

  // Default depth = current turn + previous 2 full exchanges (CONTEXT_TURNS=3).
  const all = takeLastTurns(msgs).map(m => m.id)
  assert.deepEqual(all, ['a1', 'a2', 'b1', 'b2', 'b3', 'b4', 'c1'])
})

test('takeLastTurns returns everything when fewer turns exist, and caps runaway rounds', () => {
  const few = [
    { id: 'u', type: 'user', text: 'hi' },
    { id: 'a', type: 'agent', agentId: 'danzong', text: 'yo' }
  ]
  assert.deepEqual(takeLastTurns(few, 2).map(m => m.id), ['u', 'a'])

  // One giant turn (single burst of 30) is capped by hardCap.
  const huge = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, type: 'user', text: `${i}` }))
  assert.equal(takeLastTurns(huge, 2, 24).length, 24)
})

test('structuralObligation fires on thread continuation and address, case-insensitive', () => {
  assert.equal(structuralObligation({ continues_thread_of: 'danzong' }, 'danzong'), 'continuation')
  assert.equal(structuralObligation({ addressed_to: 'Duck' }, 'duck'), 'addressed')
  // not me → null (goes to the model-judged gate)
  assert.equal(structuralObligation({ continues_thread_of: 'danzong', addressed_to: 'danzong' }, 'duck'), null)
  assert.equal(structuralObligation({ continues_thread_of: null, addressed_to: null }, 'danzong'), null)
  assert.equal(structuralObligation(null, 'danzong'), null)
})
