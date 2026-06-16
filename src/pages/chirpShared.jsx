const ACTIVITY_KEY = 'chirpPlanetActivity'
const CUSTOM_PERSONAS_KEY = 'chirpCustomPersonas'
const PLANET_PERSONAS_KEY = 'chirpPlanetPersonas'
const PLANET_META_KEY = 'chirpPlanetMeta'

export const formatMessageTime = (date = new Date()) => (
  new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
)

// WeChat-style in-timeline separator: relative day + time, e.g. "14:45",
// "昨天 14:45", "6月12日 14:45" (zh) / "Yesterday 14:45", "Jun 12 14:45" (en).
export const formatChatSeparator = (timestamp, language = 'zh') => {
  const date = new Date(timestamp)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
  const value = date.getTime()
  const hm = formatMessageTime(date)
  if (value >= startOfToday) return hm
  if (value >= startOfYesterday) return `${language === 'zh' ? '昨天' : 'Yesterday'} ${hm}`
  const sameYear = date.getFullYear() === now.getFullYear()
  const datePart = language === 'zh'
    ? new Intl.DateTimeFormat('zh-CN', sameYear ? { month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
    : new Intl.DateTimeFormat('en-US', sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
  return `${datePart} ${hm}`
}

export const formatActivityTime = (timestamp, fallback = '') => {
  if (!timestamp) return fallback

  const date = new Date(timestamp)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
  const value = date.getTime()

  if (value >= startOfToday) return formatMessageTime(date)
  if (value >= startOfYesterday) return 'Yesterday'

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric'
  }).format(date)
}

export const truncateRecentMessage = (text = '', limit = 25) => {
  const clean = String(text).replace(/\s+/g, ' ').trim()
  if (!clean) return ''

  const hasCjk = /[\u3400-\u9FFF]/.test(clean)
  if (hasCjk) return clean.length > limit ? `${clean.slice(0, limit)}...` : clean

  const words = clean.split(' ')
  return words.length > limit ? `${words.slice(0, limit).join(' ')}...` : clean
}

export const truncateWords = (text = '', limit = 6) => {
  const clean = String(text).replace(/\s+/g, ' ').trim()
  if (!clean) return ''

  const hasCjk = /[\u3400-\u9FFF]/.test(clean)
  if (hasCjk) return clean.length > limit ? `${clean.slice(0, limit)}...` : clean

  const words = clean.split(' ')
  return words.length > limit ? `${words.slice(0, limit).join(' ')}...` : clean
}

export const truncateTitle = (text = '', limit = 4) => truncateWords(text, limit)

const readJson = (key, fallback) => {
  if (typeof window === 'undefined') return fallback
  try {
    return JSON.parse(window.localStorage.getItem(key) || JSON.stringify(fallback))
  } catch {
    return fallback
  }
}

const writeJson = (key, value) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const hexToRgb = (hex = '#F5C878') => {
  const clean = String(hex).replace('#', '').trim()
  const value = clean.length === 3
    ? clean.split('').map(char => char + char).join('')
    : clean.padEnd(6, '0').slice(0, 6)
  const int = Number.parseInt(value, 16)
  if (Number.isNaN(int)) return { r: 245, g: 200, b: 120 }
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255
  }
}

const rgbToHsl = ({ r, g, b }) => {
  const r1 = r / 255
  const g1 = g / 255
  const b1 = b / 255
  const max = Math.max(r1, g1, b1)
  const min = Math.min(r1, g1, b1)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r1) h = (g1 - b1) / d + (g1 < b1 ? 6 : 0)
    if (max === g1) h = (b1 - r1) / d + 2
    if (max === b1) h = (r1 - g1) / d + 4
    h *= 60
  }

  return { h, s: s * 100, l: l * 100 }
}

const hsl = (h, s, l) => `hsl(${Math.round((h + 360) % 360)} ${Math.round(s)}% ${Math.round(l)}%)`

export const buildPersonaTheme = (baseColor = '#F5C878') => {
  const { h, s, l } = rgbToHsl(hexToRgb(baseColor))
  const saturation = clamp(s * 0.48, 20, 38)
  const warmShift = l < 42 ? 8 : -6

  return {
    avatar: hsl(h, clamp(s * 0.62, 28, 54), clamp(l + 18, 68, 84)),
    card: [
      hsl(h + warmShift, saturation, 88),
      hsl(h + 14, clamp(saturation + 3, 22, 42), 82),
      hsl(h + 32, clamp(saturation - 2, 18, 36), 86)
    ]
  }
}

export const getPersonaTheme = (persona) => persona?.theme || buildPersonaTheme(persona?.color)

export const readPlanetActivity = () => readJson(ACTIVITY_KEY, {})

export const writePlanetActivity = (planetId, message, timestamp = Date.now()) => {
  if (typeof window === 'undefined' || !planetId || !message) return

  const next = {
    ...readPlanetActivity(),
    [planetId]: {
      text: truncateRecentMessage(message, 25),
      rawText: message,
      timestamp,
      time: formatActivityTime(timestamp)
    }
  }

  writeJson(ACTIVITY_KEY, next)
  window.dispatchEvent(new CustomEvent('chirp:planet-activity', { detail: { planetId, activity: next[planetId] } }))
}

