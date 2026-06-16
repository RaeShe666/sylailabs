import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSystemBlocks, classifyReply, findLatestUserMessage, formatQuoted, makeSilenceGate, runPersona, splitBubbles } from '../lib/chirp/personaRuntime.js'

const TEMPLATE = {
  id: 'danzong',
  dbId: '00000000-0000-4000-8000-000000000001',
  personaKey: 'danzong',
  name: '诞总',
  role: '松弛、反鸡汤的朋友',
  runtime_card: {
    identity_summary: '一个松弛、反鸡汤、会轻轻拆穿你的朋友。',
    voice_rules: '短、松、具体。'
  }
}

const INSTANCE = {
  user_personal_patch: { directness: 'high' },
  user_memory: [{ text: '用户叫鹿，和 J 处于暧昧期。' }],
  interaction_skill: [{ text: '她不喜欢被安慰，先给判断再给温度。' }],
  affective_context: {}
}

test('buildSystemBlocks puts bases + runtime card in the cacheable stable layer and instance in context', () => {
  const blocks = buildSystemBlocks({
    template: TEMPLATE,
    instance: INSTANCE,
    planet: { name: '恋爱' },
    user: { nickname: '鹿' },
    members: [{ name: '诞总', role: 'persona' }],
    memoryScope: { type: 'persona_membership_planet' }
  })

  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].cache, true)
  assert.match(blocks[0].text, /safety and privacy base/i)
  assert.match(blocks[0].text, /identity_summary/)
  assert.equal(blocks[1].cache, undefined)
  assert.match(blocks[1].text, /用户叫鹿/)
  assert.match(blocks[1].text, /directness/)
})

test('ambient mode adds the silence option and fallback modes are not supported', () => {
  const ambientBlocks = buildSystemBlocks({ template: TEMPLATE, mode: 'ambient' })
  assert.match(ambientBlocks[1].text, /\[SILENCE\]/)
  assert.match(ambientBlocks[1].text, /starting point is always the user/)

  const fallbackBlocks = buildSystemBlocks({ template: TEMPLATE, mode: 'ambient_fallback' })
  assert.doesNotMatch(fallbackBlocks[1].text, /fallback|left hanging/i)
  assert.ok(!fallbackBlocks[1].text.includes('[SILENCE]'))

  const mentionedBlocks = buildSystemBlocks({ template: TEMPLATE })
  assert.ok(!mentionedBlocks[1].text.includes('[SILENCE]'))
})

test('classifyReply separates text and silence (no completeness judgment)', () => {
  // Normal text always shows.
  assert.equal(classifyReply({ text: '在。说吧。' }, 'mentioned'), 'text')
  assert.equal(classifyReply({ text: '在。说吧。' }, 'ambient'), 'text')

  // The silence token and empty replies never show.
  assert.equal(classifyReply({ text: '[SILENCE]' }, 'ambient'), 'silence')
  assert.equal(classifyReply({ text: '  ' }, 'mentioned'), 'silence')

  // Bracketed improvisations: silence on ambient (fumbled silence token); on
  // mentioned the user expects a reply, so a stray bracket line still shows.
  assert.equal(classifyReply({ text: '[无事可说你也不用跟我确认什么]' }, 'ambient'), 'silence')
  assert.equal(classifyReply({ text: '【今天没什么想说的】' }, 'ambient'), 'silence')
  assert.equal(classifyReply({ text: '[在的]' }, 'mentioned'), 'text')
})

test('no HOLD/timing rules injected into any turn (timing is client-side)', () => {
  for (const mode of ['mentioned', 'ambient', 'ambient_fallback']) {
    const blocks = buildSystemBlocks({ template: TEMPLATE, mode })
    assert.ok(!blocks[1].text.includes('[HOLD]'), `${mode} should not mention HOLD`)
    assert.ok(!blocks[1].text.includes('Timing judgment'), `${mode} should not judge timing`)
  }
})

test('makeSilenceGate holds bracket-opening replies and streams normal ones', () => {
  let streamed = ''
  const gate = makeSilenceGate(delta => { streamed += delta })

  gate('[无事')
  gate('可说]')
  assert.equal(streamed, '')

  let streamed2 = ''
  const gate2 = makeSilenceGate(delta => { streamed2 += delta })
  gate2('上次')
  gate2('也像一朵云')
  assert.equal(streamed2, '上次也像一朵云')
})

