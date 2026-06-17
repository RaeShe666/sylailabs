import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSystemBlocks, classifyReply, findLatestUserMessage, formatQuoted, runPersona, splitBubbles } from '../lib/chirp/personaRuntime.js'

const TEMPLATE = {
  id: 'danzong',
  dbId: '00000000-0000-4000-8000-000000000001',
  personaKey: 'danzong',
  name: 'Danzong',
  role: 'relaxed anti-soup friend',
  runtime_card: {
    identity_summary: 'a relaxed friend who lightly deconstructs things',
    voice_rules: 'short, concrete, warm but not syrupy'
  }
}

const INSTANCE = {
  user_personal_patch: { directness: 'high' },
  user_memory: [{ text: 'User is in an ambiguous relationship with J.' }],
  interaction_skill: [{ text: 'User prefers a judgment before comfort.' }]
}

test('buildSystemBlocks puts bases + runtime card in the cacheable stable layer and instance in context', () => {
  const blocks = buildSystemBlocks({
    template: TEMPLATE,
    instance: INSTANCE,
    planet: { name: 'Love' },
    user: { nickname: 'Lu' },
    members: [{ name: 'Danzong', role: 'persona' }],
    memoryScope: { type: 'persona_membership_planet' }
  })

  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].cache, true)
  assert.match(blocks[0].text, /safety and privacy base/i)
  assert.match(blocks[0].text, /identity_summary/)
  assert.equal(blocks[1].cache, undefined)
  assert.match(blocks[1].text, /ambiguous relationship with J/)
  assert.match(blocks[1].text, /directness/)
})

test('ambient mode does not add a generation-side silence option', () => {
  const ambientBlocks = buildSystemBlocks({ template: TEMPLATE, mode: 'ambient' })
  assert.doesNotMatch(ambientBlocks[1].text, /\[SILENCE\]/)
  assert.doesNotMatch(ambientBlocks[1].text, /stay silent/i)
  assert.match(ambientBlocks[1].text, /starting point is always the user/)

  const fallbackBlocks = buildSystemBlocks({ template: TEMPLATE, mode: 'ambient_fallback' })
  assert.doesNotMatch(fallbackBlocks[1].text, /fallback|left hanging/i)
  assert.ok(!fallbackBlocks[1].text.includes('[SILENCE]'))
})

test('classifyReply separates text and silence', () => {
  assert.equal(classifyReply({ text: 'Here.' }), 'text')
  assert.equal(classifyReply({ text: '[SILENCE]' }), 'text')
  assert.equal(classifyReply({ text: '  ' }), 'silence')
  assert.equal(classifyReply({ text: '[Nothing to add]' }), 'text')
})

test('no HOLD/timing rules injected into any turn', () => {
  for (const mode of ['mentioned', 'ambient', 'ambient_fallback']) {
    const blocks = buildSystemBlocks({ template: TEMPLATE, mode })
    assert.ok(!blocks[1].text.includes('[HOLD]'), `${mode} should not mention HOLD`)
    assert.ok(!blocks[1].text.includes('Timing judgment'), `${mode} should not judge timing`)
  }
})

test('splitBubbles splits on ||| and caps at six bubbles', () => {
  assert.deepEqual(splitBubbles('single message'), ['single message'])
  assert.deepEqual(splitBubbles('one||| two |||three'), ['one', 'two', 'three'])
  assert.deepEqual(splitBubbles(' ||| trimmed ||| '), ['trimmed'])

  const eight = splitBubbles('1|||2|||3|||4|||5|||6|||7|||8')
  assert.equal(eight.length, 6)
  assert.equal(eight[5], '6 7 8')
})

test('findLatestUserMessage treats a no-mention memo as the current message', () => {
  const window = [
    { id: 'm1', type: 'user', text: '@Barry which line do you mean?' },
    { id: 'm2', type: 'agent', agentId: 'barry', text: 'The ordinary friend line.' },
    { id: 'm3', type: 'memo', text: 'You really are like my romance-brain friend.' }
  ]
  assert.equal(findLatestUserMessage(window).id, 'm3')
})

test('runPersona responds to the latest no-mention memo message instead of the prior @ turn', async () => {
  let captured = null
  await runPersona({
    template: TEMPLATE,
    instance: INSTANCE,
    planet: { name: 'Love' },
    user: { nickname: '鹿' },
    members: [{ name: 'Barry', role: 'persona' }],
    messages: [
      { id: 'm1', type: 'user', text: '@Barry which line do you mean?' },
      { id: 'm2', type: 'agent', agentId: 'barry', text: 'The ordinary friend line.' },
      { id: 'm3', type: 'memo', text: 'You really are like my romance-brain friend.' }
    ],
    memoryScope: { type: 'persona_membership_planet' },
    recallTool: async () => ({ summary: 'NONE' }),
    turn: async ({ messages }) => {
      captured = messages[0].content
      return { text: 'You saw through it.', toolCalls: [], stopReason: 'end_turn' }
    }
  })

  assert.match(captured, /Current user message[\s\S]*romance-brain friend/)
  assert.ok(!/Current user message[\s\S]*which line do you mean/.test(captured))
})