export const getPlanetRecent = (planet) => {
  const activity = readPlanetActivity()[planet.id]
  if (activity?.text) {
    return {
      ...activity,
      time: formatActivityTime(activity.timestamp, activity.time)
    }
  }
  return {
    text: truncateRecentMessage(planet.recent, 25),
    rawText: planet.recent,
    timestamp: null,
    time: planet.time
  }
}

export const DeerAvatar = () => (
  <svg viewBox="0 0 64 64" className="chirp-avatar-svg" aria-hidden="true">
    <path d="M20 24c-5-8-9-9-12-7" />
    <path d="M44 24c5-8 9-9 12-7" />
    <path d="M25 17c-2-7-6-9-10-9" />
    <path d="M39 17c2-7 6-9 10-9" />
    <ellipse cx="32" cy="36" rx="17" ry="15" />
    <circle cx="25" cy="34" r="2.5" />
    <circle cx="39" cy="34" r="2.5" />
    <path d="M29 42c2 2 4 2 6 0" />
  </svg>
)

export const BirdAvatar = () => (
  <svg viewBox="0 0 100 100" className="chirp-avatar-svg" aria-hidden="true">
    <path d="M30 58 C30 46 38 34 52 34 C66 34 74 44 72 56 C70 66 60 70 48 70 C38 70 30 66 30 58 Z" />
    <path d="M30 62 L18 66 L24 70 Z" />
    <circle cx="58" cy="44" r="2.5" />
    <path d="M70 48 L80 46 L72 53 Z" />
    <path d="M44 56 Q50 52 58 56" />
    <path d="M44 70 L44 76" />
    <path d="M54 70 L54 76" />
    <path d="M12 80 Q50 84 90 76" />
    <path d="M78 75 Q82 70 86 73 Q84 78 78 75 Z" />
    <path d="M22 24 L22 28 M19 26 L25 26" />
  </svg>
)

export const CatAvatar = () => (
  <svg viewBox="0 0 64 64" className="chirp-avatar-svg" aria-hidden="true">
    <path d="M18 25 15 10l13 9" />
    <path d="M46 25 49 10l-13 9" />
    <path d="M16 34c0-12 8-19 16-19s16 7 16 19-7 18-16 18-16-6-16-18z" />
    <circle cx="25" cy="34" r="2.5" />
    <circle cx="39" cy="34" r="2.5" />
    <path d="M32 39v4" />
    <path d="M25 45c4 3 10 3 14 0" />
  </svg>
)

export const FoxAvatar = () => (
  <svg viewBox="0 0 64 64" className="chirp-avatar-svg" aria-hidden="true">
    <path d="M12 25 22 9l10 11L42 9l10 16c1 17-7 27-20 27S11 42 12 25z" />
    <circle cx="25" cy="32" r="2.5" />
    <circle cx="39" cy="32" r="2.5" />
    <path d="M28 40c2 2 6 2 8 0" />
  </svg>
)

export const OwlAvatar = () => (
  <svg viewBox="0 0 64 64" className="chirp-avatar-svg" aria-hidden="true">
    <path d="M17 23 13 12l11 5c5-3 11-3 16 0l11-5-4 11c4 5 5 13 2 19-4 9-13 12-17 12S19 51 15 42c-3-6-2-14 2-19z" />
    <circle cx="25" cy="33" r="5" />
    <circle cx="39" cy="33" r="5" />
    <path d="M30 42h4" />
  </svg>
)

export const RabbitAvatar = () => (
  <svg viewBox="0 0 64 64" className="chirp-avatar-svg" aria-hidden="true">
    <path d="M23 23C18 9 19 3 24 3s7 8 7 18" />
    <path d="M41 23C46 9 45 3 40 3s-7 8-7 18" />
    <ellipse cx="32" cy="39" rx="17" ry="15" />
    <circle cx="25" cy="37" r="2.5" />
    <circle cx="39" cy="37" r="2.5" />
    <path d="M28 45c2 2 6 2 8 0" />
  </svg>
)

export function UserAvatar() {
  return <span className="chirp-user-photo" aria-label="User avatar">S</span>
}

export const PersonaAvatar = ({ persona }) => {
  if (persona?.avatarUrl) return <img className="chirp-persona-img" src={persona.avatarUrl} alt="" />
  const Avatar = persona?.avatar || CatAvatar
  return <Avatar />
}