test('splitBubbles splits on ||| and caps at six bubbles', () => {
  assert.deepEqual(splitBubbles('单条消息'), ['单条消息'])
  assert.deepEqual(splitBubbles('哈哈哈 ||| 不过说真的 ||| 你昨晚睡了吗'), ['哈哈哈', '不过说真的', '你昨晚睡了吗'])
  assert.deepEqual(splitBubbles(' ||| 前后空的 ||| '), ['前后空的'])

  const eight = splitBubbles('1|||2|||3|||4|||5|||6|||7|||8')
  assert.equal(eight.length, 6)
  assert.equal(eight[5], '6 7 8')
})

test('findLatestUserMessage treats a no-@ memo as the current message, not the previous @-turn', () => {
  // Regression: a no-@ message is stored as 'memo'. The persona must respond to
  // it, not skip back to the earlier @-addressed 'user' line.
  const window = [
    { id: 'm1', type: 'user', text: '@Barry 你说的是指哪句话' },
    { id: 'm2', type: 'agent', agentId: 'barry', text: '「你觉得可能我只是个普通朋友」这句。' },
    { id: 'm3', type: 'memo', text: '你还真是像我的恋爱脑朋友' }
  ]
  assert.equal(findLatestUserMessage(window).id, 'm3')
})

test('runPersona responds to the latest no-@ (memo) message instead of the prior @-turn', async () => {
  let captured = null
  await runPersona({
    template: TEMPLATE,
    instance: INSTANCE,
    planet: { name: '恋爱' },
    user: { nickname: '' },
    members: [{ name: 'Barry', role: 'persona' }],
    messages: [
      { id: 'm1', type: 'user', text: '@Barry 你说的是指哪句话' },
      { id: 'm2', type: 'agent', agentId: 'barry', text: '「你觉得可能我只是个普通朋友」这句。' },
      { id: 'm3', type: 'memo', text: '你还真是像我的恋爱脑朋友' }
    ],
    memoryScope: { type: 'persona_membership_planet' },
    recallTool: async () => ({ summary: 'NONE' }),
    turn: async ({ messages }) => {
      captured = messages[0].content
      return { text: '哈哈，被你看穿了。', toolCalls: [], stopReason: 'end_turn' }
    }
  })

  // The current message is the latest line, and the prior @-question is demoted
  // to background — not re-answered.
  assert.match(captured, /Current user message[\s\S]*你还真是像我的恋爱脑朋友/)
  assert.ok(!/Current user message[\s\S]*你说的是指哪句话/.test(captured))
})

test('runPersona uses the full current user turn when provided', async () => {
  let captured = null
  await runPersona({
    template: TEMPLATE,
    instance: INSTANCE,
    planet: { name: '恋爱' },
    user: { nickname: '' },
    members: [{ name: 'Barry', role: 'persona' }],
    messages: [
      { id: 'm1', type: 'user', text: '第一条' },
      { id: 'm2', type: 'user', text: '第二条' },
      { id: 'm3', type: 'user', text: '第三条' }
    ],
    currentUserText: '第一条\n第二条\n第三条',
    currentMessageIds: ['m1', 'm2', 'm3'],
    memoryScope: { type: 'persona_membership_planet' },
    recallTool: async () => ({ summary: 'NONE' }),
    turn: async ({ messages }) => {
      captured = messages[0].content
      return { text: '收到', toolCalls: [], stopReason: 'end_turn' }
    }
  })

  assert.match(captured, /Current user message[\s\S]*第一条\n第二条\n第三条/)
  assert.match(captured, /Recent background before the latest message:\nNONE/)
})

