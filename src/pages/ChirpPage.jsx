import { Fragment, memo, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  BIRD,
  CHIRP_PLANETS,
  DeerAvatar,
  PERSONA_POOL,
  PersonaAvatar,
  UserAvatar,
  formatMessageTime,
  formatChatSeparator,
  getPersonasForPlanet,
  getPlanetRecent,
  savePlanetMeta,
  writePlanetActivity
} from './chirpShared'
import { ensureChirpConversations, loadChirpMessages, loadChirpMessagesByConversation, loadOlderChirpMessages, loadCustomPersonas, loadPlanetMemberPersonas, saveChirpMessage, savePlanetMemberPersonas, updateChirpConversationTitle, updateChirpPlanet } from './chirpSupabase'
import { getCachedMessages, getMessageCacheKey, setCachedMessages, updateCachedMessages } from './chirpHistoryCache'
import { buildChirpTurnPayload } from './chirpTurnPayload'
import { takeNextReadyTurn } from './chirpTurnQueue'
import './ChirpPage.css'

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
// Reply timing (persona-v2 §5.3): people split one thought across several quick
// messages, so we don't reply on send — we reply once the user goes quiet.
// A reply fires only when, for IDLE_MS, there has been no input activity
// (typing / emoji / IME composition) AND the input box is empty AND no reply
// is already streaming. Messages sent meanwhile just accumulate into the batch;
// sending during a streaming reply queues rather than errors.
const IDLE_MS = 2000          // input-silence window before replying
const IDLE_POLL_MS = 400      // re-check cadence while waiting
const IDLE_DEBUG = false      // show on-screen batching/idle timing panel (set false to hide)
const getApiBase = () => {
  const isDevFrontend = ['5173', '3000'].includes(window.location.port)
  if (isDevFrontend) return `${window.location.protocol}//${window.location.hostname}:8080`
  return import.meta.env.VITE_API_URL || ''
}

const createInitialMessages = (planet) => {
  return [
    { id: 'm1', type: 'user', isPersonalRecord: true, text: 'He only replied "mm" today. I want to act like it is fine, but I keep thinking about it.', createdAt: Date.now() - 1000 * 60 * 4 },
    { id: 'm2', type: 'user', text: '@Danzong is this getting cold?', read: true, createdAt: Date.now() - 1000 * 60 * 3 },
    { id: 'm3', type: 'agent', agentId: 'danzong', text: 'One "mm" is not enough evidence for a verdict. Treat it like one cloud in the weather report and watch what he does next.', createdAt: Date.now() - 1000 * 60 * 2 }
  ]
}

