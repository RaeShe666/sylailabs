import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTargetingPrompt, parseTurnTargeting } from '../lib/chirp/turnTargeting.js'

test('targeting prompt asks for must_reply and reads recent context, no emotion fields', () => {
  const { system, user } = buildTargetingPrompt({
    members: [
      { id: 'danzong', name: 'Dan' },
      { id: 'barry', name: 'Barry' }
    ],
    recentMessages: [
      { type: 'agent', agentId: 'danzong', text: '按你现在的速度，凌晨三点还在问这个。' }
    ],
    latestText: '你确定我现在是凌晨3点？'
  })

  assert.match(system, /must_reply/)
  assert.match(system, /specific/)
  assert.match(system, /target_personas/)
  assert.ok(!system.includes('emotion_summary'))
  assert.ok(!system.includes('hidden_insight'))
  assert.match(user, /Persona\(danzong\): 按你现在的速度/)
  assert.match(user, /Latest user turn:\n你确定我现在是凌晨3点？/)
})

test('parseTurnTargeting: specific keeps target_personas, normalizes', () => {
  const parsed = parseTurnTargeting(`{
    "must_reply": "specific",
    "trigger": "addressed",
    "target_personas": ["danzong", "Barry", ""],
    "why": "用户在质疑诞总上一句"
  }`)
  assert.deepEqual(parsed, {
    must_reply: 'specific',
    trigger: 'addressed',
    target_personas: ['danzong', 'Barry'],
    why: '用户在质疑诞总上一句'
  })
})

test('parseTurnTargeting: all/none drop target_personas; garbage rejected', () => {
  const all = parseTurnTargeting('{"must_reply":"all","trigger":"low_emotion","target_personas":["danzong"]}')
  assert.equal(all.must_reply, 'all')
  assert.equal(all.trigger, 'low_emotion')
  assert.deepEqual(all.target_personas, [])

  const none = parseTurnTargeting('{"must_reply":"none"}')
  assert.equal(none.must_reply, 'none')
  assert.deepEqual(none.target_personas, [])

  assert.equal(parseTurnTargeting('{"must_reply":"weird"}').must_reply, 'none')
  assert.equal(parseTurnTargeting('no json'), null)
})
