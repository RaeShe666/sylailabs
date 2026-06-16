import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMention, routeActivation } from '../lib/chirp/activationRouter.js'

const agents = [
  { id: 'danzong', name: '诞总' },
  { id: 'barry', name: 'Barry' },
  { id: 'duck', name: 'duck' }
]

test('parseMention detects persona, all, and bird mentions', () => {
  assert.deepEqual(parseMention('@诞总 你看', agents), { type: 'persona', agentIds: ['danzong'] })
  assert.deepEqual(parseMention('@all 都说说', agents), { type: 'all' })
  assert.deepEqual(parseMention('@Bird 在吗', agents), { type: 'bird', agentId: 'bird' })
  assert.deepEqual(parseMention('今天有点烦', agents), { type: 'none' })
})

test('parseMention detects mentions in the middle of a message', () => {
  assert.deepEqual(parseMention('他又这样了@诞总 你怎么看', agents), { type: 'persona', agentIds: ['danzong'] })
  assert.deepEqual(parseMention('说了一堆@bird 帮我总结下', agents), { type: 'bird', agentId: 'bird' })
  assert.deepEqual(parseMention('邮箱是 a@ball.com 不是提及', agents), { type: 'none' })
})

test('mentioning multiple personas fans out to all of them in appearance order', () => {
  assert.deepEqual(
    parseMention('先@duck 再@Barry', agents),
    { type: 'persona', agentIds: ['duck', 'barry'] }
  )

  const route = routeActivation({
    conversation: { type: 'group' },
    message: { text: '@诞总 @duck 你们俩怎么看' },
    agents
  })

  assert.equal(route.triggerType, 'mention_personas')
  assert.equal(route.isPersonalRecord, false)
  assert.deepEqual(route.targets, [
    { agentRole: 'persona', agentId: 'danzong' },
    { agentRole: 'persona', agentId: 'duck' }
  ])
})

test('group message without mention stays a personal record but wakes ambient candidates', () => {
  const route = routeActivation({
    conversation: { type: 'group' },
    message: { text: '今天有点烦' },
    agents
  })

  assert.equal(route.triggerType, 'ambient')
  assert.equal(route.isPersonalRecord, true)
  assert.equal(route.targets.length, 2)
  assert.equal(route.targets[0].agentId, 'danzong')
  assert.ok(['barry', 'duck'].includes(route.targets[1].agentId))
})

test('ambient candidates are capped at two with 诞总 as fixed primary', () => {
  const route = routeActivation({
    conversation: { type: 'group' },
    message: { text: '随便说说' },
    agents
  })
  assert.ok(route.targets.length <= 2)
  assert.equal(route.targets[0].agentId, 'danzong')
})

test('@persona triggers only that persona', () => {
  const route = routeActivation({
    conversation: { type: 'group' },
    message: { text: '@Barry 我是不是想多了' },
    agents
  })

  assert.equal(route.triggerType, 'mention_persona')
  assert.equal(route.isPersonalRecord, false)
  assert.deepEqual(route.targets, [{ agentRole: 'persona', agentId: 'barry' }])
})

test('@all triggers all personas in stable member order and excludes bird', () => {
  const route = routeActivation({
    conversation: { type: 'group' },
    message: { text: '@all 都说说' },
    agents
  })

  assert.equal(route.triggerType, 'mention_all')
  assert.equal(route.isPersonalRecord, false)
  assert.deepEqual(route.targets, [
    { agentRole: 'persona', agentId: 'danzong' },
    { agentRole: 'persona', agentId: 'barry' },
    { agentRole: 'persona', agentId: 'duck' }
  ])
})

test('@bird in a group no longer summons bird (bird is DM-only)', () => {
  const route = routeActivation({
    conversation: { type: 'group' },
    message: { text: '@bird 你怎么看' },
    agents
  })
  // falls through to ambient; bird never participates in a group
  assert.equal(route.triggerType, 'ambient')
  assert.ok(!route.targets.some(target => target.agentRole === 'bird'))
})

test('replying to a persona routes to it; replying to bird in a group does not summon bird', () => {
  assert.deepEqual(
    routeActivation({
      conversation: { type: 'group' },
      message: { text: '那我怎么办' },
      agents,
      replyTo: { agentRole: 'persona', agentId: 'duck' }
    }),
    {
      triggerType: 'reply_persona',
      isPersonalRecord: false,
      targets: [{ agentRole: 'persona', agentId: 'duck' }]
    }
  )

  const birdReply = routeActivation({
    conversation: { type: 'group' },
    message: { text: '继续说' },
    agents,
    replyTo: { agentRole: 'bird', agentId: 'bird' }
  })
  assert.equal(birdReply.triggerType, 'ambient')
  assert.ok(!birdReply.targets.some(target => target.agentRole === 'bird'))
})

test('quoting a persona composes with @ — both reply, no conflict', () => {
  // Quote 诞总's bubble AND @duck in the text → both are targets.
  const route = routeActivation({
    conversation: { type: 'group' },
    message: { text: '@duck 你看' },
    agents,
    replyTo: { agentRole: 'persona', agentId: 'danzong' }
  })
  assert.equal(route.isPersonalRecord, false)
  const ids = route.targets.map(t => t.agentId).sort()
  assert.deepEqual(ids, ['danzong', 'duck'])
})

test('quoting a persona with no @ makes only that persona reply', () => {
  const route = routeActivation({
    conversation: { type: 'group' },
    message: { text: '那我怎么办' },
    agents,
    replyTo: { agentRole: 'persona', agentId: 'duck' }
  })
  assert.equal(route.triggerType, 'reply_persona')
  assert.deepEqual(route.targets, [{ agentRole: 'persona', agentId: 'duck' }])
})

test('quoting your OWN bubble forces no target — routing follows the text', () => {
  // No @, quoting a user bubble → ambient (not forced to anyone).
  const ambient = routeActivation({
    conversation: { type: 'group' },
    message: { text: '这个怎么说' },
    agents,
    replyTo: { agentRole: 'user', id: 'm123' }
  })
  assert.equal(ambient.triggerType, 'ambient')
  assert.equal(ambient.isPersonalRecord, true)

  // @someone while quoting own bubble → that someone replies.
  const mentioned = routeActivation({
    conversation: { type: 'group' },
    message: { text: '@Barry 这个怎么说' },
    agents,
    replyTo: { agentRole: 'user', id: 'm123' }
  })
  assert.deepEqual(mentioned.targets, [{ agentRole: 'persona', agentId: 'barry' }])
})

test('DM conversations do not require mentions', () => {
  assert.deepEqual(
    routeActivation({
      conversation: { type: 'bird_dm' },
      message: { text: '我今天其实很难受' },
      agents
    }),
    {
      triggerType: 'bird_dm',
      isPersonalRecord: true,
      targets: [{ agentRole: 'bird', agentId: 'bird' }]
    }
  )

  assert.deepEqual(
    routeActivation({
      conversation: { type: 'persona_dm', personaId: 'danzong' },
      message: { text: '直接点说' },
      agents
    }),
    {
      triggerType: 'persona_dm',
      isPersonalRecord: false,
      targets: [{ agentRole: 'persona', agentId: 'danzong' }]
    }
  )
})
