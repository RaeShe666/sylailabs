import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSpeakerPlans } from '../lib/chirp/turnPlanner.js'

const agents = [
  { id: 'danzong', name: '诞总' },
  { id: 'barry', name: 'Barry' },
  { id: 'duck', name: 'duck' }
]

test('DM targets are hard replies and never gated', () => {
  const plans = buildSpeakerPlans({
    isDM: true,
    activation: {
      triggerType: 'persona_dm',
      targets: [{ agentRole: 'persona', agentId: 'danzong' }]
    },
    agents
  })

  assert.deepEqual(plans, [
    {
      target: { agentRole: 'persona', agentId: 'danzong' },
      mode: 'mentioned',
      gate: false
    }
  ])
})

test('@ mentions only hard-target mentioned personas and do not gate companions', () => {
  const plans = buildSpeakerPlans({
    isDM: false,
    activation: {
      triggerType: 'mention_persona',
      targets: [{ agentRole: 'persona', agentId: 'barry' }]
    },
    agents
  })

  assert.deepEqual(plans, [
    {
      target: { agentRole: 'persona', agentId: 'barry' },
      mode: 'mentioned',
      gate: false
    }
  ])
})

test('replying to a persona makes that persona hard and gates the other personas', () => {
  const plans = buildSpeakerPlans({
    isDM: false,
    activation: {
      triggerType: 'reply_persona',
      targets: [{ agentRole: 'persona', agentId: 'duck' }]
    },
    agents
  })

  assert.deepEqual(plans, [
    {
      target: { agentRole: 'persona', agentId: 'duck' },
      mode: 'mentioned',
      gate: false
    },
    {
      target: { agentRole: 'persona', agentId: 'danzong' },
      mode: 'ambient',
      gate: true
    },
    {
      target: { agentRole: 'persona', agentId: 'barry' },
      mode: 'ambient',
      gate: true
    }
  ])
})

test('ambient with no targeting (or must_reply none) gates every persona', () => {
  const noTargeting = buildSpeakerPlans({
    isDM: false,
    activation: { triggerType: 'ambient', targets: [] },
    agents
  })
  const noneReply = buildSpeakerPlans({
    isDM: false,
    activation: { triggerType: 'ambient', targets: [] },
    agents,
    targeting: { must_reply: 'none', target_personas: [] }
  })
  const allGated = agents.map(agent => ({
    target: { agentRole: 'persona', agentId: agent.id },
    mode: 'ambient',
    gate: true
  }))
  assert.deepEqual(noTargeting, allGated)
  assert.deepEqual(noneReply, allGated)
})

test('ambient first gate must_reply=all → everyone replies directly (no second gate)', () => {
  const plans = buildSpeakerPlans({
    isDM: false,
    activation: { triggerType: 'ambient', targets: [] },
    agents,
    targeting: { must_reply: 'all', trigger: 'low_emotion', target_personas: [] }
  })
  assert.deepEqual(plans, agents.map(agent => ({
    target: { agentRole: 'persona', agentId: agent.id },
    mode: 'mentioned',
    gate: false
  })))
})

test('ambient first gate must_reply=specific → named personas direct, rest self-gate', () => {
  const plans = buildSpeakerPlans({
    isDM: false,
    activation: { triggerType: 'ambient', targets: [] },
    agents,
    targeting: { must_reply: 'specific', trigger: 'addressed', target_personas: ['danzong'] }
  })
  assert.deepEqual(plans, [
    { target: { agentRole: 'persona', agentId: 'danzong' }, mode: 'mentioned', gate: false },
    { target: { agentRole: 'persona', agentId: 'barry' }, mode: 'ambient', gate: true },
    { target: { agentRole: 'persona', agentId: 'duck' }, mode: 'ambient', gate: true }
  ])
})