export const PERSONA_POOL = [
  {
    id: 'danzong',
    name: '诞总',
    role: '解构松弛',
    color: '#E8A29C',
    avatar: CatAvatar,
    emoji: '.',
    pricing: 'free',
    usageCount: 0,
    description: 'A relaxed, anti-chicken-soup perspective inspired by public stand-up expression. Placeholder content for the persona machine.',
    systemPrompt: 'You are 诞总, a relaxed friend who gently deconstructs overthinking without pretending to be any real person.'
  },
  {
    id: 'barry',
    name: 'Barry',
    role: '共情陪伴',
    color: '#EBA7B5',
    avatar: RabbitAvatar,
    emoji: '<3',
    pricing: 'free',
    usageCount: 0,
    description: 'A placeholder companion voice for emotional landing and warmth in intimate relationship conversations.',
    systemPrompt: 'You are Barry. First catch the user emotionally, then offer one grounded observation.'
  },
  {
    id: 'duck',
    name: 'duck',
    role: '策略军师',
    color: '#A9C9DF',
    avatar: FoxAvatar,
    emoji: '.',
    pricing: 'free',
    usageCount: 0,
    description: 'A placeholder strategy voice that separates facts, assumptions, and next moves.',
    systemPrompt: 'You are duck. Separate facts, assumptions, evidence, and next moves. Reply calmly and directly.'
  }
]
export const BIRD = {
  id: 'bird',
  name: 'Bird',
  role: 'Observer',
  color: '#DCC4EA',
  avatar: BirdAvatar
}

export const CHIRP_PLANETS = [
  {
    id: 'love',
    type: 'love',
    name: '恋爱',
    roomName: 'my crush...',
    tone: 'relationship, romantic uncertainty, attachment, emotional reading',
    color: '#E8A29C',
    background: '#FAFAF7',
    cardClass: 'love',
    avatar: CatAvatar,
    agents: ['danzong', 'barry', 'duck'],
    recent: 'You said you didn\'t mind...',
    time: '12:42'
  }
]
export const readPlanetMeta = () => readJson(PLANET_META_KEY, {})

export const savePlanetMeta = (planetId, patch) => {
  if (!planetId) return null
  const current = readPlanetMeta()
  const nextPlanet = {
    ...(current[planetId] || {}),
    ...patch,
    updatedAt: Date.now()
  }
  const next = { ...current, [planetId]: nextPlanet }
  writeJson(PLANET_META_KEY, next)
  window.dispatchEvent(new CustomEvent('chirp:planet-meta-updated', { detail: { planetId, meta: nextPlanet } }))
  return nextPlanet
}

export const hydratePlanet = (planet) => {
  const meta = readPlanetMeta()[planet.id] || {}
  return {
    ...planet,
    ...meta,
    roomName: meta.roomName || planet.roomName,           // planet (folder) name
    cardTitle: meta.cardTitle || meta.roomName || planet.cardTitle,
    // group chat name — separate from the planet name; defaults to the room name
    groupName: meta.groupName || planet.groupName || meta.roomName || planet.roomName
  }
}

export const getAllPlanets = () => CHIRP_PLANETS.map(hydratePlanet)

export const readCustomPersonas = () => readJson(CUSTOM_PERSONAS_KEY, [])

export const saveCustomPersona = (persona) => {
  const next = [persona, ...readCustomPersonas()]
  writeJson(CUSTOM_PERSONAS_KEY, next)
  window.dispatchEvent(new CustomEvent('chirp:personas-updated'))
  return persona
}

const hydratePersona = (persona) => ({
  ...persona,
  avatar: persona.avatar || CatAvatar,
  color: persona.color || '#F5C878',
  theme: buildPersonaTheme(persona.color || '#F5C878'),
  role: persona.role || 'custom persona',
  pricing: persona.pricing || 'free',
  usageCount: persona.usageCount || 0
})

export const getAllPersonas = () => [
  ...PERSONA_POOL.map(hydratePersona),
  ...readCustomPersonas().map(hydratePersona)
]

export const readPlanetPersonaIds = () => readJson(PLANET_PERSONAS_KEY, {})

export const addPersonaToPlanet = (planetId, personaId) => {
  const current = readPlanetPersonaIds()
  const nextIds = Array.from(new Set([...(current[planetId] || []), personaId]))
  const next = { ...current, [planetId]: nextIds }
  writeJson(PLANET_PERSONAS_KEY, next)
  window.dispatchEvent(new CustomEvent('chirp:planet-personas-updated', { detail: { planetId, personaId } }))
}

export const removePersonaFromPlanet = (planetId, personaId) => {
  const current = readPlanetPersonaIds()
  const next = {
    ...current,
    [planetId]: (current[planetId] || []).filter(id => id !== personaId)
  }
  writeJson(PLANET_PERSONAS_KEY, next)
  window.dispatchEvent(new CustomEvent('chirp:planet-personas-updated', { detail: { planetId, personaId } }))
}

export const getPlanetById = (planetId) => hydratePlanet(
  CHIRP_PLANETS.find(planet => planet.id === planetId) || CHIRP_PLANETS[0]
)

export const getPersonasForPlanet = (planet) => {
  const defaultIds = planet?.agents || CHIRP_PLANETS[0].agents
  const addedIds = readPlanetPersonaIds()[planet?.id] || []
  const allPersonas = getAllPersonas()

  return Array.from(new Set([...defaultIds, ...addedIds]))
    .map(id => allPersonas.find(persona => persona.id === id))
    .filter(Boolean)
}
