// Thin ModelProvider seam (framework v2 §2.5 / persona-v2 §7).
// Normalized chat-turn interface with native tool calling. Two adapters:
// - anthropic: official SDK, Messages API tools (Anthropic-format endpoint)
// - openai_compat: OpenAI-style /chat/completions (DeepSeek, or any aggregator
//   like toapis exposing Gemini/Claude/GPT through the OpenAI schema)
//
// Resolution order: explicit LLM_PROVIDER, else Anthropic key, else the
// OpenAI-compatible key (LLM_API_KEY or legacy DEEPSEEK_API_KEY).
// OpenAI-compatible config (one set of env, with DEEPSEEK_* kept as aliases):
//   LLM_BASE_URL   e.g. https://toapis.com/v1   (or https://api.deepseek.com)
//   LLM_API_KEY    the provider/aggregator key
//   LLM_MODEL      e.g. claude-sonnet-4-6 / gemini-3-flash / deepseek-chat

import Anthropic from '@anthropic-ai/sdk'

const OPENAI_COMPAT_BASE_URL = process.env.LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const OPENAI_COMPAT_API_KEY = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY
const OPENAI_COMPAT_MODEL = process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat'
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8'

// Cheap/fast model for non-user-facing reasoning: turn perception (shared
// emotion read) and per-persona participation gates. Defaults to DeepSeek;
// override with PERCEPTION_*. This is never the reply model.
const PERCEPTION_BASE_URL = process.env.PERCEPTION_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const PERCEPTION_API_KEY = process.env.PERCEPTION_API_KEY || process.env.DEEPSEEK_API_KEY || OPENAI_COMPAT_API_KEY
const PERCEPTION_MODEL = process.env.PERCEPTION_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat'

let anthropicClient = null

export function getConfiguredProviderName() {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  if (OPENAI_COMPAT_API_KEY) return 'openai_compat'
  return 'none'
}

// chatTurn: one normalized model call.
//   system   - array of { text, cache } blocks (cache marks a prompt-cache breakpoint)
//   messages - [{ role: 'user'|'assistant', content }] plus
//              assistant tool turns { role: 'assistant', content, toolCalls: [{ id, name, input }] }
//              and tool results { role: 'tool_result', toolUseId, content }
//   tools    - [{ name, description, inputSchema }]
//   onText   - optional (delta) => void; when provided the call streams and
//              text deltas are pushed as they arrive
// returns { text, toolCalls, stopReason }
export async function chatTurn({ system = [], messages = [], tools = [], maxTokens = 1024, onText = null }) {
  const provider = getConfiguredProviderName()
  if (provider === 'anthropic') return anthropicTurn({ system, messages, tools, maxTokens, onText })
  if (provider === 'openai_compat') return openAiCompatTurn({ system, messages, tools, maxTokens, onText })
  throw new Error('No model provider configured. Set ANTHROPIC_API_KEY or LLM_API_KEY.')
}

function normalizeSystem(system) {
  if (typeof system === 'string') return [{ text: system }]
  return system
}