test('runPersona never switches into emoji-only reaction mode', async () => {
  let captured = null
  await runPersona({
    template: TEMPLATE,
    instance: INSTANCE,
    planet: { name: '恋爱' },
    user: { nickname: '' },
    members: [{ name: 'Barry', role: 'persona' }],
    messages: [
      { id: 'm1', type: 'user', text: '你确定现在是凌晨3点？' }
    ],
    currentUserText: '你确定现在是凌晨3点？',
    currentMessageIds: ['m1'],
    mode: 'emoji_reaction',
    memoryScope: { type: 'persona_membership_planet' },
    recallTool: async () => ({ summary: 'NONE' }),
    turn: async ({ messages }) => {
      captured = messages[0].content
      return { text: '不是，我看错时间了。', toolCalls: [], stopReason: 'end_turn' }
    }
  })

  assert.match(captured, /Current user message/)
  assert.doesNotMatch(captured, /EXACTLY ONE emoji|No one is replying in words/)
})

test('formatQuoted surfaces the quoted message, empty when none', () => {
  assert.equal(formatQuoted(null), '')
  assert.equal(formatQuoted({ author: 'x', text: '' }), '')
  const block = formatQuoted({ author: 'persona danzong', text: '一个嗯嗯不能判死刑' })
  assert.match(block, /replying to \/ quoting/)
  assert.match(block, /persona danzong: 一个嗯嗯不能判死刑/)
})

test('runPersona injects the quoted message above the background', async () => {
  let captured = null
  await runPersona({
    template: TEMPLATE,
    instance: INSTANCE,
    planet: { name: '恋爱' },
    user: { nickname: '' },
    members: [],
    messages: [{ id: 'm9', type: 'user', text: '这个怎么说' }],
    memoryScope: { type: 'persona_membership_planet' },
    quotedContext: { author: 'persona danzong', text: '先看他会不会补动作' },
    recallTool: async () => ({ summary: 'NONE' }),
    turn: async ({ messages }) => {
      captured = messages[0].content
      return { text: '嗯', toolCalls: [], stopReason: 'end_turn' }
    }
  })
  // Quote appears, and before the background section.
  assert.match(captured, /先看他会不会补动作/)
  assert.ok(captured.indexOf('先看他会不会补动作') < captured.indexOf('Recent background'))
})

test('runPersona answers directly when the model does not call recall', async () => {
  const calls = []
  const reply = await runPersona({
    template: TEMPLATE,
    instance: INSTANCE,
    planet: { name: '恋爱' },
    user: { nickname: '鹿' },
    members: [],
    messages: [{ id: 'm1', type: 'user', text: '@诞总 在吗' }],
    memoryScope: { type: 'persona_membership_planet' },
    recallTool: async () => {
      throw new Error('recall should not be called')
    },
    turn: async ({ messages, tools }) => {
      calls.push({ messages, tools })
      return { text: '在。说吧。', toolCalls: [], stopReason: 'end_turn' }
    }
  })

  assert.equal(reply.text, '在。说吧。')
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
    planet: { name: '恋爱' },
    user: { nickname: '鹿' },
    members: [{ name: '诞总', role: 'persona' }],
    messages: [{ id: 'm1', type: 'user', text: '@诞总 他上次也这样吗？' }],
    memoryScope: {
      type: 'persona_membership_planet',
      agent_id: 'danzong',
      allowed_conversation_ids: ['group-love']
    },
    recallTool: async (queries) => {
      recalledQueries.push(...queries)
      return { queries, summary: '- user: 上周他说“嗯嗯”，后来第二天补解释了。' }
    },
    turn: async ({ messages }) => {
      turnCount += 1
      if (turnCount === 1) {
        return {
          text: '',
          toolCalls: [{ id: 'tool-1', name: 'recall', input: { queries: ['上次 嗯嗯', '冷淡 解释'] } }],
          stopReason: 'tool_use'
        }
      }
      const toolResult = messages.find(message => message.role === 'tool_result')
      assert.match(toolResult.content, /上周他说/)
      return {
        text: '上次也像一朵云，不是判决书；先看他这次会不会补动作。',
        toolCalls: [],
        stopReason: 'end_turn'
      }
    }
  })

  assert.equal(reply.text, '上次也像一朵云，不是判决书；先看他这次会不会补动作。')
  assert.deepEqual(recalledQueries, ['上次 嗯嗯', '冷淡 解释'])
  assert.equal(turnCount, 2)
  assert.match(reply.recall.summary, /上周他说/)
})
