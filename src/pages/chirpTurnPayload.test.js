import assert from 'node:assert/strict'
import test from 'node:test'

import { buildChirpTurnPayload } from './chirpTurnPayload.js'

test('buildChirpTurnPayload snapshots the conversation and members at send time', () => {
  const planet = { id: 'love', dbId: 'planet-1', conversationId: 'group-a', name: 'Love' }
  const agents = [{ id: 'danzong', name: '诞总', role: 'persona', systemPrompt: 'voice-a' }]
  const visibleMembers = [{ id: 'user', name: 'S', role: 'user' }, { id: 'danzong', name: '诞总', role: 'persona' }]

  const payload = buildChirpTurnPayload({
    texts: ['第一句'],
    currentMessages: [{ type: 'user', text: 'old' }],
    planet,
    planetConfig: { conversationId: 'group-config' },
    recent: { rawText: 'recent raw', timestamp: 123 },
    isDM: false,
    isBirdDM: false,
    dmAgent: null,
    dmConversationId: null,
    userProfile: { nickname: '' },
    agents,
    visibleMembers,
    tzOffset: 480
  })

  planet.conversationId = 'group-b'
  agents[0].id = 'barry'
  visibleMembers[1].id = 'barry'

  assert.equal(payload.conversation.id, 'group-a')
  assert.deepEqual(payload.agents.map(agent => agent.id), ['danzong'])
  assert.deepEqual(payload.members.map(member => member.id), ['user', 'danzong'])
  assert.equal(payload.planet.recentUserMessage, 'recent raw')
})

test('buildChirpTurnPayload snapshots persona DM routing', () => {
  const payload = buildChirpTurnPayload({
    texts: ['hi'],
    currentMessages: [],
    planet: { id: 'love', name: 'Love' },
    planetConfig: {},
    recent: {},
    isDM: true,
    isBirdDM: false,
    dmAgent: { id: 'duck', name: 'duck', role: 'persona' },
    dmConversationId: 'dm-duck',
    userProfile: { nickname: '' },
    agents: [{ id: 'duck', name: 'duck', role: 'persona' }],
    visibleMembers: [{ id: 'user', name: 'S', role: 'user' }, { id: 'duck', name: 'duck', role: 'persona' }],
    replyTo: { id: 'm1', agentRole: 'persona', agentId: 'duck' },
    tzOffset: 480
  })

  assert.deepEqual(payload.conversation, {
    id: 'dm-duck',
    type: 'persona_dm',
    agentId: 'duck',
    personaId: 'duck',
    title: 'duck'
  })
  assert.equal(payload.replyTo.id, 'm1')
  assert.deepEqual(payload.texts, ['hi'])
})

test('buildChirpTurnPayload snapshots bird DM routing', () => {
  const payload = buildChirpTurnPayload({
    texts: ['note this'],
    currentMessages: [],
    planet: { id: 'global' },
    planetConfig: {},
    isDM: true,
    isBirdDM: true,
    dmAgent: { id: 'bird', name: 'Bird', role: 'bird' },
    dmConversationId: 'dm-bird',
    userProfile: { nickname: '' },
    agents: [],
    visibleMembers: [{ id: 'user', name: 'S', role: 'user' }, { id: 'bird', name: 'Bird', role: 'bird' }],
    tzOffset: 480
  })

  assert.deepEqual(payload.conversation, {
    id: 'dm-bird',
    type: 'bird_dm',
    title: 'Bird'
  })
  assert.deepEqual(payload.members.map(member => member.id), ['user', 'bird'])
})

test('buildChirpTurnPayload snapshots replyTo deeply', () => {
  const replyTo = {
    id: 'm1',
    agentRole: 'persona',
    agentId: 'danzong',
    snapshot: { author: 'Danzong', text: 'Wait one beat.' }
  }

  const payload = buildChirpTurnPayload({
    texts: ['ok'],
    currentMessages: [],
    planet: { id: 'love' },
    planetConfig: {},
    agents: [],
    visibleMembers: [],
    replyTo,
    tzOffset: 480
  })

  replyTo.snapshot.text = 'changed'

  assert.deepEqual(payload.replyTo.snapshot, { author: 'Danzong', text: 'Wait one beat.' })
})

test('buildChirpTurnPayload snapshots nested persona prompt blocks', () => {
  const agent = {
    id: 'danzong',
    name: 'Danzong',
    role: 'persona',
    identity: { archetype: 'anti-soup' },
    voice_style: { banned: ['lecture'] },
    examples: [{ user: 'Should I text?', assistant: 'Wait one beat.' }]
  }

  const payload = buildChirpTurnPayload({
    texts: ['hi'],
    currentMessages: [],
    planet: { id: 'love' },
    planetConfig: {},
    agents: [agent],
    visibleMembers: [],
    tzOffset: 480
  })

  agent.identity.archetype = 'changed'
  agent.voice_style.banned.push('joke')
  agent.examples[0].assistant = 'changed'

  assert.deepEqual(payload.agents[0].identity, { archetype: 'anti-soup' })
  assert.deepEqual(payload.agents[0].voice_style, { banned: ['lecture'] })
  assert.deepEqual(payload.agents[0].examples, [{ user: 'Should I text?', assistant: 'Wait one beat.' }])
})