test('runPersona uses the full current user turn when provided', async () => {
  let captured = null
  await runPersona({
    template: TEMPLATE,
    instance: INSTANCE,
    planet: { name: 'Love' },
    user: { nickname: '鹿' },
    members: [{ name: 'Barry', role: 'persona' }],
    messages: [
      { id: 'm1', type: 'user', text: 'first' },
      { id: 'm2', type: 'user', text: 'second' },
      { id: 'm3', type: 'user', text: 'third' }
    ],
    currentUserText: 'first\nsecond\nthird',
    currentMessageIds: ['m1', 'm2', 'm3'],
    memoryScope: { type: 'persona_membership_planet' },
    recallTool: async () => ({ summary: 'NONE' }),
    turn: async ({ messages }) => {
      captured = messages[0].content
      return { text: 'received', toolCalls: [], stopReason: 'end_turn' }
    }
  })

  assert.match(captured, /Current user message[\s\S]*first\nsecond\nthird/)
  assert.match(captured, /Recent background before the latest message:\nNONE/)
})

test('runPersona never switches into emoji-only reaction mode', async () => {
  let captured = null
  await runPersona({
    template: TEMPLATE,
    instance: INSTANCE,
    planet: { name: 'Love' },
    user: { nickname: '鹿' },
    members: [{ name: 'Barry', role: 'persona' }],
    messages: [
      { id: 'm1', type: 'user', text: 'Are you sure it is 3am?' }
    ],
    currentUserText: 'Are you sure it is 3am?',
    currentMessageIds: ['m1'],
    mode: 'emoji_reaction',
    memoryScope: { type: 'persona_membership_planet' },
    recallTool: async () => ({ summary: 'NONE' }),
    turn: async ({ messages }) => {
      captured = messages[0].content
      return { text: 'I read the time wrong.', toolCalls: [], stopReason: 'end_turn' }
    }
  })

  assert.match(captured, /Current user message/)
  assert.doesNotMatch(captured, /EXACTLY ONE emoji|No one is replying in words/)
})

test('formatQuoted surfaces the quoted message, empty when none', () => {
  assert.equal(formatQuoted(null), '')
  assert.equal(formatQuoted({ author: 'x', text: '' }), '')
  const block = formatQuoted({ author: 'persona danzong', text: 'Watch whether he follows up.' })
  assert.match(block, /replying to \/ quoting/)
  assert.match(block, /persona danzong: Watch whether he follows up/)
})

test('runPersona injects the quoted message above the background', async () => {
  let captured = null
  await runPersona({
    template: TEMPLATE,
    instance: INSTANCE,
    planet: { name: 'Love' },
    user: { nickname: '鹿' },
    members: [],
    messages: [{ id: 'm9', type: 'user', text: 'What does this mean?' }],
    memoryScope: { type: 'persona_membership_planet' },
    quotedContext: { author: 'persona danzong', text: 'Watch whether he follows up.' },
    recallTool: async () => ({ summary: 'NONE' }),
    turn: async ({ messages }) => {
      captured = messages[0].content
      return { text: 'Yes.', toolCalls: [], stopReason: 'end_turn' }
    }
  })
  assert.match(captured, /Watch whether he follows up/)
  assert.ok(captured.indexOf('Watch whether he follows up') < captured.indexOf('Recent background'))
})

test('runPersona answers directly when the model does not call recall', async () => {
  const calls = []
  const reply = await runPersona({
    template: TEMPLATE,
    instance: INSTANCE,
    planet: { name: 'Love' },
    user: { nickname: 'Lu' },
    members: [],
    messages: [{ id: 'm1', type: 'user', text: '@Danzong are you there?' }],
    memoryScope: { type: 'persona_membership_planet' },
    recallTool: async () => {
      throw new Error('recall should not be called')
    },
    turn: async ({ messages, tools }) => {
      calls.push({ messages, tools })
      return { text: 'Here. Say it.', toolCalls: [], stopReason: 'end_turn' }
    }
  })

  assert.equal(reply.text, 'Here. Say it.')
  assert.equal(reply.recall, null)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].tools[0].name, 'recall')
})

test('runPersona performs at most one native recall tool round trip', async () => {
  const recalledQueries = []
  let turnCount = 0

  const reply = await runPersona({
    template: TEMPLATE,
    instance: INSTANCE,
    planet: { name: 'Love' },
    user: { nickname: 'Lu' },
    members: [{ name: 'Danzong', role: 'persona' }],
    messages: [{ id: 'm1', type: 'user', text: '@Danzong did he do this last time too?' }],
    memoryScope: {
      type: 'persona_membership_planet',
      agent_id: 'danzong',
      allowed_conversation_ids: ['group-love']
    },
    recallTool: async (queries) => {
      recalledQueries.push(...queries)
      return { queries, summary: '- user: Last week he also replied vaguely and explained the next day.' }
    },
    turn: async ({ messages }) => {
      turnCount += 1
      if (turnCount === 1) {
        return {
        text: '上次也像一朵云，不是判决书；先看他这次会不会补动作。',
          toolCalls: [{ id: 'tool-1', name: 'recall', input: { queries: ['last time vague reply', 'explained next day'] } }],
          stopReason: 'tool_use'
        }
      }
      const toolResult = messages.find(message => message.role === 'tool_result')
      assert.match(toolResult.content, /Last week/)
      return {
        text: 'Last time was also cloudy, not a verdict. Watch whether he follows up this time.',
        toolCalls: [],
        stopReason: 'end_turn'
      }
    }
  })

  assert.equal(reply.text, 'Last time was also cloudy, not a verdict. Watch whether he follows up this time.')
  assert.deepEqual(recalledQueries, ['last time vague reply', 'explained next day'])
  assert.equal(turnCount, 2)
  assert.match(reply.recall.summary, /Last week/)
})