// Cheap, non-streaming, single-shot call for internal reasoning (perception /
// participation gates). Returns raw text; caller parses JSON. Never user-facing.
export async function cheapChat({ system, user, maxTokens = 600 }) {
  if (!PERCEPTION_API_KEY) throw new Error('No perception model configured (set PERCEPTION_API_KEY or DEEPSEEK_API_KEY).')
  const response = await fetch(`${PERCEPTION_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PERCEPTION_API_KEY}`
    },
    body: JSON.stringify({
      model: PERCEPTION_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Perception model failed (${PERCEPTION_MODEL}): ${detail}`)
  }
  const data = await response.json()
  return (data.choices?.[0]?.message?.content || '').trim()
}

async function anthropicTurn({ system, messages, tools, maxTokens, onText }) {
  if (!anthropicClient) anthropicClient = new Anthropic()

  const systemBlocks = normalizeSystem(system).map(block => ({
    type: 'text',
    text: block.text,
    ...(block.cache ? { cache_control: { type: 'ephemeral' } } : {})
  }))

  const apiMessages = []
  for (const message of messages) {
    if (message.role === 'tool_result') {
      const last = apiMessages[apiMessages.length - 1]
      const resultBlock = {
        type: 'tool_result',
        tool_use_id: message.toolUseId,
        content: String(message.content ?? '')
      }
      if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
        last.content.push(resultBlock)
      } else {
        apiMessages.push({ role: 'user', content: [resultBlock] })
      }
    } else if (message.role === 'assistant' && message.toolCalls?.length) {
      apiMessages.push({
        role: 'assistant',
        content: [
          ...(message.content ? [{ type: 'text', text: message.content }] : []),
          ...message.toolCalls.map(call => ({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.input
          }))
        ]
      })
    } else {
      apiMessages.push({ role: message.role, content: message.content })
    }
  }

  const request = {
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system: systemBlocks,
    messages: apiMessages,
    ...(tools.length
      ? {
          tools: tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema
          }))
        }
      : {})
  }

  let response
  if (onText) {
    const stream = anthropicClient.messages.stream(request)
    stream.on('text', delta => onText(delta))
    response = await stream.finalMessage()
  } else {
    response = await anthropicClient.messages.create(request)
  }

  return {
    text: response.content.filter(block => block.type === 'text').map(block => block.text).join('').trim(),
    toolCalls: response.content
      .filter(block => block.type === 'tool_use')
      .map(block => ({ id: block.id, name: block.name, input: block.input })),
    stopReason: response.stop_reason
  }
}

async function openAiCompatTurn({ system, messages, tools, maxTokens, onText }) {
  const apiMessages = [
    { role: 'system', content: normalizeSystem(system).map(block => block.text).join('\n\n') }
  ]
  for (const message of messages) {
    if (message.role === 'tool_result') {
      apiMessages.push({ role: 'tool', tool_call_id: message.toolUseId, content: String(message.content ?? '') })
    } else if (message.role === 'assistant' && message.toolCalls?.length) {
      apiMessages.push({
        role: 'assistant',
        content: message.content || '',
        tool_calls: message.toolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.input || {}) }
        }))
      })
    } else {
      apiMessages.push({ role: message.role, content: message.content })
    }
  }

  const response = await fetch(`${OPENAI_COMPAT_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_COMPAT_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_COMPAT_MODEL,
      messages: apiMessages,
      max_tokens: maxTokens,
      stream: Boolean(onText),
      ...(tools.length
        ? {
            tools: tools.map(tool => ({
              type: 'function',
              function: { name: tool.name, description: tool.description, parameters: tool.inputSchema }
            }))
          }
        : {})
    })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Model request failed (${OPENAI_COMPAT_MODEL}): ${detail}`)
  }

  if (!onText) {
    const data = await response.json()
    const choice = data.choices?.[0]
    const toolCalls = (choice?.message?.tool_calls || []).map(call => ({
      id: call.id,
      name: call.function?.name,
      input: safeParseJson(call.function?.arguments) || {}
    }))

    return {
      text: (choice?.message?.content || '').trim(),
      toolCalls,
      stopReason: toolCalls.length ? 'tool_use' : (choice?.finish_reason || 'end_turn')
    }
  }

  return readOpenAiCompatStream(response, onText)
}

// OpenAI-compatible SSE: text arrives as delta.content, tool calls arrive as
// indexed argument fragments that must be accumulated.
async function readOpenAiCompatStream(response, onText) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let finishReason = null
  const toolSlots = []

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      const chunk = safeParseJson(payload)
      const choice = chunk?.choices?.[0]
      if (!choice) continue
      if (choice.finish_reason) finishReason = choice.finish_reason

      const delta = choice.delta || {}
      if (delta.content) {
        text += delta.content
        onText(delta.content)
      }
      for (const call of delta.tool_calls || []) {
        const slot = toolSlots[call.index] || (toolSlots[call.index] = { id: '', name: '', args: '' })
        if (call.id) slot.id = call.id
        if (call.function?.name) slot.name = call.function.name
        if (call.function?.arguments) slot.args += call.function.arguments
      }
    }
  }

  const toolCalls = toolSlots
    .filter(Boolean)
    .map(slot => ({ id: slot.id, name: slot.name, input: safeParseJson(slot.args) || {} }))

  return {
    text: text.trim(),
    toolCalls,
    stopReason: toolCalls.length ? 'tool_use' : (finishReason || 'end_turn')
  }
}

function safeParseJson(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
