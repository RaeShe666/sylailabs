import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../supabaseClient'
import { BIRD, CHIRP_PLANETS, getAllPersonas, PersonaAvatar, UserAvatar, formatMessageTime } from './chirpShared'
import { ensureChirpConversations, loadChirpMessages, loadChirpPlanets, loadCustomPersonas } from './chirpSupabase'
import './ChirpPage.css'

const getApiBase = () => {
  const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  return isLocalHost ? 'http://localhost:8080' : (import.meta.env.VITE_API_URL || '')
}

function PersonaTestPage({ personaId, language = 'en', onBack }) {
  const { user, getAccessToken } = useAuth()
  const isChinese = language === 'zh'
  const [personas, setPersonas] = useState(() => getAllPersonas())
  const [planet, setPlanet] = useState(null)
  const [conversationId, setConversationId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [toast, setToast] = useState('')
  const timelineRef = useRef(null)
  const isBird = personaId === 'bird'

  const persona = useMemo(() => {
    if (isBird) return BIRD
    return personas.find(item => item.id === personaId || item.dbId === personaId || item.personaKey === personaId) || personas[0]
  }, [isBird, personas, personaId])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        if (!user) return
        await seedDefaultPersonas(getAccessToken)
        const [remotePlanets, remotePersonas] = await Promise.all([
          loadChirpPlanets(user),
          loadCustomPersonas(user)
        ])
        if (cancelled) return
        const nextPlanet = remotePlanets[0] || CHIRP_PLANETS[0]
        const nextPersonas = mergePersonas(getAllPersonas(), remotePersonas)
        const selected = isBird
          ? BIRD
          : nextPersonas.find(item => item.id === personaId || item.dbId === personaId || item.personaKey === personaId) || nextPersonas[0]
        const nextConversation = await ensureDirectConversation(user, nextPlanet, selected, isBird)
        if (cancelled) return
        setPersonas(nextPersonas)
        setPlanet(nextPlanet)
        setConversationId(nextConversation?.conversationId || null)
        const { messages: remoteMessages } = await loadChirpMessages({ ...nextPlanet, conversationId: nextConversation?.conversationId })
        if (!cancelled) setMessages(remoteMessages || [])
      } catch (error) {
        console.warn('Failed to load persona test:', error)
        if (!cancelled) setToast(error.message)
      }
    }
    load()
    return () => { cancelled = true }
  }, [user, getAccessToken, personaId, isBird])

  useEffect(() => {
    requestAnimationFrame(() => {
      if (timelineRef.current) timelineRef.current.scrollTop = timelineRef.current.scrollHeight
    })
  }, [messages, streamingText])

  // Single-persona debug page: reply timing isn't modeled here (it's a tester),
  // so each send streams a reply immediately.
  const send = async () => {
    const text = input.trim()
    if (!text || !persona || !planet || loading) return
    setInput('')
    setLoading(true)
    const localMessage = {
      id: `local-${Date.now()}`,
      type: 'user',
      text,
      read: true,
      createdAt: Date.now()
    }
    setMessages(prev => [...prev, localMessage])

    try {
      const token = await getAccessToken()
      if (!token) throw new Error('auth_required')
      const response = await fetch(`${getApiBase()}/api/chirp/turn/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          planet,
          conversation: {
            id: conversationId,
            type: isBird ? 'bird_dm' : 'persona_dm',
            agentId: persona.id,
            personaId: persona.id,
            title: persona.name
          },
          user: {},
          text,
          agents: isBird ? [] : [persona],
          members: [
            { id: 'user', name: 'S', role: 'user' },
            { id: persona.id, name: persona.name, role: persona.role }
          ]
        })
      })
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let streamError = null

      const handleBlock = (block) => {
        const eventLine = block.split('\n').find(line => line.startsWith('event:'))
        const dataLines = block.split('\n').filter(line => line.startsWith('data:'))
        if (!eventLine || !dataLines.length) return
        const event = eventLine.slice(6).trim()
        const data = JSON.parse(dataLines.map(line => line.slice(5).trimStart()).join('\n') || 'null')

        if (event === 'user_message' && data?.id) {
          if (data.conversationId && !conversationId) setConversationId(data.conversationId)
          setMessages(prev => prev.map(message => (message.id === localMessage.id ? data : message)))
        } else if (event === 'agent_delta' && data?.delta) {
          setStreamingText(prev => prev + data.delta)
        } else if (event === 'agent_reset') {
          setStreamingText('')
        } else if (event === 'agent_message' && data?.message?.text) {
          setStreamingText('')
          setMessages(prev => [...prev, data.message])
        } else if (event === 'agent_error' || event === 'error') {
          streamError = data?.error || 'stream_error'
        }
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''
        blocks.filter(Boolean).forEach(handleBlock)
      }
      buffer += decoder.decode()
      if (buffer.trim()) handleBlock(buffer)
      if (streamError) throw new Error(streamError)
    } catch (error) {
      setToast(error.message)
    } finally {
      setStreamingText('')
      setLoading(false)
    }
  }

  return (
    <div className="chirp-page persona-test-page" style={{ '--chirp-paper': '#FAFAF7' }}>
      <div className="chirp-shell">
        <header className="chirp-topbar">
          <button className="chirp-back" type="button" aria-label="Back" onClick={onBack}>
            <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <div className="persona-test-title">
            <span>{persona?.name || 'Persona'} {isBird ? 'DM' : 'test'}</span>
            <small>{isBird ? (isChinese ? 'Bird 私聊' : 'Bird direct message') : (isChinese ? '单 persona 调试入口' : 'single persona debug entry')}</small>
          </div>
        </header>
        <main className="chirp-main">
          <section className="chirp-chat">
            <div className="chirp-timeline" ref={timelineRef}>
              <div className="chirp-system-note">
                {isBird
                  ? (isChinese ? '这里是 Bird 私聊，planet_id 按设计为空。' : 'This is Bird DM; planet_id is intentionally null.')
                  : (isChinese ? '这里绕开群聊，只测试一条 persona 记录。' : 'This bypasses group chat and tests one persona record directly.')}
              </div>
              {messages.map(message => (
                <PersonaTestBubble key={message.id} message={message} persona={persona} />
              ))}
              {streamingText && persona && (
                <div className="chirp-message agent">
                  <div className="chirp-agent-side-avatar" style={{ backgroundColor: persona.color }}><PersonaAvatar persona={persona} /></div>
                  <div className="chirp-agent-message-body">
                    <span className="chirp-agent-name">{persona.name}</span>
                    {streamingText.split(/\s*\|\|\|\s*/).filter(Boolean).map((part, index) => (
                      <div className="chirp-bubble" key={index} style={index > 0 ? { marginTop: 6 } : undefined}>{part}</div>
                    ))}
                  </div>
                </div>
              )}
              {loading && !streamingText && persona && (
                <div className="chirp-message agent">
                  <div className="chirp-agent-side-avatar" style={{ backgroundColor: persona.color }}><PersonaAvatar persona={persona} /></div>
                  <div className="chirp-agent-message-body"><div className="chirp-bubble typing"><i></i><i></i><i></i></div></div>
                </div>
              )}
            </div>
            <footer className="chirp-composer">
              <div className="chirp-input-row">
                <div className="chirp-input-shell">
                  <textarea
                    rows="1"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        send()
                      }
                    }}
                    placeholder={isChinese ? '直接和这条 persona 记录说话' : 'Talk directly to this persona record'}
                  />
                </div>
                <button className="chirp-send" type="button" onClick={send} aria-label="Send">
                  <svg viewBox="0 0 24 24"><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></svg>
                </button>
              </div>
            </footer>
          </section>
        </main>
        {toast && <div className="chirp-toast">{toast}</div>}
      </div>
    </div>
  )
}

function PersonaTestBubble({ message, persona }) {
  // memo = personal-record classification (bird DM user messages); render like user.
  if (message.type === 'user' || message.type === 'memo') {
    return (
      <div className="chirp-message user">
        <div className="chirp-user-message-body">
          <div className="chirp-bubble">{message.text}</div>
          <span className="chirp-read-receipt">{formatMessageTime(new Date(message.createdAt))} Read</span>
        </div>
        <div className="chirp-user-side-avatar"><UserAvatar /></div>
      </div>
    )
  }

  if (message.type !== 'agent') return null
  return (
    <div className="chirp-message agent">
      <div className="chirp-agent-side-avatar" style={{ backgroundColor: persona?.color }}><PersonaAvatar persona={persona} /></div>
      <div className="chirp-agent-message-body"><span className="chirp-agent-name">{persona?.name}</span><div className="chirp-bubble">{message.text}</div></div>
    </div>
  )
}

async function seedDefaultPersonas(getAccessToken) {
  const token = await getAccessToken()
  if (!token) return null
  const response = await fetch(`${getApiBase()}/api/chirp/personas/seed-defaults`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.warn('Seed default personas failed:', detail)
  }
  return null
}

async function ensureDirectConversation(user, planet, persona, isBird) {
  if (!user || !persona?.id) return null
  const ensured = !isBird && planet?.dbId ? await ensureChirpConversations(user, planet, [persona]) : planet
  const response = await fetchConversation(user, planet, persona, isBird)
  return {
    ...ensured,
    conversationId: response?.id || null
  }
}

async function fetchConversation(user, planet, persona, isBird) {
  let query = supabase
    .from('chirp_conversations')
    .select('*')
    .eq('owner_id', user.id)
    .eq('type', isBird ? 'bird_dm' : 'persona_dm')
    .limit(1)

  query = isBird
    ? query.is('planet_id', null)
    : query.eq('planet_id', planet.dbId).contains('metadata', { agent_id: persona.id })

  const { data } = await query.maybeSingle()
  return data
}

function mergePersonas(...groups) {
  const byId = new Map()
  groups.flat().filter(Boolean).forEach(persona => {
    byId.set(persona.id, { ...(byId.get(persona.id) || {}), ...persona })
  })
  return [...byId.values()]
}

export default PersonaTestPage