function ChirpPage({ planetConfig = CHIRP_PLANETS[0], onBack, language = 'en', onOpenPersona = null, dmAgent = null, dmConversationId: dmConversationIdProp = null, onDmStarted = null }) {
  const { user, getAccessToken } = useAuth()
  const isChinese = language === 'zh'
  // DM mode: a 1:1 conversation with one persona (persona_dm). The backend keeps
  // it planet-independent for now; only that persona is in the room.
  const isDM = !!dmAgent
  const isBirdDM = dmAgent?.id === 'bird'
  const initialAgents = useMemo(
    () => (dmAgent ? (isBirdDM ? [] : [dmAgent]) : getPersonasForPlanet(planetConfig)),
    [planetConfig, dmAgent, isBirdDM]
  )
  const [planet, setPlanet] = useState({
    id: planetConfig.id,
    name: planetConfig.roomName,                                   // planet (folder) name
    groupName: planetConfig.groupName || planetConfig.roomName,    // group chat name (separate)
    type: planetConfig.type,
    tone: planetConfig.tone,
    background: planetConfig.background
  })
  // Nickname is not collected during onboarding yet; leave it empty so the
  // runtime tells the model not to invent or use a name.
  const [userProfile] = useState({ nickname: '', avatar: 'S' })
  const [agents, setAgents] = useState(initialAgents)
  const [messages, setMessages] = useState(() => (dmAgent ? [] : createInitialMessages(planetConfig)))
  const [dmConversationId, setDmConversationId] = useState(null)
  const [input, setInput] = useState('')
  const [quoting, setQuoting] = useState(null)   // the bubble being quoted, or null
  const [activeAgentId, setActiveAgentId] = useState(initialAgents[0]?.id || null)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState({ name: planetConfig.groupName || planetConfig.roomName })
  const [nameEditing, setNameEditing] = useState(false)
  const [typingAgentIds, setTypingAgentIds] = useState([])
  const [streamingReplies, setStreamingReplies] = useState({})
  const [turnInFlight, setTurnInFlight] = useState(false)
  const [toast, setToast] = useState('')
  const timelineRef = useRef(null)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)
  const previousPlanetIdRef = useRef(planetConfig.id)
  const collectRef = useRef(null)
  const collectTimerRef = useRef(null)
  const inputDraftRef = useRef('')
  const lastActivityRef = useRef(0)   // last input activity (typing/emoji/IME) or send
  const isComposingRef = useRef(false)   // IME composition in progress (preedit not yet committed)
  const [idleEvents, setIdleEvents] = useState([])
  const idleLog = (msg) => {
    if (!IDLE_DEBUG) return
    console.log('[chirp-idle]', msg)
    const stamp = new Date().toISOString().slice(11, 23)
    setIdleEvents(prev => [...prev.slice(-150), `${stamp}  ${msg}`])
  }
  const turnInFlightRef = useRef(false)
  const activeTurnTokenRef = useRef(null)
  const readyQueueRef = useRef([])
  const inFlightConversationsRef = useRef(new Set())
  // History paging + scroll anchoring (see chirp-history-loading-cache).
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const atBottomRef = useRef(true)          // is the view pinned to the latest message?
  const skipAutoScrollRef = useRef(false)   // set during an older-page prepend (preserve position)
  const loadingOlderRef = useRef(false)     // guard against overlapping older-page fetches
  const historyKeyRef = useRef(null)        // current conversation cache key, for writes from pushMessage

  // The cache/paging key: DM = its conversation id; group = its conversation id
  // (or the planet id before that resolves — group messages carry planet_id too).
  // Cache/paging key. Group: the planet db id (stable, one group per planet, and
  // group messages carry planet_id). DM: its conversation id.
  const conversationIdentity = isDM
    ? `dm:${dmAgent?.id || dmConversationIdProp || dmConversationId || 'pending'}`
    : `group:${planetConfig.id || planetConfig.dbId || 'pending'}`
  const conversationIdentityRef = useRef(conversationIdentity)

  const conversationKey = isDM
    ? (dmConversationId || dmConversationIdProp || null)
    : (planet.conversationId || planetConfig.conversationId || planetConfig.dbId || null)

  useEffect(() => {
    historyKeyRef.current = conversationKey
  }, [conversationKey])

  useEffect(() => {
    if (collectTimerRef.current) {
      window.clearTimeout(collectTimerRef.current)
      collectTimerRef.current = null
    }
    if (collectRef.current) {
      readyQueueRef.current.push(collectRef.current)
      collectRef.current = null
    }
    conversationIdentityRef.current = conversationIdentity
    const currentConversationInFlight = inFlightConversationsRef.current.has(conversationIdentity)
    turnInFlightRef.current = currentConversationInFlight
    if (!currentConversationInFlight) activeTurnTokenRef.current = null
    setTurnInFlight(currentConversationInFlight)
    setTypingAgentIds([])
    setStreamingReplies({})
    drainReadyQueue()
  }, [conversationIdentity])

  useEffect(() => {
    setPlanet(prev => ({
      ...prev,
      id: planetConfig.id,
      name: planetConfig.roomName,
      groupName: planetConfig.groupName || planetConfig.roomName,
      type: planetConfig.type,
      tone: planetConfig.tone,
      background: planetConfig.background,
      dbId: planetConfig.dbId
    }))
    setSettingsDraft({ name: planetConfig.groupName || planetConfig.roomName })
    setNameEditing(false)
  }, [planetConfig.id, planetConfig.roomName, planetConfig.groupName, planetConfig.type, planetConfig.tone, planetConfig.background, planetConfig.dbId])

  useEffect(() => {
    if (isDM || !user || !planetConfig?.dbId) return
    let cancelled = false
    // Just resolve/sync the conversation id; message loading is handled by the
    // dbId loader below (group messages carry planet_id, so they load fine
    // before the conversation id resolves).
    ensureChirpConversations(user, planetConfig, agents)
      .then(nextPlanet => {
        if (!cancelled && nextPlanet?.conversationId) {
          setPlanet(prev => ({ ...prev, conversationId: nextPlanet.conversationId }))
        }
      })
      .catch(error => {
        console.warn('Failed to ensure Chirp conversations:', error)
      })
    return () => { cancelled = true }
  }, [user, planetConfig, agents])

  useEffect(() => {
    if (isDM) return
    if (previousPlanetIdRef.current === planetConfig.id) return
    previousPlanetIdRef.current = planetConfig.id
    if (collectTimerRef.current) window.clearTimeout(collectTimerRef.current)
    collectRef.current = null
    setAgents(initialAgents)
    setActiveAgentId(initialAgents[0]?.id || null)
    // Seed from this conversation's cache (instant, never another conversation's
    // content) instead of flashing the intro placeholder; the network refresh
    // below overwrites it. Arm a scroll-to-bottom for this entry.
    const cacheKey = planetConfig.conversationId || planetConfig.dbId || null
    const cached = cacheKey ? getCachedMessages(cacheKey) : null
    startTransition(() => {
      setMessages(cached || createInitialMessages(planetConfig))
    })
    setHasMoreHistory(false)
    atBottomRef.current = true
  }, [planetConfig.id, initialAgents, planetConfig])

  useEffect(() => () => {
    if (collectTimerRef.current) window.clearTimeout(collectTimerRef.current)
  }, [])

  useEffect(() => {
    if (isDM) return
    let cancelled = false
    const loadRemoteMessages = async () => {
      try {
        // Group history pages by planet_id (group messages always carry it, and
        // older rows may predate the conversation_id column) — keep this column
        // identical to the older-page fetch so scroll-up loads everything.
        const groupConversationId = planet.conversationId || planetConfig.conversationId || null
        const { messages: remoteMessages, hasMore } = await loadChirpMessages({
          dbId: planetConfig.dbId,
          conversationId: groupConversationId
        })
        if (cancelled) return
        const cacheKey = groupConversationId || planetConfig.dbId || null
        if (cacheKey) setCachedMessages(cacheKey, remoteMessages || [])
        if (groupConversationId && planetConfig.dbId) setCachedMessages(planetConfig.dbId, remoteMessages || [])
        startTransition(() => {
          setMessages(remoteMessages || [])
        })
        setHasMoreHistory(hasMore)
      } catch (error) {
        console.warn('Failed to load Chirp messages:', error)
      }
    }
    loadRemoteMessages()
    return () => { cancelled = true }
  }, [planetConfig.dbId, planetConfig.conversationId, planet.conversationId])

  useEffect(() => {
    let cancelled = false
    const loadRemoteMembers = async () => {
      try {
        const customPersonas = user ? await loadCustomPersonas(user) : []
        const remoteAgents = await loadPlanetMemberPersonas(planetConfig, getPersonasForPlanet(planetConfig), customPersonas)
        if (!cancelled) {
          setAgents(remoteAgents)
          if (user) {
            ensureChirpConversations(user, planetConfig, remoteAgents).catch(error => {
              console.warn('Failed to sync conversation members:', error)
            })
          }
        }
      } catch (error) {
        console.warn('Failed to load Planet members:', error)
      }
    }
    loadRemoteMembers()
    return () => { cancelled = true }
  }, [planetConfig.dbId, planetConfig, user])

  useEffect(() => {
    const refreshAgents = () => {
      const fallbackAgents = getPersonasForPlanet(planetConfig)
      loadCustomPersonas(user)
        .catch(() => [])
        .then(customPersonas => loadPlanetMemberPersonas(planetConfig, fallbackAgents, customPersonas))
        .then(setAgents)
        .catch(() => setAgents(fallbackAgents))
    }
    window.addEventListener('chirp:planet-personas-updated', refreshAgents)
    window.addEventListener('chirp:personas-updated', refreshAgents)
    return () => {
      window.removeEventListener('chirp:planet-personas-updated', refreshAgents)
      window.removeEventListener('chirp:personas-updated', refreshAgents)
    }
  }, [planetConfig, user])

  // Opening a DM ensures its own conversation up front (so it lists immediately
  // and never borrows a planet's id), then loads ONLY that conversation's
  // history — never planet messages.
  useEffect(() => {
    if (!isDM || !dmAgent?.id) return
    let alive = true
    atBottomRef.current = true
    setHasMoreHistory(false)

    // Fast path: the sidebar usually already knows this DM's conversation id, so
    // seed instantly from cache (no blank flash) and load its history right away
    // — the `ensure` round trip then runs in the background only to sync.
    const knownId = dmConversationIdProp || null
    setDmConversationId(knownId)
    startTransition(() => {
      setMessages((knownId && getCachedMessages(knownId)) || [])
    })

    const loadWindow = async (conversationId) => {
      const { messages: history, hasMore } = await loadChirpMessagesByConversation(conversationId)
      if (!alive) return
      setCachedMessages(conversationId, history || [])
      startTransition(() => {
        setMessages(history)
      })
      setHasMoreHistory(hasMore)
    }

    ;(async () => {
      try {
        if (knownId) {
          loadWindow(knownId).catch(error => console.warn('Failed to load DM messages:', error))
        }
        const token = await getAccessToken()
        if (!token) return
        const body = isBirdDM
          ? { conversation: { type: 'bird_dm', title: dmAgent.name }, agents: [] }
          : { conversation: { type: 'persona_dm', agentId: dmAgent.id, personaId: dmAgent.id, title: dmAgent.name }, agents: [{ id: dmAgent.id, name: dmAgent.name, role: dmAgent.role }] }
        const res = await fetch(`${getApiBase()}/api/chirp/conversations/ensure`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body)
        })
        const json = await res.json().catch(() => null)
        const conversationId = json?.conversationId || null
        if (!alive) return
        if (conversationId) {
          setDmConversationId(conversationId)
          if (conversationId !== knownId) await loadWindow(conversationId)
        }
        onDmStarted?.()
      } catch (error) {
        console.warn('Ensure DM conversation failed:', error)
      }
    })()
    return () => { alive = false }
  }, [isDM, isBirdDM, dmAgent, dmConversationIdProp])

  const bird = BIRD
  // Bird is DM-only now — it is never a member of a group. In a bird DM the
  // single member is bird; in a group / persona DM it's the user + the agents.
  const visibleMembers = [
    { id: 'user', name: userProfile.nickname || 'S', color: '#F5C878', avatar: UserAvatar },
    ...(isBirdDM ? [bird] : agents)
  ]
  const memberCount = visibleMembers.length
  const RoomAvatar = planetConfig.avatar || DeerAvatar

  const mentionItems = useMemo(() => [
    ...agents.map(agent => ({
      id: agent.id,
      label: agent.name,
      insertText: `@${agent.name} `,
      role: agent.role,
      color: agent.color,
      avatar: agent.avatar
    })),
    { id: 'bird', label: 'Bird', insertText: '@Bird ', role: isChinese ? '管理员' : 'Admin', color: bird.color, avatar: bird.avatar },
    { id: 'all', label: 'all', insertText: '@all ', role: isChinese ? '按顺序回复' : 'Replies in order', color: '#ECECEF', avatar: null }
  ], [agents, bird, isChinese])

  const filteredMentionItems = useMemo(() => {
    const normalizedQuery = mentionQuery.trim().toLowerCase()
    if (!normalizedQuery) return mentionItems
    return mentionItems.filter(item => (
      item.label.toLowerCase().includes(normalizedQuery)
      || item.role.toLowerCase().includes(normalizedQuery)
    ))
  }, [mentionItems, mentionQuery])

  const mirrorCachedMessages = (primaryKey, nextMessages, relatedMessages = []) => {
    const keys = new Set()
    if (primaryKey) keys.add(primaryKey)
    relatedMessages.forEach(message => {
      const key = getMessageCacheKey(message, null)
      if (key) keys.add(key)
    })
    keys.forEach(key => setCachedMessages(key, nextMessages))
  }

  const appendMessageToConversationCache = (primaryKey, message) => {
    const keys = new Set()
    if (primaryKey) keys.add(primaryKey)
    const messageKey = getMessageCacheKey(message, null)
    if (messageKey) keys.add(messageKey)
    keys.forEach(key => {
      updateCachedMessages(key, prev => (
        prev.some(item => item.id && item.id === message.id) ? prev : [...prev, message]
      ))
    })
  }

  const updateMessagesForRun = (runKey, updater, relatedMessages = []) => {
    if (historyKeyRef.current === runKey) {
      setMessages(prev => {
        const next = updater(prev)
        mirrorCachedMessages(runKey, next, relatedMessages)
        return next
      })
      return
    }
    const next = updateCachedMessages(runKey, updater)
    mirrorCachedMessages(runKey, next, relatedMessages)
  }

  const pushMessage = (message, options = {}) => {
    const nextMessage = { id: `${Date.now()}-${Math.random()}`, createdAt: Date.now(), ...message }
    const cacheKey = options.cacheKey || getMessageCacheKey(nextMessage, historyKeyRef.current)
    const applyToUi = options.forceUi || historyKeyRef.current === cacheKey
    if (!applyToUi) {
      appendMessageToConversationCache(cacheKey, nextMessage)
      return nextMessage
    }
    atBottomRef.current = true   // sending/receiving pins the view to the latest
    setMessages(prev => {
      const next = [...prev, nextMessage]
      mirrorCachedMessages(cacheKey, next, [nextMessage])
      return next
    })
    return nextMessage
  }

  useEffect(() => {
    if (!Object.keys(streamingReplies).length) return
    requestAnimationFrame(() => {
      if (timelineRef.current) timelineRef.current.scrollTop = timelineRef.current.scrollHeight
    })
  }, [streamingReplies])

  // Keep the view pinned to the latest message: on entry (atBottomRef armed) and
  // whenever messages change while already at the bottom. An older-page prepend
  // sets skipAutoScrollRef so we preserve the reading position instead.
  useLayoutEffect(() => {
    const el = timelineRef.current
    if (!el) return
    if (skipAutoScrollRef.current) { skipAutoScrollRef.current = false; return }
    if (atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages])

  // Scroll up near the top → load the previous page of older messages, keeping
  // the current reading position steady (no jump).
  const loadOlderHistory = async () => {
    if (loadingOlderRef.current || !hasMoreHistory) return
    const oldest = messages.find(item => item.createdAt)
    if (!oldest) return
    loadingOlderRef.current = true
    setLoadingOlder(true)
    const el = timelineRef.current
    const prevHeight = el ? el.scrollHeight : 0
    const key = historyKeyRef.current
    try {
      const { messages: older, hasMore } = await loadOlderChirpMessages({
        conversationId: isDM
          ? dmConversationId
          : (planet.conversationId || planetConfig.conversationId || null),
        planetId: isDM || planet.conversationId || planetConfig.conversationId ? null : planetConfig.dbId,
        beforeCreatedAt: new Date(oldest.createdAt).toISOString()
      })
      if (older.length) {
        skipAutoScrollRef.current = true
        setMessages(prev => {
          const merged = [...older, ...prev]
          if (key) setCachedMessages(key, merged)
          return merged
        })
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight   // preserve position
        })
      }
      setHasMoreHistory(hasMore)
    } catch (error) {
      console.warn('Failed to load older messages:', error)
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }

  const handleTimelineScroll = () => {
    const el = timelineRef.current
    if (!el) return
    atBottomRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 80
    if (el.scrollTop < 60) loadOlderHistory()
  }

  const persistMessage = (message) => {
    saveChirpMessage({ ...planetConfig, conversationId: planet.conversationId || planetConfig.conversationId }, message).catch(error => {
      console.warn('Failed to save Chirp message:', error)
    })
  }

  const rememberUserMessage = (text, timestamp = Date.now()) => {
    if (isDM) return   // a DM must not write into a planet's recent-activity cache
    writePlanetActivity(planet.id, text, timestamp)
  }

  const showToast = (text) => {
    setToast(text)
    window.setTimeout(() => setToast(''), 2200)
  }

  // Mentions count anywhere in the message (mirrors backend parseMention).
  const resolveMention = (text) => {
    if (/@all\b/i.test(text)) return 'all'
    if (/@bird\b/i.test(text)) return 'bird'
    const lower = text.toLowerCase()
    const hits = agents
      .map(agent => {
        const aliases = [agent.name, agent.id].filter(Boolean).map(alias => String(alias).toLowerCase())
        const positions = aliases.map(alias => lower.indexOf(`@${alias}`)).filter(index => index >= 0)
        return positions.length ? { id: agent.id, index: Math.min(...positions) } : null
      })
      .filter(Boolean)
      .sort((a, b) => a.index - b.index)
    return hits.length ? hits[0].id : null
  }

  const findMentionToken = (value) => {
    const match = value.match(/@([^\s@]*)$/)
    if (!match) return null
    return { start: match.index, query: match[1] || '' }
  }

  // Any input activity (typing, emoji insert) pushes back the idle window so a
  // pending batch waits for the user to actually stop.
  const markInputActivity = () => {
    const now = Date.now()
    const prev = lastActivityRef.current
    if (prev && now - prev > 1500) idleLog(`⌨️ input resumed after ${now - prev}ms quiet`)
    lastActivityRef.current = now
  }

  // IME (e.g. Chinese pinyin): while composing, the preedit string shows in the
  // box but isn't committed to `value`, so the draft reads empty. Track an
  // explicit "composing" flag so a pause on the candidate list never counts as
  // an empty, quiet box and fires a reply mid-word.
  const handleCompositionStart = () => { isComposingRef.current = true; markInputActivity() }
  const handleCompositionEnd = (event) => {
    isComposingRef.current = false
    updateInput(event.target.value)   // commit the composed text + refresh activity
  }

  const updateInput = (value) => {
    setInput(value)
    inputDraftRef.current = value
    markInputActivity()
    const mentionToken = findMentionToken(value)
    if (!mentionToken) {
      setMentionOpen(false)
      setMentionQuery('')
      setMentionIndex(0)
      return
    }
    setMentionOpen(true)
    setMentionQuery(mentionToken.query)
    setMentionIndex(0)
  }

  const insertMention = (item) => {
    const mentionToken = findMentionToken(input)
    if (!mentionToken) return
    const nextValue = `${input.slice(0, mentionToken.start)}${item.insertText}`
    setInput(nextValue)
    inputDraftRef.current = nextValue
    setMentionOpen(false)
    setMentionQuery('')
    setMentionIndex(0)
  }

  // Quoting a bubble shows it as a chip in the composer and, when it's an agent's
  // line, auto-prepends an @mention of that agent (the user can delete it). DMs
  // have a single counterpart, so the mention is pointless there.
  const startQuote = (message) => {
    setQuoting(message)
    if (isDM || message.type !== 'agent') return
    const agent = agents.find(item => item.id === message.agentId)
    if (!agent) return
    if (input.includes(`@${agent.name}`)) return
    const next = `@${agent.name} ${input}`
    setInput(next)
    inputDraftRef.current = next
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleUploadFile = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast(isChinese ? '图片大于 8MB，无法上传。' : 'Image is larger than 8MB and cannot be uploaded.')
      return
    }
    showToast(isChinese ? '暂不支持图片上传。' : 'Image upload is not available yet.')
  }

  const requestChirpTurn = async (payload) => {
    try {
      const apiBase = getApiBase()
      const token = await getAccessToken()
      if (!token) {
        return { success: false, error: 'auth_required' }
      }
      const headers = { 'Content-Type': 'application/json' }
      headers.Authorization = `Bearer ${token}`

      const response = await fetch(`${apiBase}/api/chirp/turn`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, error: `HTTP ${response.status}: ${errorText}` }
      }
      const result = await response.json()
      return result?.success ? result : { success: false, error: result?.error || 'unknown_error' }
    } catch (error) {
      console.warn('Chirp turn failed:', error)
      return { success: false, error: error.message }
    }
  }

  const buildTurnPayloadSnapshot = (texts, currentMessages, replyTo = null) => {
    const recent = getPlanetRecent(planet)
    return buildChirpTurnPayload({
      texts,
      currentMessages,
      replyTo,
      planet,
      planetConfig,
      recent,
      isDM,
      isBirdDM,
      dmAgent,
      dmConversationId,
      userProfile,
      agents,
      visibleMembers,
      tzOffset: -new Date().getTimezoneOffset()
    })
  }

  const requestChirpTurnStream = async (payload, onEvent) => {
    try {
      const apiBase = getApiBase()
      const token = await getAccessToken()
      if (!token) return { success: false, error: 'auth_required' }

      const response = await fetch(`${apiBase}/api/chirp/turn/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      })

      if (!response.ok || !response.body) {
        return { ...(await requestChirpTurn(payload)), fallback: true }
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let streamError = null

      const emitBlock = (block) => {
        const eventLine = block.split('\n').find(line => line.startsWith('event:'))
        const dataLines = block.split('\n').filter(line => line.startsWith('data:'))
        if (!eventLine || !dataLines.length) return
        const event = eventLine.slice(6).trim()
        const dataText = dataLines.map(line => line.slice(5).trimStart()).join('\n')
        const data = dataText ? JSON.parse(dataText) : null
        if (event === 'error') streamError = data?.error || 'stream_error'
        onEvent?.(event, data)
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''
        blocks.filter(Boolean).forEach(emitBlock)
      }
      buffer += decoder.decode()
      if (buffer.trim()) emitBlock(buffer)

      return streamError ? { success: false, error: streamError } : { success: true }
    } catch (error) {
      console.warn('Chirp turn stream failed:', error)
      return { ...(await requestChirpTurn(payload)), fallback: true }
    }
  }

  const addPersonaFromCommunity = () => {
    const candidate = PERSONA_POOL.find(persona => !agents.some(agent => agent.id === persona.id))
    if (!candidate) {
      showToast(isChinese ? '没有更多可添加的 persona。' : 'No more personas available.')
      return null
    }
    const nextAgents = [...agents, candidate]
    setAgents(nextAgents)
    savePlanetMemberPersonas(planetConfig, nextAgents).catch(error => console.warn('Failed to save Planet members:', error))
    showToast(isChinese ? `${candidate.name} 已加入聊天。` : `${candidate.name} joined the chat.`)
    return candidate
  }

  const runCollectedTurn = async (collected) => {
    const mention = collected.mention
    const localMessages = collected.localMessages
    const runKey = collected.conversationKey || historyKeyRef.current
    const runIdentity = collected.conversationIdentity || conversationIdentityRef.current
    const isCurrentRun = () => conversationIdentityRef.current === runIdentity
    const controlsCurrentQueue = isCurrentRun()
    const turnToken = Symbol('chirp-turn')
    inFlightConversationsRef.current.add(runIdentity)

    if (mention === 'all' || mention === 'bird') {
      setActiveAgentId(null)
    } else if (mention) {
      setActiveAgentId(mention)
    }

    if (controlsCurrentQueue) {
      setTurnInFlight(true)
      setTypingAgentIds([])
      activeTurnTokenRef.current = turnToken
      turnInFlightRef.current = true
    }
    try {
      const turn = await requestChirpTurnStream(collected.payload, (event, data) => {
      if (event === 'user_messages' && Array.isArray(data)) {
        // Reconcile each local bubble with its persisted row, in order.
        updateMessagesForRun(runKey, prev => {
          const next = [...prev]
          data.forEach((saved, index) => {
            const local = localMessages[index]
            if (!local) return
            const at = next.findIndex(message => message.id === local.id)
            if (at >= 0) next[at] = { ...next[at], id: saved.id, text: saved.text || next[at].text, isPersonalRecord: saved.isPersonalRecord }
          })
          return next
        }, data)
        return
      }

      if (!isCurrentRun()) {
        if (event === 'agent_message' && data?.message) {
          appendMessageToConversationCache(runKey, data.message)
        }
        return
      }

      if (event === 'agent_started' && data?.target?.agentId) {
        setTypingAgentIds(prev => Array.from(new Set([...prev, data.target.agentId])))
        return
      }

      if (event === 'agent_delta' && data?.target?.agentId && data.delta) {
        // First token arrived: swap typing bubble for the live streaming bubble.
        setTypingAgentIds(prev => prev.filter(id => id !== data.target.agentId))
        setStreamingReplies(prev => ({
          ...prev,
          [data.index]: {
            agentId: data.target.agentId,
            text: (prev[data.index]?.text || '') + data.delta
          }
        }))
        return
      }

      if (event === 'agent_reset' && data?.target?.agentId) {
        // The pass turned out to be an internal tool call; discard partial text.
        setStreamingReplies(prev => {
          const next = { ...prev }
          delete next[data.index]
          return next
        })
        setTypingAgentIds(prev => Array.from(new Set([...prev, data.target.agentId])))
        return
      }

      if (event === 'agent_finished' && data?.target?.agentId) {
        setTypingAgentIds(prev => prev.filter(id => id !== data.target.agentId))
        return
      }

      if (event === 'agent_error' && data?.target) {
        setStreamingReplies(prev => {
          const next = { ...prev }
          delete next[data.index]
          return next
        })
        return
      }

      if (event === 'agent_message' && data?.message) {
        const message = data.message
        setStreamingReplies(prev => {
          const next = { ...prev }
          delete next[data.index]
          return next
        })
        if (message.text) pushMessage(message, { cacheKey: runKey, forceUi: true })
      }
    }, collected.replyTo)

      if (isCurrentRun()) {
        setTypingAgentIds([])
        setStreamingReplies({})
      }

      if (!turn?.success) {
        const authError = turn?.error === 'auth_required' || String(turn?.error || '').includes('401')
        if (isCurrentRun()) {
          showToast(authError
        ? (isChinese ? '请先登录后再聊天。' : 'Please sign in before chatting.')
        : (isChinese ? `AI 连接失败：${turn?.error || 'unknown'}` : `AI connection failed: ${turn?.error || 'unknown'}`))
        }
      } else if (turn.messages?.length) {
        // Non-stream fallback: reconcile local bubbles with persisted rows in order.
        const returnedUserMessages = turn.messages.filter(message => message.type === 'user' || message.type === 'memo')
        if (returnedUserMessages.length) {
          updateMessagesForRun(runKey, prev => {
            const next = [...prev]
            returnedUserMessages.forEach((saved, index) => {
              const local = localMessages[index]
              if (!local) return
              const at = next.findIndex(message => message.id === local.id)
              if (at >= 0) next[at] = { ...next[at], id: saved.id, text: saved.text || next[at].text, isPersonalRecord: saved.isPersonalRecord }
            })
            return next
          }, returnedUserMessages)
        }

        for (const message of turn.messages.filter(item => item.type === 'agent')) {
          if (message.text) pushMessage(message, { cacheKey: runKey, forceUi: isCurrentRun() })
        }
      }

    // A DM's conversation is created on its first message — tell the host so the
      // left list can show it without a manual refresh.
      if (isDM) onDmStarted?.()
    } finally {
      // After a reply finishes or fails locally, run anything that queued up.
      inFlightConversationsRef.current.delete(runIdentity)
      if (isCurrentRun()) {
        const stillCurrentConversationInFlight = inFlightConversationsRef.current.has(runIdentity)
        setTurnInFlight(stillCurrentConversationInFlight)
        turnInFlightRef.current = stillCurrentConversationInFlight
        if (controlsCurrentQueue && activeTurnTokenRef.current === turnToken) activeTurnTokenRef.current = null
        setTypingAgentIds([])
        setStreamingReplies({})
      }
      drainReadyQueue()
    }
  }

  const drainReadyQueue = () => {
    const next = takeNextReadyTurn(readyQueueRef.current, inFlightConversationsRef.current)
    if (!next) return
    runCollectedTurn(next)   // sets the in-flight flag; calls drainReadyQueue again when done
  }

  const sealCurrentBatch = () => {
    if (collectTimerRef.current) { window.clearTimeout(collectTimerRef.current); collectTimerRef.current = null }
    if (!collectRef.current) return
    readyQueueRef.current.push(collectRef.current)
    collectRef.current = null
    idleLog(`➡️ queued batch | replyInFlight=${turnInFlightRef.current} | queueLen=${readyQueueRef.current.length}`)
    drainReadyQueue()
  }

  // The whole reply-timing mechanism: fire only once the user has gone quiet —  // no input activity for IDLE_MS and the input box empty —else re-check soon.
  // (In-flight ordering is handled by the ready queue, not here.)
  const armIdleCheck = () => {
    if (collectTimerRef.current) window.clearTimeout(collectTimerRef.current)
    collectTimerRef.current = window.setTimeout(maybeFireCollected, IDLE_POLL_MS)
  }

  const maybeFireCollected = () => {
    collectTimerRef.current = null
    if (!collectRef.current) return
    const quietFor = Date.now() - lastActivityRef.current
    // Composing (IME preedit) or any committed draft text both count as "still
    // typing" — never reply while the user is mid-word, even if the candidate
    // list has been open silently past the idle window.
    const stillTyping = isComposingRef.current || inputDraftRef.current.trim().length > 0
    if (stillTyping || quietFor < IDLE_MS) {
      armIdleCheck()
      return
    }
    idleLog(`🔒 SEAL after ${quietFor}ms quiet | batch [${collectRef.current.texts.join(' | ')}]`)
    sealCurrentBatch()
  }

  // A quoted bubble becomes a structured replyTo for the backend (it
  // resolves the text by id; we send only id + who).
  const buildReplyTo = (message) => {
    if (!message?.id) return null
    const agentRole = message.type === 'agent'
      ? (message.agentId === 'bird' ? 'bird' : 'persona')
      : 'user'
    return { id: message.id, agentRole, agentId: message.agentId }
  }

  const queueCollectedMessage = (text) => {
    const mention = resolveMention(text)
    const timestamp = Date.now()
    const gapSinceActivity = lastActivityRef.current ? timestamp - lastActivityRef.current : null
    // Snippet shown above the sent bubble so the user sees what they replied to.
    const quoted = quoting ? {
      author: quoting.type === 'agent'
        ? (agents.find(agent => agent.id === quoting.agentId)?.name || quoting.agentId)
        : (isChinese ? '我' : 'Me'),
      text: quoting.text || ''
    } : null
    // The snapshot + which batch index carries it ride along on replyTo so the
    // backend can persist the quote chip on the right message.
    const batchIndex = collectRef.current ? collectRef.current.texts.length : 0
    const replyTo = quoting ? { ...buildReplyTo(quoting), snapshot: quoted, index: batchIndex } : null

    setInput('')
    inputDraftRef.current = ''
    lastActivityRef.current = timestamp   // the send itself starts the idle clock
    setMentionOpen(false)
    setMentionQuery('')
    setMentionIndex(0)
    rememberUserMessage(text, timestamp)

    // Each send is its own bubble (like a real chat). Batching is purely
    // time-based: every message sent within the idle window joins one batch and
    // is read as a single expression — no @-target ever splits it. The backend
    // routes the combined text, so a batch may go to one persona, several, or be
    // ambient. We track only the latest explicit @ to focus the UI.
    const localUserMessage = mention
      ? pushMessage({ type: 'user', text, read: true, createdAt: timestamp, quoted })
      : pushMessage({ type: 'user', text, isPersonalRecord: true, createdAt: timestamp, quoted })

    const wasOpen = !!collectRef.current
    if (collectRef.current) {
      collectRef.current.texts.push(text)
      collectRef.current.localMessages.push(localUserMessage)
      collectRef.current.payload.texts = [...collectRef.current.texts]
      if (mention) collectRef.current.mention = mention
      if (replyTo) {
        collectRef.current.replyTo = replyTo
        collectRef.current.payload.replyTo = replyTo
      }
    } else {
      const texts = [text]
      collectRef.current = {
        texts,
        mention,
        replyTo,
        localMessages: [localUserMessage],
        baseMessages: messages,
        payload: buildTurnPayloadSnapshot(texts, messages, replyTo),
        conversationKey: historyKeyRef.current,
        conversationIdentity: conversationIdentityRef.current
      }
    }
    if (quoting) setQuoting(null)
    idleLog(`📤 send "${text}" | gap since last activity ${gapSinceActivity ?? 'n/a'}ms | ${wasOpen ? `JOINED batch (now ${collectRef.current.texts.length})` : 'started NEW batch'} | mention=${mention || 'none'}`)
    armIdleCheck()
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text) return
    queueCollectedMessage(text)   // never blocks; batches/queues instead of erroring
  }

  const removeAgent = (agentId) => {
    const removed = agents.find(agent => agent.id === agentId)
    const nextAgents = agents.filter(agent => agent.id !== agentId)
    setAgents(nextAgents)
    savePlanetMemberPersonas(planetConfig, nextAgents).catch(error => console.warn('Failed to save Planet members:', error))
    if (activeAgentId === removed?.id) setActiveAgentId(null)
  }

  const openSettings = () => {
    setSettingsDraft({ name: planet.groupName || planet.name })
    setNameEditing(false)
    setSettingsOpen(true)
  }

  const closeSettings = () => {
    setSettingsDraft({ name: planet.groupName || planet.name })
    setNameEditing(false)
    setSettingsOpen(false)
  }

  // Edit/Save toggle for the GROUP CHAT name only. The group name lives on the
  // conversation (and a separate planet-meta field) — it is NOT the planet name,
  // so renaming the group never touches the planet/folder name.
  const startNameEdit = () => {
    setSettingsDraft({ name: planet.groupName || planet.name })
    setNameEditing(true)
  }

  const commitName = () => {
    const nextName = settingsDraft.name.trim() || (planet.groupName || planet.name)
    setPlanet(prev => ({ ...prev, groupName: nextName }))          // header
    savePlanetMeta(planet.id, { groupName: nextName })             // sidebar group child (via event) + local persist
    updateChirpConversationTitle(planet.conversationId || planetConfig.conversationId, nextName).catch(() => {})
    setSettingsDraft({ name: nextName })
    setNameEditing(false)
  }

  return (
    <div className="chirp-page" style={{ '--chirp-paper': planet.background }}>
      {IDLE_DEBUG && (
        <div style={{ position: 'fixed', left: 8, bottom: 8, zIndex: 9999, width: 'min(94vw, 600px)', maxHeight: '42vh', overflowY: 'auto', background: 'rgba(0,0,0,0.85)', color: '#7CFC00', font: '11px/1.45 ui-monospace, Menlo, Consolas, monospace', padding: '8px 10px', borderRadius: 8, whiteSpace: 'pre-wrap' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, color: '#fff' }}>
            <b>idle debug ? IDLE_MS={IDLE_MS}</b>
            <span>
              <button onClick={() => { navigator.clipboard?.writeText(idleEvents.join('\n')); showToast(isChinese ? '日志已复制' : 'Log copied') }} style={{ background: '#2a6', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', marginRight: 6 }}>copy</button>
              <button onClick={() => setIdleEvents([])} style={{ background: '#444', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>clear</button>
            </span>
          </div>
          {idleEvents.length === 0
            ? <div style={{ color: '#888' }}>Send a message to see idle batching logs.</div>
            : idleEvents.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
      <div className="chirp-shell">
        <header className="chirp-topbar">
          {onBack && (
            <button className="chirp-back" aria-label={isChinese ? '返回' : 'Back'} onClick={onBack}>
              <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
            </button>
          )}
          {isDM
            ? <span className="chirp-group-title chirp-dm-title">{dmAgent.name}</span>
            : <button className="chirp-group-title" onClick={openSettings}><span>{(planet.groupName || planet.name)} ({memberCount})</span></button>}
          {!isDM && (
            <button className="chirp-more" onClick={openSettings} aria-label={isChinese ? '群聊设置' : 'Group settings'}>
              <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
            </button>
          )}
        </header>

        <main className={`chirp-main ${settingsOpen ? 'settings-open' : ''}`}>
          <section className="chirp-chat">
            <div className="chirp-timeline" ref={timelineRef} onScroll={handleTimelineScroll}>
              {loadingOlder && <div className="chirp-history-loading">{isChinese ? '加载更早的消息…' : 'Loading earlier messages…'}</div>}
              {messages.map((message, index) => {
                // WeChat-style time separator: before the first dated message, on a
                // day change, or after a gap > 5 min from the previous one.
                const prev = messages[index - 1]
                const showSeparator = message.type !== 'system' && !!message.createdAt && (
                  !prev
                  || !prev.createdAt
                  || (message.createdAt - prev.createdAt) > 5 * 60 * 1000
                  || new Date(message.createdAt).toDateString() !== new Date(prev.createdAt).toDateString()
                )
                return (
                  <Fragment key={message.id}>
                    {showSeparator && <div className="chirp-date">{formatChatSeparator(message.createdAt, language)}</div>}
                    <MessageBubble message={message} agents={agents} bird={bird} language={language} onQuote={startQuote} onOpenPersona={onOpenPersona} isDM={isDM} />
                  </Fragment>
                )
              })}
              {Object.entries(streamingReplies).map(([index, entry]) => (
                <StreamingBubble key={`stream-${index}`} agent={[...agents, bird].find(agent => agent.id === entry.agentId)} text={entry.text} isDM={isDM} />
              ))}
              {typingAgentIds.map(agentId => <TypingBubble key={agentId} agent={[...agents, bird].find(agent => agent.id === agentId)} />)}
            </div>

            <footer className="chirp-composer">
              <div className="chirp-composer-box">
                <input ref={fileInputRef} className="chirp-file-input" type="file" accept="image/*" onChange={handleUploadFile} />
                {quoting && (
                  <div className="chirp-quote-bar">
                    <div className="chirp-quote-bar-text">
                      <span className="chirp-quote-bar-author">{quoting.type === 'agent' ? (agents.find(a => a.id === quoting.agentId)?.name || quoting.agentId) : (isChinese ? '我' : 'Me')}: </span>
                      <span className="chirp-quote-bar-snippet">{quoting.text || ''}</span>
                    </div>
                    <button className="chirp-quote-bar-close" onClick={() => setQuoting(null)} aria-label={isChinese ? '取消引用' : 'Cancel quote'}>x</button>
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  className="chirp-composer-textarea"
                  rows="1"
                  value={input}
                  onChange={(event) => updateInput(event.target.value)}
                  onCompositionStart={handleCompositionStart}
                  onCompositionUpdate={markInputActivity}
                  onCompositionEnd={handleCompositionEnd}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      if (mentionOpen && filteredMentionItems.length > 0) {
                        event.preventDefault()
                        insertMention(filteredMentionItems[mentionIndex])
                        return
                      }
                      event.preventDefault()
                      handleSend()
                    }
                    if (mentionOpen && filteredMentionItems.length > 0 && event.key === 'ArrowDown') {
                      event.preventDefault()
                      setMentionIndex(index => (index + 1) % filteredMentionItems.length)
                    }
                    if (mentionOpen && filteredMentionItems.length > 0 && event.key === 'ArrowUp') {
                      event.preventDefault()
                      setMentionIndex(index => (index - 1 + filteredMentionItems.length) % filteredMentionItems.length)
                    }
                    if (mentionOpen && event.key === 'Escape') {
                      event.preventDefault()
                      setMentionOpen(false)
                    }
                  }}
                  placeholder={isChinese ? '@ 开始对话' : '@ to start a conversation'}
                />
                <div className="chirp-composer-bar">
                  <button className="chirp-upload-button" type="button" aria-label={isChinese ? '上传图片' : 'Upload image'} onClick={() => fileInputRef.current?.click()}>+</button>
                  <button className="chirp-send" onClick={handleSend} aria-label={isChinese ? '发送' : 'Send'}>
                    <svg viewBox="0 0 24 24"><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></svg>
                  </button>
                </div>
                {mentionOpen && filteredMentionItems.length > 0 && (
                  <div className="chirp-mention-menu">
                    {filteredMentionItems.map((item, index) => (
                      <button
                        key={item.id}
                        className={index === mentionIndex ? 'is-active' : ''}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault()
                          insertMention(item)
                        }}
                      >
                        <span className="chirp-mention-avatar" style={{ backgroundColor: item.color }}>
                          {item.avatar ? <PersonaAvatar persona={item} /> : 'all'}
                        </span>
                        <span><strong>{item.label}</strong><small>{item.role}</small></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </footer>
          </section>

          {settingsOpen && <button className="chirp-settings-scrim" type="button" aria-label={isChinese ? '关闭设置' : 'Close settings'} onClick={closeSettings} />}

          <aside className="chirp-settings">
            <div className="chirp-settings-body">
              <section>
                <h3>{isChinese ? '成员' : 'Members'}</h3>
                <div className="chirp-members-grid">
                  {visibleMembers.map(member => {
                    // A group needs at least 3 members, so removal is only offered
                    // once we are above that floor; the user (self) is never removable.
                    const removable = member.id !== 'user' && memberCount > 3
                    return (
                      <div className="chirp-member" key={member.id}>
                        <div className="chirp-member-avatar-wrap">
                          <div className="chirp-member-avatar" style={{ backgroundColor: member.color }}><PersonaAvatar persona={member} /></div>
                          {removable && (
                            <button
                              type="button"
                              className="chirp-member-remove"
                              onClick={() => removeAgent(member.id)}
                              aria-label={isChinese ? `移除 ${member.name}` : `Remove ${member.name}`}
                            >x</button>
                          )}
                        </div>
                        <span>{member.name}</span>
                      </div>
                    )
                  })}
                  <button className="chirp-member-action" onClick={addPersonaFromCommunity} aria-label={isChinese ? '添加成员' : 'Add member'}><b>+</b></button>
                </div>
              </section>

              <section>
                <h3>{isChinese ? '群聊名称' : 'Group Name'}</h3>
                <div className="chirp-group-name-row">
                  <input
                    className="chirp-group-name-input"
                    value={nameEditing ? settingsDraft.name : (planet.groupName || planet.name)}
                    onChange={(event) => setSettingsDraft({ name: event.target.value })}
                    disabled={!nameEditing}
                    placeholder={isChinese ? '群聊名称' : 'Group name'}
                    aria-label={isChinese ? '群聊名称' : 'Group name'}
                  />
                  <button
                    type="button"
                    className="chirp-group-name-btn"
                    onClick={nameEditing ? commitName : startNameEdit}
                  >
                    {nameEditing ? (isChinese ? '保存' : 'Save') : (isChinese ? '编辑' : 'Edit')}
                  </button>
                </div>
              </section>
            </div>

          </aside>
        </main>
        {toast && <div className="chirp-toast">{toast}</div>}
      </div>
    </div>
  )
}

const MessageBubble = memo(function MessageBubble({ message, agents, bird, language, onQuote, onOpenPersona, isDM }) {
  if (message.type === 'system') return null
  // A reply icon appears on hover; clicking it quotes this
  // bubble into the composer.
  const replyButton = (
    <button
      type="button"
      className="chirp-msg-reply"
      onClick={() => onQuote?.(message)}
      aria-label={language === 'zh' ? '引用回复' : 'Reply'}
      title={language === 'zh' ? '引用回复' : 'Reply'}
    >
      <ReplyIcon />
    </button>
  )
  // Personal records (memo) render exactly like normal user messages —  // the classification is backend-only (framework v2: 个人记录不做特殊 UI).
  if (message.type === 'memo' || message.type === 'user') {
    return (
      <div className="chirp-message user">
        <div className="chirp-user-message-body">
          <div className="chirp-bubble-row">
            {replyButton}
            <div className="chirp-bubble-stack">
              {message.quoted && (
                <div className="chirp-quoted-ref">
                  <span className="chirp-quoted-ref-author">{message.quoted.author}: </span>
                  {message.quoted.text}
                </div>
              )}
              <div className="chirp-bubble">{message.text}</div>
            </div>
          </div>
          {message.read && <span className="chirp-read-receipt">{formatMessageTime(new Date(message.createdAt))} {language === 'zh' ? '已读' : 'Read'}</span>}
        </div>
        <div className="chirp-user-side-avatar"><UserAvatar /></div>
      </div>
    )
  }

  const agent = [...agents, bird].find(item => item.id === message.agentId)
  if (!agent) return null
  const openProfile = agent.id !== 'bird' && onOpenPersona ? () => onOpenPersona(agent.id) : undefined
  return (
    <div className="chirp-message agent">
      <div
        className="chirp-agent-side-avatar"
        style={{ backgroundColor: agent.color, cursor: openProfile ? 'pointer' : 'default' }}
        onClick={openProfile}
        role={openProfile ? 'button' : undefined}
        title={openProfile ? agent.name : undefined}
      ><PersonaAvatar persona={agent} /></div>
      <div className="chirp-agent-message-body">
        {!isDM && <span className="chirp-agent-name">{agent.name}</span>}
        <div className="chirp-bubble-row">
          <div className="chirp-bubble">{message.text}</div>
          {replyButton}
        </div>
      </div>
    </div>
  )
}, (prev, next) => (
  prev.message === next.message
  && prev.agents === next.agents
  && prev.bird === next.bird
  && prev.language === next.language
  && prev.isDM === next.isDM
  && prev.onOpenPersona === next.onOpenPersona
))

function ReplyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}

function TypingBubble({ agent }) {
  if (!agent) return null
  return (
    <div className="chirp-message agent">
      <div className="chirp-agent-side-avatar" style={{ backgroundColor: agent.color }}><PersonaAvatar persona={agent} /></div>
      <div className="chirp-agent-message-body"><div className="chirp-bubble typing"><i></i><i></i><i></i></div></div>
    </div>
  )
}

function StreamingBubble({ agent, text, isDM }) {
  if (!agent || !text) return null
  // Multi-bubble replies stream with ||| separators; render live as bubbles.
  const parts = text.split(/\s*\|\|\|\s*/).filter(Boolean)
  return (
    <div className="chirp-message agent">
      <div className="chirp-agent-side-avatar" style={{ backgroundColor: agent.color }}><PersonaAvatar persona={agent} /></div>
      <div className="chirp-agent-message-body">
        {!isDM && <span className="chirp-agent-name">{agent.name}</span>}
        {parts.map((part, index) => (
          <div className="chirp-bubble" key={index} style={index > 0 ? { marginTop: 6 } : undefined}>{part}</div>
        ))}
      </div>
    </div>
  )
}

export default ChirpPage
