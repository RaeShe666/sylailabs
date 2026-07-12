import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import ChirpPage from './ChirpPage'
import PersonaTestPage from './PersonaTestPage'
import PersonaProfilePage from './PersonaProfilePage'
import {
  addPersonaToPlanet,
  BIRD,
  buildPersonaTheme,
  CHIRP_PLANETS,
  formatActivityTime,
  getAllPlanets,
  getAllPersonas,
  getPersonasForPlanet,
  UserAvatar,
  getPlanetById,
  getPlanetRecent,
  getPersonaTheme,
  PersonaAvatar,
  readPlanetActivity,
  saveCustomPersona,
  savePlanetMeta,
  truncateTitle
} from './chirpShared'
import {
  loadChirpPlanets,
  loadChirpProfile,
  loadChirpMomentEntries,
  loadChirpDmConversations,
  loadCustomPersonas,
  loadPlanetActivityFromMessages,
  loadPlanetMemberPersonas,
  saveChirpProfile,
  saveChirpMomentEntry,
  saveCustomPersonaToSupabase,
  savePlanetMemberPersonas,
  updateChirpPlanet,
  uploadPersonaAvatar
} from './chirpSupabase'
import './ChirpHomePage.css'

const navigateTo = (...segments) => {
  window.location.hash = '/' + segments.filter(Boolean).join('/')
}

const mergePersonas = (...groups) => {
  const byId = new Map()
  groups.flat().filter(Boolean).forEach(persona => {
    byId.set(persona.id, { ...(byId.get(persona.id) || {}), ...persona })
  })
  return [...byId.values()]
}

export const HomeBird = () => (
  <svg viewBox="0 0 100 100" fill="none" stroke="#1F1F1F" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M30 58 C30 46 38 34 52 34 C66 34 74 44 72 56 C70 66 60 70 48 70 C38 70 30 66 30 58 Z" fill="#DCC4EA" />
    <path d="M30 62 L18 66 L24 70 Z" />
    <circle cx="58" cy="44" r="2.5" fill="#1F1F1F" stroke="none" />
    <path d="M70 48 L80 46 L72 53 Z" fill="#E26B4E" strokeWidth="2.2" />
    <path d="M44 56 Q50 52 58 56" />
    <path d="M44 70 L44 76" />
    <path d="M54 70 L54 76" />
    <path d="M12 80 Q50 84 90 76" strokeWidth="4" />
    <path d="M78 75 Q82 70 86 73 Q84 78 78 75 Z" fill="#9BC494" strokeWidth="2.2" />
    <path d="M22 24 L22 28 M19 26 L25 26" strokeWidth="2" />
  </svg>
)

const LoveCat = () => (
  <svg viewBox="0 0 100 100" fill="none" stroke="#2A2A2A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M28 38 L34 22 L44 36 Z" fill="#E8A29C" />
    <path d="M72 38 L66 22 L56 36 Z" fill="#E8A29C" />
    <ellipse cx="50" cy="56" rx="26" ry="24" fill="#F5C9D2" />
    <circle cx="42" cy="54" r="2" fill="#2A2A2A" />
    <circle cx="58" cy="54" r="2" fill="#2A2A2A" />
    <path d="M48 62 Q50 65 52 62" />
    <path d="M50 62 L50 66" />
    <path d="M36 58 L30 56" />
    <path d="M36 60 L30 62" />
    <path d="M64 58 L70 56" />
    <path d="M64 60 L70 62" />
  </svg>
)

const WorkFox = () => (
  <svg viewBox="0 0 100 100" fill="none" stroke="#2A2A2A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M26 36 L32 18 L44 32 Z" fill="#D6A77A" />
    <path d="M74 36 L68 18 L56 32 Z" fill="#D6A77A" />
    <path d="M30 55 Q50 30 70 55 Q70 78 50 80 Q30 78 30 55 Z" fill="#E8B888" />
    <path d="M38 62 Q50 52 62 62 Q62 74 50 74 Q38 74 38 62 Z" fill="#FBF1ED" />
    <circle cx="42" cy="56" r="2" fill="#2A2A2A" />
    <circle cx="58" cy="56" r="2" fill="#2A2A2A" />
    <path d="M48 66 Q50 68 52 66" />
    <ellipse cx="50" cy="64" rx="2" ry="1.4" fill="#2A2A2A" />
  </svg>
)

const CreatePlanetIcon = () => (
  <svg viewBox="0 0 60 60" fill="none" stroke="#2A2A2A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="30" cy="32" r="14" fill="#F4F1E6" />
    <ellipse cx="30" cy="32" rx="20" ry="5" transform="rotate(-18 30 32)" />
    <circle cx="26" cy="30" r="1.2" fill="#2A2A2A" />
    <circle cx="34" cy="34" r="1.2" fill="#2A2A2A" />
    <path d="M48 14 L48 20 M45 17 L51 17" />
  </svg>
)

const BrushIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#FAFAF7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20 Q5 17 8 16 L16 8 L18 10 L10 18 Q9 21 4 20 Z" />
    <path d="M14 6 L18 10" />
    <path d="M16 4 L20 8" />
  </svg>
)

const planetArt = {
  love: LoveCat,
  work: WorkFox
}

const getCardTitle = (planet) => (planet.id === 'work' ? 'the suck odessy' : 'my crush...')
// Planet (folder) display name. The group chat name is a separate field.
const getPlanetCardTitle = (planet) => planet.roomName || planet.cardTitle || getCardTitle(planet)
const getGroupName = (planet) => planet.groupName || planet.roomName || getPlanetCardTitle(planet)
const DRAWER_MIN_WIDTH = 264
const DRAWER_DEFAULT_WIDTH = 264   // default = min: the width the user opens at
const DRAWER_MAX_WIDTH = 360

const rgbToHex = (r, g, b) => (
  `#${[r, g, b].map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`
)

const extractDominantColor = (src) => new Promise((resolve) => {
  const image = new Image()
  image.onload = () => {
    const canvas = document.createElement('canvas')
    const size = 32
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      resolve('#F5C878')
      return
    }

    context.drawImage(image, 0, 0, size, size)
    const { data } = context.getImageData(0, 0, size, size)
    let r = 0
    let g = 0
    let b = 0
    let total = 0

    for (let index = 0; index < data.length; index += 16) {
      const alpha = data[index + 3]
      if (alpha < 80) continue
      const red = data[index]
      const green = data[index + 1]
      const blue = data[index + 2]
      const brightness = (red + green + blue) / 3
      if (brightness > 238 || brightness < 18) continue
      r += red
      g += green
      b += blue
      total += 1
    }

    resolve(total ? rgbToHex(r / total, g / total, b / total) : '#F5C878')
  }
  image.onerror = () => resolve('#F5C878')
  image.src = src
})

const getPersonaThemeStyle = (persona) => {
  const theme = getPersonaTheme(persona)
  return {
    '--persona-card-a': theme.card[0],
    '--persona-card-b': theme.card[1],
    '--persona-card-c': theme.card[2],
    '--persona-avatar-bg': theme.avatar
  }
}

const DEFAULT_PERSONA_COLOR = '#DCC4EA'
const PERSONA_AVATAR_COLORS = [DEFAULT_PERSONA_COLOR, '#EBA7B5', '#A9C9DF', '#A9CDA0', '#F5C878', '#F0A48A', '#9DC7B5']
const PERSONA_DESCRIPTION_ZH = {
  danzong: '解构、松弛、反鸡汤，先把过度用力的解释拆薄一点。',
  barry: '先接住情绪，再帮你把脑内小剧场调低一点音量。',
  duck: '拆分事实、假设、证据和下一步，适合需要理清关系局面的时刻。'
}

const localizeActivityTime = (time, isChinese) => {
  if (!isChinese) return time
  if (time === 'Yesterday') return '昨天'
  if (time === 'Today') return '今天'
  return time
}

const getPersonaAvatarLabel = (name) => {
  const firstWord = name.trim().split(/\s+/)[0] || 'P'
  if (/^[\u4e00-\u9fff]/.test(firstWord)) return firstWord.slice(0, 1)
  return firstWord.slice(0, 2).toUpperCase()
}

export const CHIRP_PROFILE_KEY = 'chirpOnboardingProfile'
const ASSESSMENT_FLOW = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']
const ONBOARDING_FLOW = [...ASSESSMENT_FLOW, 'birdName']
const ONBOARDING_SCORES = {
  q1: [[-2, -1, +1, 0, +1], [+1, +2, +2, +1, 0], [-1, -2, +1, -1, +1], [+1, +1, 0, +2, -1]],
  q2: [[-1, +1, +1, -1, +2], [+1, +2, +2, +1, 0], [-1, -1, -1, -2, +1], [0, 0, -1, +2, -1]],
  q3: [[+1, +2, +2, +1, 0], [-1, -1, +2, 0, +1], [-2, -2, -1, -1, +1], [+1, +1, -1, +2, -1]],
  q4: [[+1, +1, -1, +2, -2], [0, +2, 0, +1, 0], [-2, -1, -2, 0, 0], [-1, +1, +1, -1, +1]],
  q5: [[+1, +1, -1, +2, -2], [-1, -1, 0, -2, +2], [0, 0, -1, +1, -1], [+1, +1, +2, -1, 0]],
  q6: [[0, 0, -1, +1, -2], [0, -2, +1, -1, +1], [-1, +1, +1, -1, +2], [-1, -1, -1, -2, +1]]
}
const ONBOARDING_WEIGHTS = {
  q1: [1, 0.25, 1, 0.25, 0.25],
  q2: [0.25, 1, 0.25, 0.25, 0.65],
  q3: [1, 0.65, 1, 0.25, 0.25],
  q4: [0.25, 0.25, 0.65, 1, 0.25],
  q5: [0.25, 0.25, 0.25, 1, 0.65],
  q6: [0.25, 0.25, 0.25, 0.65, 1]
}
const ONBOARDING_RANGES = [[-5.25, 2.75], [-3.8, 4.8], [-3.05, 5.9], [-5.3, 6.15], [-4.95, 5.35]]
const SCORE_EPSILON = 1e-9
const ONBOARDING_ANIMALS = {
  cat: { name: '小猫', englishName: 'Cat', kw: '独立 · 自洽 · 边界感', traitsEn: 'Independent · Self-contained · Strong boundaries', msg: '你的精神世界是一座带院子的孤岛，自给自足，繁花似锦。低质量的社交远不如一个人发呆。你当然也需要拥抱，只是得在你刚好想被抱的那一分钟。', lineEn: 'Your inner world is a self-sufficient island with a little yard, blooming beautifully on its own. Low-quality company is far worse than being alone with your thoughts. You need hugs too, of course, but only in the exact minute you happen to want one.' },
  dog: { name: '小狗', englishName: 'Dog', kw: '透明 · 热烈 · 冲在最前', traitsEn: 'Transparent · Passionate · Always first in line', msg: '你的人生没有“仅自己可见”，爱意和失落都像打着双闪的敞篷车一样招摇过市。真诚是你唯一的必杀技，虽然偶尔也会让自己受点内伤。', lineEn: 'You live with no "Only me" setting. Your love and heartbreak drive down the street in a convertible with the hazard lights flashing. Sincerity is your one unbeatable move, even when it leaves you a little bruised inside.' },
  rabbit: { name: '小兔', englishName: 'Rabbit', kw: '细腻 · 共情 · 容易心软', traitsEn: 'Sensitive · Empathetic · Soft-hearted', msg: '你随身携带着一枚高精度的情绪雷达，空气里哪怕只有一丁点叹息你都能捕捉到。你不是总在想太多，只是很多人轻轻略过的东西，会认真落在你心上。', lineEn: 'You carry a high-precision emotional radar, catching even the faintest sigh in the air. You are not always overthinking; it is just that things other people brush past tend to land seriously in your heart.' },
  owl: { name: '猫头鹰', englishName: 'Owl', kw: '通透 · 沉默 · 看得太清', traitsEn: 'Perceptive · Silent · Sees too clearly', msg: '别人在看戏，你已经看到了灯光背后的线和演员没有说出口的台词。你太容易把人性看透，以至于“难得糊涂”成了你这辈子最难修满学分的一门课。', lineEn: 'While others are watching the play, you have already noticed the wires behind the lights and the lines the actors never said aloud. You see through human nature so easily that "blissful ignorance" may be the hardest course you will ever try to pass.' },
  octopus: { name: '章鱼', englishName: 'Octopus', kw: '嘴硬 · 别扭 · 口是心非', traitsEn: 'Tough-talking · Awkward · Says the opposite', msg: '你的表面是一层名为“关我屁事”的防弹玻璃，背后却在疯狂放烟花。口是心非是你最后的倔强，懂你的人自然知道怎么把那句“随便”翻译成“别走”。', lineEn: 'Your exterior is a sheet of bulletproof glass labeled "I don\'t care," while fireworks are going off furiously behind it. Saying the opposite is your last act of stubbornness; anyone who truly knows you can translate "whatever" into "don\'t go."' },
  hedgehog: { name: '刺猬', englishName: 'Hedgehog', kw: '警觉 · 防御 · 外硬内软', traitsEn: 'Alert · Guarded · Hard outside, soft inside', msg: '你完美演绎了叔本华的刺猬困境：渴望取暖，又怕被扎伤。你竖起满身的尖刺，其实只是在笨拙地筛选那个不怕疼的人。一旦有人熬过了你别扭的试探期，你会向他亮出最柔软的底牌。', lineEn: 'You perfectly embody Schopenhauer\'s hedgehog dilemma: craving warmth, yet afraid of being pricked. You raise all your spines as a clumsy way of finding the person who is not afraid of a little pain. Once someone makes it through your awkward testing period, you will show them the softest card in your hand.' },
  fish: { name: '小鱼', englishName: 'Fish', kw: '自由 · 直觉 · 不纠结', traitsEn: 'Free · Intuitive · Unburdened', msg: '你是这世上最纯粹的体验派。合则聚，不合则游走，在“绝不为难自己”这项现代人的终极哲学上，你绝对是个不用修行的顿悟大师。', lineEn: 'You are the purest kind of experientialist. If it flows, you stay; if it does not, you swim on. In the great modern philosophy of "never making life harder for yourself," you are already enlightened without ever having to practice.' },
  fox: { name: '小狐狸', englishName: 'Fox', kw: '慢热 · 克制 · 死心塌地', traitsEn: 'Slow to warm · Restrained · Wholehearted once committed', msg: '你的偏爱很贵，从不轻易交付。你不相信速食的感情，只相信麦浪的颜色和日复一日建立的羁绊。一旦决定在谁身上倾注时间，ta就成了你在这世上的极致例外。', lineEn: 'Your favoritism is precious, and you never hand it over easily. You do not believe in fast-food affection; you believe in the color of wheat fields and bonds built day after day. Once you decide to pour your time into someone, they become your most extraordinary exception in this world.' },
  frog: { name: '青蛙', englishName: 'Frog', kw: '佛系 · 行动派 · 不内耗', traitsEn: 'Easygoing · Action-first · Rarely spirals', msg: '精神状态常年稳定在“已出家”和“吃得挺好”之间。生活偶尔卡顿，关系偶尔掉线，但你很少愿意在原地把自己耗到没电。', lineEn: 'Your mental state stays somewhere between "I have renounced worldly concerns" and "honestly, I have been eating pretty well." Life may lag and relationships may briefly lose signal, but you are rarely willing to drain your battery by standing still.' },
  lion: { name: '狮子', englishName: 'Lion', kw: '扛事 · 笃定 · 也想被接住', traitsEn: 'Dependable · Steady · Wants to be held too', msg: '大家习惯了天塌下来有你顶着，却忘了你也只是一副血肉之躯。你总在做那个给别人递伞的人；只是偶尔下大雨时，你也会想躲进谁的大衣里。', lineEn: 'Everyone is used to having you hold up the sky, and forgets that you are made of flesh and blood too. You are always the one handing umbrellas to other people; only sometimes, when the rain gets heavy, you want to hide inside someone else\'s coat.' },
  snake: { name: '小蛇', englishName: 'Snake', kw: '耐心 · 精准 · 后发制人', traitsEn: 'Patient · Precise · Strikes last', msg: '你的沉默不是放空，而是在后台疯狂运行算力。草率出手是对你的侮辱，你只打有准备的算盘，一击必中，深藏功与名。', lineEn: 'Your silence is not emptiness; it is your processor running furiously in the background. Acting rashly would be an insult to your nature. You calculate only with preparation, strike cleanly once, and quietly disappear with the credit.' },
  butterfly: { name: '蝴蝶', englishName: 'Butterfly', kw: '蜕变 · 断舍离 · 重启力强', traitsEn: 'Transformative · Lets go · Strong at starting again', msg: '你的人生是一场不断删除旧档、重塑真身的升级游戏。别人以为你在流浪，但你只是觉得，被装进罐子里的风景，怎么能叫春天？真的该走向下一站时，你通常比自己以为的更敢起飞。', lineEn: 'Your life is an upgrading game of deleting old saves and reshaping your truest form. Other people think you are wandering, but you simply believe that scenery trapped inside a jar cannot be called spring. When it is truly time to head toward the next stop, you are usually braver about taking flight than you realize.' },
  elephant: { name: '大象', englishName: 'Elephant', kw: '念旧 · 重感情 · 过目不忘', traitsEn: 'Nostalgic · Sentimental · Remembers everything', msg: '你的脑海里有一座塞满票根、旧信和气味的私人博物馆。别人都在赶路，而你总是在原地的风里频频回头。深情有时是一笔厚重的资产，有时也是负债。', lineEn: 'You house a private museum of ticket stubs, old letters, and scents in your mind. While everyone else is rushing onward, you keep turning back in the wind where you once stood. Depth of feeling is sometimes a weighty asset, and sometimes a debt.' },
  ostrich: { name: '鸵鸟', englishName: 'Ostrich', kw: '装没事 · 先躲一会儿 · 内心戏多', traitsEn: 'Acts fine · Hides for a while · A lot going on inside', msg: '战术性撤退是你维持内核稳定的法宝。外表像已经翻篇，心里其实还在循环播放；等那阵风没那么响了，你才会慢慢决定下一步怎么走。', lineEn: 'Tactical retreat is how you keep your inner core steady. On the outside, you look as though you have already turned the page; inside, the scene is still playing on repeat. Once the wind quiets down a little, you will slowly decide where to go next.' }
}
const ONBOARDING_PROTOTYPES = {
  cat: [-2, -1, -2, 0, 0],
  dog: [2, 2, 2, 2, 1],
  rabbit: [-1, 1, 2, -2, 1],
  owl: [-2, -1, 0, -2, 0],
  octopus: [-1, -2, 1, 0, 1],
  hedgehog: [-1, -1, 2, 0, 1],
  fish: [0, 0, -2, 1, -2],
  fox: [-1, -1, 1, -2, 2],
  frog: [1, 0, -2, 2, -1],
  lion: [1, -1.5, 2, 1, 1],
  snake: [-2, -2, -2, -2, 2],
  butterfly: [1, 1, 0, 2, -2],
  elephant: [-1, 1, 2, -1, 2],
  ostrich: [0, -2, 0, -2, 1]
}
const PLANET_PERSONALITY_MAP = {
  love: { key: 'cat', animal: 'Cat', trait: 'independent · self-contained · strong boundaries' },
  work: { key: 'owl', animal: 'Owl', trait: 'perceptive · silent · sees too clearly' },
  self: { key: 'fish', animal: 'Fish', trait: 'free · intuitive · unburdened' },
  family: { key: 'rabbit', animal: 'Rabbit', trait: 'sensitive · empathetic · soft-hearted' }
}
const BIRD_DAILY_NOTES = [
  {
    id: 'note-1',
    date: 'Today',
    dateZh: '今天',
    title: 'Quiet Proof',
    titleZh: '安静的证据',
    text: 'Today you moved between wanting closeness and wanting quiet. That is not contradiction; it is your system asking for proof before it relaxes. When the room feels uncertain, you start reading tiny signals. I would not call that overthinking. I would call it a need for steadier evidence.',
    textZh: '今天你在想要靠近和想要安静之间来回移动。这不是矛盾，而是你的系统在放松之前需要证据。当气氛变得不确定，你会开始读取很小的信号。我不觉得这是想太多，而是你需要更稳定的确认。'
  },
  {
    id: 'note-2',
    date: 'Yesterday',
    dateZh: '昨天',
    title: 'Third Sentence Truth',
    titleZh: '第三句真话',
    text: 'You seem softer after you write things down. The first sentence is usually defensive, but by the third one you begin telling the truth. There is a pattern here: you do not need faster answers as much as you need a place where the answer can arrive without being rushed.',
    textZh: '你把事情写下来之后似乎会柔软一些。第一句话通常是在防御，但到第三句，你就开始讲真话了。这里有一个规律：比起更快的答案，你更需要一个答案可以不被催促、慢慢抵达的地方。'
  }
]
const ONBOARDING_QUESTIONS = {
  q1: { label: '1 / 7', text: <>在一段关系里（恋人或挚友），<br />哪个瞬间会让你觉得被好好接住了？</>, options: ['绝对的默契与留白。各做各的事，不说话也不会尴尬', '明目张胆的偏爱。在人群中毫不犹豫走向我，把我放在第一位', '看破不说破的温柔。看穿我的口是心非，护住我的自尊', '不扫兴的同频。我抛出点子，对方二话不说拉着我就去疯'] },
  q2: { label: '2 / 7', text: '深夜 emo 的时候，你是哪种？', options: ['翻聊天记录，反复回忆某个人、某段过去的关系', '找亲近的人倒苦水，或发一条分组动态', '打开备忘录疯狂复盘，理清底层的逻辑', '立马刷视频或直接闭眼睡觉，绝不跟烂情绪内耗'] },
  q3: { label: '3 / 7', text: <>当你真的在意一个人时，<br />你的“在意”通常更像哪一种？</>, options: ['让 ta 知道。挂念、欣赏、偏爱，能说出口的不太藏', '默默记住 ta 的小事；只要需要，我就在', '先把在意放在心里，慢慢观察，确认值得后才向前一步', '把 ta 拉进我的日常：分享有意思的东西，约见面'] },
  q4: { label: '4 / 7', text: <>抛开偶尔的自我怀疑，<br />你觉得自己身上最珍贵的光芒是什么？</>, options: ['无论生活怎么锤我，我永远有推翻一切、一秒翻篇的洒脱', '看透生活的复杂，但还是愿意一腔孤勇地做个真诚的人', '极度清醒也极度独立，一个人就能把日子过成繁花似锦', '哪怕世界再粗糙，我依然能捕捉到微小的细节与美好'] },
  q5: { label: '5 / 7', text: <>面对充满极大不确定性的未来，<br />你会？</>, options: ['兴奋多过焦虑，未知意味着什么都有可能', '焦虑到失眠，脑子里反复推演每一种可能', '先不想了，过好今天再说', '去找经历过的人聊聊，别人的路能照亮我的'] },
  q6: { label: '6 / 7', text: <>面对一段没有好好告别、<br />戛然而止的经历，你会如何安置它？</>, options: ['物理清退，全盘删除。没有结果的事，不值得再浪费精力', '表面刀枪不入，其实一碰还是会疼', '时不时在回忆里回头看，深情且认命', '疯狂复盘，只有彻底剖析透了底层逻辑，才能翻篇'] }
}
const ONBOARDING_QUESTIONS_EN = {
  q1: { label: '1 / 7', text: <>In a relationship, with a partner or close friend,<br />which moment makes you feel truly held?</>, options: ['An effortless understanding with room for silence. We can do our own things without awkwardness.', 'Open preference. In a crowd, they walk straight to me and put me first.', 'A considerate kind of insight. They see through my deflection while protecting my pride.', 'Shared spontaneity. I suggest something and they immediately come along for the ride.'] },
  q2: { label: '2 / 7', text: 'When emotions hit late at night, which one are you?', options: ['I reread chats and revisit a person or a relationship from the past.', 'I talk to someone close, or post something to a selected group.', 'I open my notes and analyze everything until the logic is clear.', 'I watch videos or go straight to sleep. I refuse to drain myself over bad feelings.'] },
  q3: { label: '3 / 7', text: <>When you genuinely care about someone,<br />what does your caring usually look like?</>, options: ['I let them know. Missing them, admiring them and choosing them are not things I hide.', 'I quietly remember the small things; when they need me, I am there.', 'I keep it in my heart first, observe slowly, then step forward once it feels worth it.', 'I bring them into my daily life: sharing interesting things and making plans to meet.'] },
  q4: { label: '4 / 7', text: <>Putting occasional self-doubt aside,<br />what is the most precious light in you?</>, options: ['No matter what life throws at me, I can overturn it and turn the page in a second.', 'I see the complexity of life clearly, yet still choose to be sincere.', 'I am clear-eyed and independent enough to make life bloom on my own.', 'Even when the world is rough, I can still notice small details and beauty.'] },
  q5: { label: '5 / 7', text: <>When facing a future full of uncertainty,<br />what do you do?</>, options: ['I feel more excitement than anxiety; the unknown means anything is possible.', 'I get anxious enough to lose sleep, repeatedly simulating every possibility.', 'I stop thinking about it for now and focus on living today well.', 'I talk to people who have been through it; their path may light mine.'] },
  q6: { label: '6 / 7', text: <>When an experience ends abruptly<br />without a real goodbye, where do you put it?</>, options: ['I clear it out completely. Things without a result do not deserve more energy.', 'I look invulnerable on the surface, but it still hurts when touched.', 'I turn back to it in memory from time to time, deeply attached and accepting.', 'I analyze it relentlessly; only understanding the underlying logic lets me turn the page.'] }
}
export const readOnboardingProfile = () => {
  if (typeof window === 'undefined') return null
  try {
    return JSON.parse(window.localStorage.getItem(CHIRP_PROFILE_KEY) || 'null')
  } catch {
    return null
  }
}

const saveOnboardingProfile = (profile) => {
  if (profile) {
    window.localStorage.setItem(CHIRP_PROFILE_KEY, JSON.stringify(profile))
  } else {
    window.localStorage.removeItem(CHIRP_PROFILE_KEY)
  }
  window.dispatchEvent(new CustomEvent('chirp:onboarding-updated', { detail: profile }))
}

const calculateOnboardingAnimal = (answers) => {
  const raw = [0, 0, 0, 0, 0]
  Object.keys(ONBOARDING_SCORES).forEach(question => {
    const selected = answers[question]
    if (selected === undefined) return
    ONBOARDING_SCORES[question][selected].forEach((score, dimension) => {
      raw[dimension] += score * ONBOARDING_WEIGHTS[question][dimension]
    })
  })
  const normalized = raw.map((value, dimension) => {
    const [minimum, maximum] = ONBOARDING_RANGES[dimension]
    return ((value - minimum) / (maximum - minimum)) * 4 - 2
  })
  const distance = prototype => Math.sqrt(prototype.reduce((total, value, dimension) => total + ((normalized[dimension] - value) ** 2), 0))
  return Object.keys(ONBOARDING_PROTOTYPES).reduce((winner, candidate) => {
    if (!winner) return candidate
    const winnerDistance = distance(ONBOARDING_PROTOTYPES[winner])
    const candidateDistance = distance(ONBOARDING_PROTOTYPES[candidate])
    if (candidateDistance < winnerDistance - SCORE_EPSILON) return candidate
    if (Math.abs(candidateDistance - winnerDistance) > SCORE_EPSILON) return winner
    const greatestDifference = ONBOARDING_PROTOTYPES[candidate].reduce((selected, value, dimension) => (
      Math.abs(value - ONBOARDING_PROTOTYPES[winner][dimension]) > Math.abs(ONBOARDING_PROTOTYPES[candidate][selected] - ONBOARDING_PROTOTYPES[winner][selected]) ? dimension : selected
    ), 0)
    return Math.abs(normalized[greatestDifference] - ONBOARDING_PROTOTYPES[candidate][greatestDifference]) < Math.abs(normalized[greatestDifference] - ONBOARDING_PROTOTYPES[winner][greatestDifference]) ? candidate : winner
  }, null)
}

const OnboardingBird = () => <HomeBird />

export const OnboardingAnimalAvatar = ({ animal = 'cat' }) => {
  return <img src={`/chirp/animal-icons/${animal}.svg`} alt="" />
}

const PaletteIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
    <path d="M12 22 C7 22 3 18.2 3 13.4 C3 8.1 7.3 4 12.8 4 C17.8 4 21 7.1 21 10.8 C21 13.1 19.5 14.5 17.8 14.5 H16.2 C15 14.5 14.2 15.5 14.6 16.7 L14.9 17.5 C15.7 20 14.3 22 12 22 Z" />
  </svg>
)

const truncateWords = (text, limit = 32) => {
  const words = text.trim().split(/\s+/)
  if (words.length <= limit) return text
  return `${words.slice(0, limit).join(' ')}...`
}

function ChirpHomePage({ page, id, language = 'en' }) {
  const { user } = useAuth()
  const isChinese = language === 'zh'
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState('menu')
  const [drawerWidth, setDrawerWidth] = useState(DRAWER_DEFAULT_WIDTH)
  const [planetActivity, setPlanetActivity] = useState(() => readPlanetActivity())
  const [planets, setPlanets] = useState(() => getAllPlanets())
  const [personas, setPersonas] = useState(() => getAllPersonas())
  const [dmConversations, setDmConversations] = useState([])
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [chirpProfile, setChirpProfile] = useState(() => readOnboardingProfile())
  const [profileResolved, setProfileResolved] = useState(false)
  const selectedPlanet = useMemo(() => {
    if (page !== 'planet') return null
    return planets.find(planet => planet.id === id || planet.dbId === id) || getPlanetById(id)
  }, [page, id, planets])

  const recentFor = (planet) => planetActivity[planet.id] || getPlanetRecent(planet)

  // Rename the PLANET (folder) — writes roomName to local meta (fires
  // chirp:planet-meta-updated → every planet-name display refreshes) and to the
  // DB. Does NOT touch the group name (that's a separate field).
  const renamePlanet = (planet, newName) => {
    savePlanetMeta(planet.id, { roomName: newName, cardTitle: newName })
    updateChirpPlanet(planet, { roomName: newName }).catch(error => console.warn('Failed to rename planet:', error))
  }

  // The user's persona DMs power the persistent conversation list. Refresh when
  // the route changes so a brand-new DM shows up after the first message.
  useEffect(() => {
    if (!user) { setDmConversations([]); return }
    let alive = true
    loadChirpDmConversations(user)
      .then(list => { if (alive) setDmConversations(list) })
      .catch(() => {})
    return () => { alive = false }
  }, [user, page, id])

  const openPlanetDrawer = () => {
    setDrawerMode('planets')
    setDrawerOpen(true)
  }

  const startDrawerResize = (event) => {
    event.preventDefault()
    const updateWidth = (moveEvent) => {
      const nextWidth = Math.min(DRAWER_MAX_WIDTH, Math.max(DRAWER_MIN_WIDTH, moveEvent.clientX))
      setDrawerWidth(nextWidth)
    }
    const stopResize = () => {
      window.removeEventListener('mousemove', updateWidth)
      window.removeEventListener('mouseup', stopResize)
    }

    window.addEventListener('mousemove', updateWidth)
    window.addEventListener('mouseup', stopResize)
  }

  useEffect(() => {
    const openMenu = () => {
      setDrawerMode('menu')
      setDrawerOpen(true)
    }
    const refreshActivity = () => setPlanetActivity(readPlanetActivity())
    const refreshPlanets = () => {
      if (!user) {
        setPlanets(getAllPlanets())
        return
      }
      loadChirpPlanets(user)
        .then(setPlanets)
        .catch(error => console.warn('Failed to refresh Chirp planets:', error))
    }
    const refreshPersonas = () => setPersonas(getAllPersonas())
    const refreshOnboarding = () => setChirpProfile(readOnboardingProfile())
    const openOnboarding = () => setOnboardingOpen(true)

    window.addEventListener('chirp:open-menu', openMenu)
    window.addEventListener('chirp:open-onboarding', openOnboarding)
    window.addEventListener('chirp:planet-activity', refreshActivity)
    window.addEventListener('chirp:planet-meta-updated', refreshPlanets)
    window.addEventListener('chirp:personas-updated', refreshPersonas)
    window.addEventListener('chirp:onboarding-updated', refreshOnboarding)
    window.addEventListener('storage', refreshActivity)
    window.addEventListener('storage', refreshPlanets)
    return () => {
      window.removeEventListener('chirp:open-menu', openMenu)
      window.removeEventListener('chirp:open-onboarding', openOnboarding)
      window.removeEventListener('chirp:planet-activity', refreshActivity)
      window.removeEventListener('chirp:planet-meta-updated', refreshPlanets)
      window.removeEventListener('chirp:personas-updated', refreshPersonas)
      window.removeEventListener('chirp:onboarding-updated', refreshOnboarding)
      window.removeEventListener('storage', refreshActivity)
      window.removeEventListener('storage', refreshPlanets)
    }
  }, [user])

  useEffect(() => {
    let cancelled = false

    const loadRemoteProfile = async () => {
      setProfileResolved(false)
      if (!user) {
        saveOnboardingProfile(null)
        setChirpProfile(null)
        setOnboardingOpen(false)
        return
      }
      try {
        const remoteProfile = await loadChirpProfile(user)
        if (cancelled) return
        if (remoteProfile) {
          saveOnboardingProfile(remoteProfile)
          setChirpProfile(remoteProfile)
        } else {
          saveOnboardingProfile(null)
          setChirpProfile(null)
        }
        setProfileResolved(true)
      } catch (error) {
        console.warn('Failed to load Chirp profile from Supabase:', error)
      }
    }

    const loadRemoteContent = async () => {
      if (!user) return
      try {
        const [remotePlanets, remoteCustomPersonas] = await Promise.all([
          loadChirpPlanets(user),
          loadCustomPersonas(user)
        ])
        if (cancelled) return
        setPlanets(remotePlanets)
        setPersonas(mergePersonas(getAllPersonas(), remoteCustomPersonas))
        const remoteActivity = await loadPlanetActivityFromMessages(remotePlanets)
        if (!cancelled) setPlanetActivity(remoteActivity)
      } catch (error) {
        console.warn('Failed to load Chirp from Supabase:', error)
      }
    }

    loadRemoteProfile()
    loadRemoteContent()
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    if (!user || !profileResolved || page || chirpProfile) return
    setOnboardingOpen(true)
  }, [user, page, chirpProfile, profileResolved])

  const completeOnboarding = async (profile) => {
    saveOnboardingProfile(profile)
    setChirpProfile(profile)
    if (user) {
      try {
        await saveChirpProfile(user, profile)
      } catch (error) {
        console.warn('Failed to save Chirp profile:', error)
      }
    }
    setOnboardingOpen(false)
    navigateTo('chirp')
  }

  if (selectedPlanet) {
    return (
      <div className="chirp-home-detail chirp-two-pane">
        <SideDrawer docked planets={planets} recentFor={recentFor} language={language} activePlanetId={selectedPlanet.id} dmConversations={dmConversations} personas={personas} drawerWidth={drawerWidth} onResizeStart={startDrawerResize} onClose={() => {}} onCreatePlanet={() => setOnboardingOpen(true)} onCreatePersona={() => navigateTo('chirp', 'persona')} onRenamePlanet={renamePlanet} />
        <div className="chirp-pane-main">
          <ChirpPage planetConfig={selectedPlanet} language={language} onOpenPersona={(personaId) => navigateTo('chirp', 'persona-profile', personaId)} />
        </div>
        {onboardingOpen && <ChirpOnboarding onComplete={completeOnboarding} language={language} />}
      </div>
    )
  }

  if (page === 'persona') {
    return (
      <div className="chirp-home-page">
        <PersonaPage personas={personas} planets={planets} user={user} language={language} onPersonasChange={async () => {
          const remoteCustomPersonas = user ? await loadCustomPersonas(user).catch(() => []) : []
          setPersonas(mergePersonas(getAllPersonas(), remoteCustomPersonas))
        }} />
        <SideDrawer open={drawerOpen} mode={drawerMode} setMode={setDrawerMode} onClose={() => setDrawerOpen(false)} recentFor={recentFor} planets={planets} drawerWidth={drawerWidth} onResizeStart={startDrawerResize} language={language} />
        {onboardingOpen && <ChirpOnboarding onComplete={completeOnboarding} language={language} />}
      </div>
    )
  }

  if (page === 'persona-profile') {
    const profilePersona = personas.find(persona => persona.id === id)
    return (
      <div className="chirp-home-detail">
        <PersonaProfilePage
          persona={profilePersona}
          language={language}
          onBack={() => window.history.back()}
          onMessage={(personaId) => navigateTo('chirp', 'persona-dm', personaId)}
        />
        <SideDrawer open={drawerOpen} mode={drawerMode} setMode={setDrawerMode} onClose={() => setDrawerOpen(false)} recentFor={recentFor} planets={planets} drawerWidth={drawerWidth} onResizeStart={startDrawerResize} language={language} />
        {onboardingOpen && <ChirpOnboarding onComplete={completeOnboarding} language={language} />}
      </div>
    )
  }

  if (page === 'persona-dm') {
    const dmPersona = personas.find(persona => persona.id === id)
    return (
      <div className="chirp-home-detail chirp-two-pane">
        <SideDrawer docked planets={planets} recentFor={recentFor} language={language} activePlanetId={null} activeDmAgentId={id} dmConversations={dmConversations} personas={personas} drawerWidth={drawerWidth} onResizeStart={startDrawerResize} onClose={() => {}} onCreatePlanet={() => setOnboardingOpen(true)} onCreatePersona={() => navigateTo('chirp', 'persona')} onRenamePlanet={renamePlanet} />
        <div className="chirp-pane-main">
          <ChirpPage dmAgent={dmPersona} dmConversationId={dmConversations.find(dm => dm.agentId === id)?.conversationId || null} language={language} onBack={() => window.history.back()} onDmStarted={() => user && loadChirpDmConversations(user).then(setDmConversations).catch(() => {})} />
        </div>
        {onboardingOpen && <ChirpOnboarding onComplete={completeOnboarding} language={language} />}
      </div>
    )
  }

  if (page === 'persona-test') {
    return (
      <div className="chirp-home-detail">
        <PersonaTestPage personaId={id || 'danzong'} language={language} onBack={() => navigateTo('chirp', 'persona')} />
        <SideDrawer open={drawerOpen} mode={drawerMode} setMode={setDrawerMode} onClose={() => setDrawerOpen(false)} recentFor={recentFor} planets={planets} drawerWidth={drawerWidth} onResizeStart={startDrawerResize} language={language} />
        {onboardingOpen && <ChirpOnboarding onComplete={completeOnboarding} language={language} />}
      </div>
    )
  }

  if (page === 'dm') {
    return (
      <div className="chirp-home-detail chirp-two-pane">
        <SideDrawer docked planets={planets} recentFor={recentFor} language={language} activePlanetId={null} activeDmAgentId="bird" dmConversations={dmConversations} personas={personas} drawerWidth={drawerWidth} onResizeStart={startDrawerResize} onClose={() => {}} onCreatePlanet={() => setOnboardingOpen(true)} onCreatePersona={() => navigateTo('chirp', 'persona')} onRenamePlanet={renamePlanet} />
        <div className="chirp-pane-main">
          <ChirpPage dmAgent={BIRD} dmConversationId={dmConversations.find(dm => dm.agentId === 'bird')?.conversationId || null} language={language} />
        </div>
        {onboardingOpen && <ChirpOnboarding onComplete={completeOnboarding} language={language} />}
      </div>
    )
  }

  if (page === 'about-me') {
    return (
      <div className="chirp-home-page">
        <AboutMePage chirpProfile={chirpProfile} planets={planets} onRetake={() => setOnboardingOpen(true)} language={language} />
        {onboardingOpen && <ChirpOnboarding onComplete={completeOnboarding} existingProfile={chirpProfile} language={language} />}
      </div>
    )
  }

  return (
    <div className="chirp-home-page">
      <main className="content">
        <div className="chirp-hero-row">
          <div className="bird-strip">
            <div className="bird-avatar"><HomeBird /></div>
            <div className="bird-text">
              <div className="bird-name">{chirpProfile?.birdName || 'Bird'} · 07:42</div>
              <div className="bird-msg">
                {isChinese ? <>早安，Goldie。昨晚你在 <em role="button" tabIndex="0" onClick={() => navigateTo('chirp', 'planet', 'love')} onKeyDown={(event) => event.key === 'Enter' && navigateTo('chirp', 'planet', 'love')}>my crush...</em> 写道："never mind, let it go." 这周你经常这样心软。</> : <>Morning, Goldie. Last night in <em role="button" tabIndex="0" onClick={() => navigateTo('chirp', 'planet', 'love')} onKeyDown={(event) => event.key === 'Enter' && navigateTo('chirp', 'planet', 'love')}>my crush...</em> you wrote "never mind, let it go." That softness shows up a lot this week.</>}
              </div>
            </div>
            <button className="chirp-test-button" type="button" onClick={() => navigateTo('chirp', 'planet', 'love')}>{isChinese ? '聊天' : 'Chat'}</button>
          </div>
        </div>

        <div className="sec-label">{isChinese ? '我的星球' : 'My Planets'}</div>
        <div className="planets-grid">
          {planets.map((planet) => (
            <PlanetCard key={planet.id} planet={planet} recent={recentFor(planet)} language={language} />
          ))}

          <button className="planet-card pc-create" type="button">
            <div className="pc-create-illu"><CreatePlanetIcon /></div>
            <div className="pc-create-title">{isChinese ? '我的星球' : 'My Planet'}</div>
            <div className="pc-create-desc">{isChinese ? '给它取名、配色，把它变成你的空间。' : 'Name it. Color it. Make it yours.'}</div>
            <span className="pc-create-btn"><span className="ic">+</span>{isChinese ? '创建' : 'CREATE'}</span>
          </button>
        </div>

      </main>

      <SideDrawer open={drawerOpen} mode={drawerMode} setMode={setDrawerMode} onClose={() => setDrawerOpen(false)} recentFor={recentFor} planets={planets} drawerWidth={drawerWidth} onResizeStart={startDrawerResize} language={language} />
      {onboardingOpen && <ChirpOnboarding onComplete={completeOnboarding} language={language} />}
    </div>
  )
}

function AboutMePage({ chirpProfile, planets, onRetake, language }) {
  const [expandedNoteId, setExpandedNoteId] = useState(null)
  const isChinese = language === 'zh'
  const animalKey = ONBOARDING_ANIMALS[chirpProfile?.animal] ? chirpProfile.animal : 'cat'
  const animal = ONBOARDING_ANIMALS[animalKey]
  const birdName = chirpProfile?.birdName && chirpProfile.birdName !== 'Bird' ? chirpProfile.birdName : '小草'

  return (
    <main className="chirp-about-page">
      <section className="chirp-about-profile">
        <div className="about-profile-head">
          <div className="about-profile-avatar">
            <OnboardingAnimalAvatar animal={animalKey} />
          </div>
          <div className="about-profile-copy">
            <h1>{isChinese ? animal.name : animal.englishName}</h1>
            <div className="about-profile-traits">{isChinese ? animal.kw : animal.traitsEn}</div>
          </div>
          <button className="about-retake-button" type="button" onClick={onRetake}>{isChinese ? '重新测试' : 'Retake Test'}</button>
        </div>
        <div className="about-profile-line">
          <p>{isChinese ? animal.msg : animal.lineEn}</p>
        </div>
      </section>

      <section className="chirp-about-insights">
        <div className="about-section-head">
          <div>
            <div className="sec-label">{isChinese ? `${birdName} 的星球观察` : `${birdName}'s Planet Findings`}</div>
          </div>
        </div>

        <div className="about-planet-types">
          {planets.map(planet => {
            const personality = PLANET_PERSONALITY_MAP[planet.id] || { key: 'fox', animal: 'Fox', trait: 'slow to warm · restrained · wholehearted once committed' }
            const personalityAnimal = ONBOARDING_ANIMALS[personality.key]
            return (
              <article className="about-planet-type" key={planet.id} style={{ '--planet-color': planet.color }}>
                <span>{getPlanetCardTitle(planet)}</span>
                <div className="about-planet-animal">
                  <span className="about-planet-animal-avatar">
                    <OnboardingAnimalAvatar animal={personality.key} />
                  </span>
                  <strong>{isChinese ? personalityAnimal.name : personality.animal}</strong>
                </div>
                <p>{isChinese ? personalityAnimal.kw : personality.trait}</p>
              </article>
            )
          })}
        </div>

        <div className="about-notes-block">
          <div className="about-section-head compact">
            <div>
              <div className="sec-label">{isChinese ? `${birdName} 的笔记` : `${birdName} Notes`}</div>
            </div>
          </div>
          <div className="about-notes-list">
            {BIRD_DAILY_NOTES.map(note => {
              const expanded = expandedNoteId === note.id
              return (
                <button className={`about-note ${expanded ? 'expanded' : ''}`} type="button" key={note.id} onClick={() => setExpandedNoteId(expanded ? null : note.id)}>
                  <div className="about-note-meta">
                    <span>{isChinese ? note.dateZh : note.date}</span>
                    <strong>{isChinese ? note.titleZh : note.title}</strong>
                  </div>
                  <p>{expanded ? (isChinese ? note.textZh : note.text) : truncateWords(isChinese ? note.textZh : note.text, 28)}</p>
                </button>
              )
            })}
          </div>
        </div>
      </section>
    </main>
  )
}

const buildMomentMonth = (days, marked) => Array.from({ length: days }, (_, index) => marked[index + 1] || 'none')
const MOMENTS_CAL_DATA = {
  may: buildMomentMonth(31, { 10: 'blue', 12: 'duo', 13: 'gold', 14: 'duo' }),
  apr: buildMomentMonth(30, { 3: 'blue', 8: 'duo', 15: 'gold', 24: 'blue' }),
  mar: buildMomentMonth(31, { 18: 'gold', 19: 'duo', 21: 'blue' })
}

const MOMENTS_DATE_TARGETS = {
  may: { 14: 'today', 13: 'yesterday', 12: 'may-12', 10: 'may-10' },
  apr: { 3: 'apr-3', 8: 'apr-8', 15: 'apr-15', 24: 'apr-24' },
  mar: { 18: 'mar-18', 19: 'mar-19', 21: 'mar-21' }
}

const MOMENTS_PAPER_COLORS = ['#FAFAF7', '#FFF8E7', '#F0F4E8', '#E8F0F5', '#FBE6EA', '#EFEAF8', '#FFFFFF']
const MOMENTS_PAPER_PATTERNS = [
  { id: '', name: 'Plain', preview: 'blank-p' },
  { id: 'pattern-grid', name: 'Grid', preview: 'grid-p' },
  { id: 'pattern-lined', name: 'Lined', preview: 'lined-p' },
  { id: 'pattern-dot', name: 'Dotted', preview: 'dot-p' }
]

const MOMENT_SPACES = [
  {
    id: 'xw',
    backingId: 'love',
    className: 'love',
    title: 'X & W',
    subtitle: 'SHARED'
  }
]

const MOMENT_SAMPLE_ENTRIES = {
  xw: [
    { id: 'sample-xw-5', dateKey: 'may-10', dateLabel: 'May 10', time: '18 : 45 · W', tone: 'fr', text: '公园里有人在放风筝。线断了，风筝越飞越远。莫名觉得自由。' },
    { id: 'sample-xw-4', dateKey: 'may-12', dateLabel: 'May 12', time: '09 : 15 · X', tone: 'me', text: '今天天气好得不真实' },
    { id: 'sample-xw-6', dateKey: 'yesterday', dateLabel: 'Yesterday', time: '21 : 04 · X', tone: 'me', text: '看到一家咖啡店的招牌，突然想到你。没什么理由。' },
    { id: 'sample-xw-3', dateKey: 'yesterday', dateLabel: 'Yesterday', time: '10 : 30 · W', tone: 'fr', text: '早上阳光洒进来，突然很想发条消息给你。又忍住了。' },
    { id: 'sample-xw-2', dateKey: 'today', dateLabel: 'Today', time: '14 : 22 · X', tone: 'me', text: '路过咖啡店，门口的猫又在晒太阳。跟你说过的那只。', image: 'cat', imageText: '🐱 cat in the sun' },
    { id: 'sample-xw-1', dateKey: 'today', dateLabel: 'Today', time: '15 : 08 · W', tone: 'fr', text: '中午那个汤！！好喝到原地升天，下次一起去', image: 'soup', imageText: '🍲 那家小店' }
  ]
}

const readLocalMomentEntries = (planetId) => {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(window.localStorage.getItem(`chirpMoments:${planetId}`) || '[]')
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  } catch {
    return []
  }
}

const saveLocalMomentEntries = (planetId, entries) => {
  window.localStorage.setItem(`chirpMoments:${planetId}`, JSON.stringify(entries))
}

const MomentsPaperclipIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16.5 6.6 C16.1 6.2 15.4 6.1 14.9 6.5 C14.6 6.7 14.4 7 14.1 7.3 L8.3 13.2 C7.6 13.9 7.4 14.7 8 15.2 C8.6 15.7 9.4 15.4 10 14.8 L14.7 10 C14.9 9.8 15 9.6 15.2 9.5" />
    <path d="M17.6 5.5 C16.5 4.5 14.8 4.4 13.7 5.5 L7.2 12 C5.4 13.8 5.3 16.7 7 18.4 C8.7 20.1 11.5 20 13.4 18.2 L18.7 12.9 C18.9 12.6 19.2 12.4 19.4 12.1" />
  </svg>
)

const MomentsMicIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3.3 C10.4 3.2 9.5 4.2 9.5 5.6 C9.5 7.4 9.5 9.3 9.5 11 C9.4 12.6 10.6 13.6 12.1 13.5 C13.6 13.4 14.5 12.4 14.5 11 C14.5 9.2 14.5 7.2 14.5 5.6 C14.5 4.1 13.6 3.2 12 3.3 Z" />
    <path d="M6.6 11 C6.4 14.7 9.3 16.6 12 16.5 C15.1 16.4 17.6 14.5 17.5 11.2" />
    <path d="M12 16.5 C12 17.7 12 18.7 12 20" />
    <path d="M8.8 20.1 C10.7 20 13.2 20 15.3 20" />
  </svg>
)

function MomentsCalendarDay({ kind, day, today, onOpen }) {
  const hasEntry = kind !== 'none'
  return (
    <button className={`moments-dd ${hasEntry ? 'has' : ''} ${today ? 'today-ring' : ''}`} type="button" onClick={hasEntry ? onOpen : undefined}>
      {kind === 'gold' && <span className="moments-ex-av gold">S</span>}
      {kind === 'blue' && <span className="moments-ex-av blue">X</span>}
      {kind === 'duo' && (
        <span className="moments-ex-duo">
          <span className="moments-ex-av small gold">S</span>
          <span className="moments-ex-av small blue">X</span>
        </span>
      )}
      {kind === 'none' && <span className="moments-dd-dot" />}
    </button>
  )
}

function MomentsPage({ user, getAccessToken, planets }) {
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [bgPickerOpen, setBgPickerOpen] = useState(false)
  const [paperColor, setPaperColor] = useState('#FAFAF7')
  const [paperPattern, setPaperPattern] = useState('')
  const [activeMomentId, setActiveMomentId] = useState('xw')
  const [momentEntries, setMomentEntries] = useState([])
  const [draftText, setDraftText] = useState('')
  const [composerActive, setComposerActive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [draftEntryId, setDraftEntryId] = useState(null)
  const memoScrollRef = useRef(null)
  const composerRef = useRef(null)

  const activeMoment = useMemo(() => {
    return MOMENT_SPACES.find(space => space.id === activeMomentId) || MOMENT_SPACES[0]
  }, [activeMomentId])

  const backingPlanet = useMemo(() => {
    return planets.find(planet => planet.id === activeMoment.backingId) || getPlanetById(activeMoment.backingId) || planets[0]
  }, [activeMoment, planets])

  useEffect(() => {
    let cancelled = false
    const loadEntries = async () => {
      const localEntries = readLocalMomentEntries(activeMomentId)
      if (!user || !backingPlanet?.dbId) {
        setMomentEntries(localEntries)
        setDraftText('')
        setDraftEntryId(null)
        return
      }
      try {
        const remoteEntries = await loadChirpMomentEntries(backingPlanet, activeMomentId)
        const entries = remoteEntries?.length ? remoteEntries : localEntries
        if (!cancelled) {
          setMomentEntries(entries)
          setDraftText('')
          setDraftEntryId(null)
        }
      } catch (error) {
        console.warn('Failed to load Moments entries:', error)
        if (!cancelled) {
          setMomentEntries(localEntries)
          setDraftText('')
          setDraftEntryId(null)
        }
      }
    }

    loadEntries()
    return () => {
      cancelled = true
    }
  }, [activeMomentId, backingPlanet, user])

  const saveMomentDraft = async (textOverride = draftText) => {
    const text = textOverride.trim()
    if (!text || saving) return
    setSaving(true)
    const localEntry = { id: draftEntryId || `local-${Date.now()}`, text, createdAt: Date.now() }
    try {
      let nextEntry = localEntry
      if (user && backingPlanet?.dbId) {
        nextEntry = await saveChirpMomentEntry(backingPlanet, text, draftEntryId, activeMomentId)
      }
      const restEntries = momentEntries.filter(entry => entry.id !== draftEntryId && entry.id !== nextEntry.id)
      const nextEntries = [...restEntries, nextEntry].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      setMomentEntries(nextEntries)
      setDraftEntryId(nextEntry.id)
      saveLocalMomentEntries(activeMomentId, nextEntries)
      setSavedAt(Date.now())
      window.dispatchEvent(new CustomEvent('chirp:planet-activity'))
    } catch (error) {
      console.warn('Failed to save Moment entry:', error)
      const restEntries = momentEntries.filter(entry => entry.id !== draftEntryId && entry.id !== localEntry.id)
      const nextEntries = [...restEntries, localEntry].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      setMomentEntries(nextEntries)
      setDraftEntryId(localEntry.id)
      saveLocalMomentEntries(activeMomentId, nextEntries)
      setSavedAt(Date.now())
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const text = draftText.trim()
    if (!text) return undefined
    const timer = window.setTimeout(() => saveMomentDraft(text), 900)
    return () => window.clearTimeout(timer)
  }, [draftText])

  useEffect(() => {
    if (!composerActive || !memoScrollRef.current) return
    window.requestAnimationFrame(() => {
      const scroll = memoScrollRef.current
      if (!scroll) return
      scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight
    })
  }, [composerActive, draftText])

  useEffect(() => {
    if (!composerActive || !composerRef.current) return
    if (!draftText && composerRef.current.textContent) composerRef.current.textContent = ''
    composerRef.current.focus()
  }, [composerActive, draftText])

  useEffect(() => {
    if (calendarOpen || composerActive) return
    window.setTimeout(() => {
      document.getElementById('moment-date-yesterday')?.scrollIntoView({ block: 'start' })
    }, 0)
  }, [activeMomentId, momentEntries.length, calendarOpen, composerActive])

  useEffect(() => {
    setComposerActive(false)
    setDraftText('')
    setDraftEntryId(null)
    if (composerRef.current) composerRef.current.textContent = ''
  }, [activeMomentId])

  const jumpToMomentDate = (month, day) => {
    const target = MOMENTS_DATE_TARGETS[month]?.[day] || 'today'
    setCalendarOpen(false)
    window.setTimeout(() => {
      document.getElementById(`moment-date-${target}`)?.scrollIntoView({ block: 'start' })
    }, 0)
  }

  const renderMonth = (month, label, todayDay) => {
    const days = MOMENTS_CAL_DATA[month]
    const count = days.filter(kind => kind !== 'none').length
    return (
      <section className="moments-cal-month">
        <div className="moments-cal-month-label">{label} <span className="moments-cal-month-count">· {count} days</span></div>
        <div className="moments-cal-days">
          {days.map((kind, index) => (
            <MomentsCalendarDay key={`${month}-${index}`} kind={kind} day={index + 1} today={todayDay === index + 1} onOpen={() => jumpToMomentDate(month, index + 1)} />
          ))}
        </div>
      </section>
    )
  }

  const sampleSections = useMemo(() => {
    const sections = []
    const entries = (MOMENT_SAMPLE_ENTRIES[activeMomentId] || [])
    ;entries.forEach(entry => {
      let section = sections.find(item => item.key === entry.dateKey)
      if (!section) {
        section = { key: entry.dateKey, label: entry.dateLabel, entries: [] }
        sections.push(section)
      }
      section.entries.push(entry)
    })
    return sections
  }, [activeMomentId])

  const todayEntries = useMemo(() => {
    return momentEntries
      .map(entry => ({ ...entry, source: 'me' }))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  }, [momentEntries])

  return (
    <main className="chirp-moments-page">
      <section className="moments-topic-row">
        {MOMENT_SPACES.map(space => (
          <button className={`moments-topic ${space.className} ${activeMomentId === space.id ? 'active' : ''}`} type="button" key={space.id} onClick={() => setActiveMomentId(space.id)}>
            <span className="moments-topic-info">
              <span className="moments-topic-name">{space.title}</span>
              <span className="moments-topic-sub">{space.subtitle}</span>
            </span>
          </button>
        ))}
        <button className="moments-topic create" type="button">
          <span className="moments-topic-plus">+</span>
          <span className="moments-topic-info">
            <span className="moments-topic-name">Create a moment</span>
          </span>
        </button>
      </section>

      <section className="moments-memo-frame" style={{ backgroundColor: paperColor }}>
        <div className="moments-memo-toolbar">
          <div className="moments-m-left">
            <button className="moments-m-dots" type="button" title="Records panel" onClick={() => { setBgPickerOpen(false); setCalendarOpen(true) }}>
              <span className="moments-md both" />
              <span className="moments-md me" />
              <span className="moments-md fr" />
              <span className="moments-md both" />
              <span className="moments-m-dots-arrow">▾</span>
            </button>
          </div>

          <div className="moments-m-center">
            <button className="moments-m-tool" type="button" title="Attach"><MomentsPaperclipIcon /></button>
            <button className="moments-m-tool" type="button" title="Voice"><MomentsMicIcon /></button>
          </div>

          <div className="moments-m-right">
            <button className={`moments-m-more ${bgPickerOpen ? 'on' : ''}`} type="button" title="More" onClick={() => setBgPickerOpen(prev => !prev)}>
              <span className="moments-m-more-dot" />
              <span className="moments-m-more-dot" />
              <span className="moments-m-more-dot" />
            </button>
          </div>
        </div>

        <div className={`moments-memo-scroll ${paperPattern}`} ref={memoScrollRef} onClick={() => setComposerActive(true)}>
          <div className="moments-memo-doc">
            {sampleSections.map(section => (
              <section className="moments-date-group" id={`moment-date-${section.key}`} key={section.key}>
                <div className="moments-date-section">{section.label}</div>
                {section.entries.map(entry => (
                  <div className="moments-entry" key={entry.id}>
                    <div className="moments-entry-time">{entry.time}</div>
                    <div className={`moments-entry-text ${entry.tone}`} lang="zh">{entry.text}</div>
                    {entry.image && (
                      <div className="moments-entry-img">
                        <div className={`moments-entry-img-inner ${entry.image}`}>{entry.imageText}</div>
                      </div>
                    )}
                  </div>
                ))}
                {section.key === 'today' && todayEntries.map(entry => (
                  <div className="moments-entry" key={entry.id}>
                    <div className="moments-entry-time">{entry.source === 'bird' ? entry.time : `${formatActivityTime(entry.createdAt)} · S`}</div>
                    <div className={`moments-entry-text ${entry.source === 'bird' ? 'bird' : 'me'}`} lang={/[\u4e00-\u9fff]/.test(entry.text) ? 'zh' : 'en'}>{entry.text}</div>
                  </div>
                ))}
              </section>
            ))}

            {composerActive && (
              <div className="moments-composer">
                <div
                  ref={composerRef}
                  className="moments-paper-editor"
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder="Write a moment..."
                  onInput={(event) => {
                    setDraftText(event.currentTarget.textContent || '')
                    setComposerActive(true)
                  }}
                />
                <div className="moments-save-state">{saving ? 'Saving' : ''}</div>
              </div>
            )}
            {!composerActive && <div className="moments-paper-cursor"><div className="moments-paper-cursor-line" /></div>}
          </div>
        </div>

        <div className={`moments-overlay ${calendarOpen ? 'on' : ''}`} style={{ backgroundColor: paperColor }}>
          <div className="moments-overlay-inner">
            <div className="moments-overlay-head">
              <div className="moments-overlay-title">All Entries</div>
              <button className="moments-ov-close" type="button" onClick={() => setCalendarOpen(false)}>✕</button>
            </div>
            <div className="moments-cal-legend">
              <span><i className="gold" />S</span>
              <span><i className="blue" />X</span>
              <span><i className="both" />Both</span>
              <span><i className="empty" />Empty</span>
            </div>
            {renderMonth('may', 'May 2026', 14)}
            {renderMonth('apr', 'April 2026')}
            {renderMonth('mar', 'March 2026')}
          </div>
        </div>

        <div className={`moments-bg-picker ${bgPickerOpen ? 'on' : ''}`} style={{ backgroundColor: paperColor }}>
          <div className="moments-bg-picker-title">Paper</div>
          <div className="moments-bg-picker-section">
            <div className="moments-bg-picker-label">Color</div>
            <div className="moments-bg-colors">
              {MOMENTS_PAPER_COLORS.map(color => (
                <button className={`moments-bg-color ${paperColor === color ? 'on' : ''}`} type="button" key={color} style={{ backgroundColor: color }} onClick={() => setPaperColor(color)} aria-label={`Use paper color ${color}`} />
              ))}
            </div>
          </div>
          <div className="moments-bg-picker-section">
            <div className="moments-bg-picker-label">Pattern</div>
            <div className="moments-bg-patterns">
              {MOMENTS_PAPER_PATTERNS.map(pattern => (
                <button className={`moments-bg-pat ${paperPattern === pattern.id ? 'on' : ''}`} type="button" key={pattern.name} onClick={() => setPaperPattern(pattern.id)}>
                  <span className={`moments-bg-pat-preview ${pattern.preview}`} />
                  <span className="moments-bg-pat-name">{pattern.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

function ChirpOnboarding({ onComplete, existingProfile, language }) {
  const [screen, setScreen] = useState('intro')
  const [answers, setAnswers] = useState({})
  const [thing, setThing] = useState('')
  const [ownLight, setOwnLight] = useState('')
  const [birdName, setBirdName] = useState('')
  const [resultAnimal, setResultAnimal] = useState(null)

  const qIndex = ASSESSMENT_FLOW.indexOf(screen)
  const progress = qIndex >= 0 ? `${((qIndex + 1) / ASSESSMENT_FLOW.length) * 100}%` : '0%'
  const isQuestion = ONBOARDING_FLOW.includes(screen)
  const showProgress = qIndex >= 0
  const result = resultAnimal ? ONBOARDING_ANIMALS[resultAnimal] : null
  const isRetake = Boolean(existingProfile?.animal)
  const isChinese = language === 'zh'
  const questions = isChinese ? ONBOARDING_QUESTIONS : ONBOARDING_QUESTIONS_EN

  const goNext = () => {
    const index = ONBOARDING_FLOW.indexOf(screen)
    if (screen === 'q7' && isRetake) {
      setScreen('loading')
      window.setTimeout(() => {
        const animal = calculateOnboardingAnimal(answers)
        setResultAnimal(animal)
        setScreen('result')
      }, 2200)
      return
    }
    if (index < ONBOARDING_FLOW.length - 1) {
      setScreen(ONBOARDING_FLOW[index + 1])
      return
    }
    setScreen('loading')
    window.setTimeout(() => {
      const animal = calculateOnboardingAnimal(answers)
      setResultAnimal(animal)
      setScreen('result')
    }, 2200)
  }

  const goBack = () => {
    const index = ONBOARDING_FLOW.indexOf(screen)
    setScreen(index <= 0 ? 'intro' : ONBOARDING_FLOW[index - 1])
  }

  const chooseAnswer = (questionId, answerIndex) => {
    setAnswers(prev => ({ ...prev, [questionId]: answerIndex }))
    const nextIndex = ONBOARDING_FLOW.indexOf(questionId) + 1
    setScreen(ONBOARDING_FLOW[nextIndex])
  }

  const submitInputStep = (event) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    const hasValue = screen === 'q7' ? thing.trim() : birdName.trim()
    if (!hasValue) return
    event.preventDefault()
    goNext()
  }

  const finish = () => {
    const animal = resultAnimal || calculateOnboardingAnimal(answers)
    onComplete({
      animal,
      animalName: ONBOARDING_ANIMALS[animal]?.name || '小猫',
      birdName: existingProfile?.birdName || birdName.trim() || 'bird',
      focus: thing.trim(),
      ownLight: ownLight.trim() || null,
      completedAt: Date.now()
    })
  }

  return (
    <div className="chirp-onboarding">
      <div className={`chirp-onboarding-progress ${showProgress ? 'show' : ''}`}>
        <div style={{ width: progress }} />
      </div>

      <section className={`chirp-ob-screen ${screen === 'intro' ? 'active' : ''}`}>
        <div className="chirp-ob-bird"><OnboardingBird /></div>
        <div className="chirp-ob-greeting chirp-ob-intro-copy">
          {isChinese ? <><span>在你开始之前，</span><br /><span>能让我先认识你一下吗？</span><br /><span>几个小问题，很快的。</span></> : <><span>Before you start,</span><br /><span>may I get to know you first?</span><br /><span>Just a few quick questions.</span></>}
        </div>
        <button className="chirp-ob-primary" type="button" onClick={() => setScreen('q1')}>{isChinese ? '好啊' : 'Sure'}</button>
      </section>

      {Object.keys(questions).map(qId => {
        const q = questions[qId]
        return (
          <section className={`chirp-ob-screen chirp-ob-question-screen ${screen === qId ? 'active' : ''}`} key={qId}>
            <div className="chirp-ob-q-label">{q.label}</div>
            <div className="chirp-ob-q-text">{q.text}</div>
            <div className="chirp-ob-options">
              {q.options.map((option, index) => (
                <button className={`chirp-ob-option ${answers[qId] === index ? 'selected' : ''}`} type="button" key={option} onClick={() => chooseAnswer(qId, index)}>
                  {option}
                </button>
              ))}
            </div>
            {qId === 'q4' && (
              <div className="chirp-ob-input-wrap">
                <input className="chirp-ob-input" value={ownLight} onChange={(event) => setOwnLight(event.target.value)} placeholder={isChinese ? '其他（可选）' : 'Other (optional)'} />
              </div>
            )}
          </section>
        )
      })}

      <section className={`chirp-ob-screen chirp-ob-question-screen ${screen === 'q7' ? 'active' : ''}`}>
        <div className="chirp-ob-q-label">7 / 7</div>
        <div className="chirp-ob-q-text">{isChinese ? '最近占满你脑子的两件事是？' : 'What are two things taking up most of your mind lately?'}</div>
        <div className="chirp-ob-input-wrap">
          <input className="chirp-ob-input" value={thing} onChange={(event) => setThing(event.target.value)} onKeyDown={submitInputStep} />
          <div className="chirp-ob-input-hint">{isChinese ? '关键词就行，比如“跳槽、和他的关系”' : 'Keywords are enough, for example: career change, our relationship'}</div>
        </div>
      </section>

      <section className={`chirp-ob-screen ${screen === 'birdName' ? 'active' : ''}`}>
        <div className="chirp-ob-q-text">{isChinese ? <>最后！<br />为我取个帅翻宇宙的名字吧——<br />以后我就只认你叫的这个了</> : <>One last thing!<br />Give me a name that feels completely yours.<br />From now on, that is what I will answer to.</>}</div>
        <div className="chirp-ob-input-wrap">
          <input className="chirp-ob-input chirp-ob-name-input" value={birdName} onChange={(event) => setBirdName(event.target.value)} onKeyDown={submitInputStep} autoComplete="off" />
        </div>
      </section>

      <section className={`chirp-ob-screen ${screen === 'loading' ? 'active' : ''}`}>
        <div className="chirp-ob-bird"><OnboardingBird /></div>
        <div className="chirp-ob-loading">{isChinese ? 'chirp 观察中...' : 'chirp is observing...'}</div>
      </section>

      <section className={`chirp-ob-screen ${screen === 'result' ? 'active' : ''}`}>
        <div className="chirp-ob-result-avatar"><OnboardingAnimalAvatar animal={resultAnimal} /></div>
        <div className="chirp-ob-result-label">{isChinese ? '你是' : 'You are'}</div>
        <div className="chirp-ob-result-animal">{isChinese ? result?.name : result?.englishName}</div>
        <div className="chirp-ob-result-keywords">{isChinese ? result?.kw : result?.traitsEn}</div>
        <div className="chirp-ob-result-msg">{isChinese ? result?.msg : result?.lineEn}</div>
        <div className="chirp-ob-result-sig">{isChinese ? `— 来自${existingProfile?.birdName || birdName || 'bird'}` : `- From ${existingProfile?.birdName || birdName || 'bird'}`}</div>
        <button className="chirp-ob-primary" type="button" onClick={finish}>{isChinese ? '继续 →' : 'Continue →'}</button>
      </section>

      {isQuestion && (
        <div className="chirp-ob-nav">
          <button className={`chirp-ob-back ${screen === 'q1' ? 'hidden' : ''}`} type="button" onClick={goBack}>{isChinese ? '← 上一题' : '← Back'}</button>
        </div>
      )}
    </div>
  )
}

function PlanetCard({ planet, recent, language }) {
  const Art = planetArt[planet.id] || LoveCat
  const className = planet.id === 'work' ? 'pc-work' : 'pc-love'
  const isChinese = language === 'zh'

  return (
    <button className={`planet-card ${className}`} type="button" onClick={() => navigateTo('chirp', 'planet', planet.id)}>
      <div className="pc-avatar"><Art /></div>
      <div className="pc-name">{getPlanetCardTitle(planet)}</div>
      <div className="pc-quote">{recent.text}</div>
      <time className="pc-time">{localizeActivityTime(recent.time, isChinese)}</time>
    </button>
  )
}

function PersonaPage({ personas, planets, user, onPersonasChange, language }) {
  const isChinese = language === 'zh'
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [usePersona, setUsePersona] = useState(null)
  const [toast, setToast] = useState('')
  const [customColor, setCustomColor] = useState(DEFAULT_PERSONA_COLOR)
  const [draft, setDraft] = useState({
    name: '',
    role: '',
    description: '',
    systemPrompt: '',
    skills: '',
    avatarUrl: '',
    avatarFile: null,
    color: DEFAULT_PERSONA_COLOR
  })

  const showToast = (message) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 1800)
  }

  const handleAvatarUpload = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast(isChinese ? '请选择图片文件。' : 'Please choose an image file.')
      return
    }
    if (file.size > 3 * 1024 * 1024) {
      showToast(isChinese ? '头像图片需小于 3MB。' : 'Avatar must be under 3MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      const avatarUrl = reader.result
      const color = await extractDominantColor(avatarUrl)
      setDraft(prev => ({ ...prev, avatarFile: file, avatarUrl, color }))
    }
    reader.readAsDataURL(file)
  }

  const createPersona = async () => {
    const name = draft.name.trim()
    const systemPrompt = draft.systemPrompt.trim()
    if (!name || !systemPrompt) {
      showToast(isChinese ? '名称和系统提示词不能为空。' : 'Name and system prompt are required.')
      return
    }

    let uploadedAvatarUrl = ''
    if (user && draft.avatarFile) {
      try {
        uploadedAvatarUrl = await uploadPersonaAvatar(user, draft.avatarFile)
      } catch (error) {
        console.warn('Failed to upload persona avatar:', error)
        showToast(isChinese ? '头像上传失败，分身将不带图片保存。' : 'Avatar upload failed. Persona saved without image.')
      }
    }

    const persona = {
      id: `custom-${Date.now()}`,
      name,
      role: draft.role.trim() || 'custom persona',
      description: draft.description.trim() || (isChinese ? '你为私人星球对话创建的自定义分身。' : 'A custom persona created by you for private Planet conversations.'),
      systemPrompt,
      skills: draft.skills.trim(),
      avatarUrl: uploadedAvatarUrl || (!user ? draft.avatarUrl : ''),
      color: draft.color || '#F5C878',
      theme: buildPersonaTheme(draft.color || '#F5C878'),
      pricing: 'free',
      usageCount: 0,
      createdAt: Date.now()
    }
    if (user) {
      try {
        await saveCustomPersonaToSupabase(user, persona)
      } catch (error) {
        console.warn('Failed to save persona to Supabase:', error)
        saveCustomPersona(persona)
      }
    } else {
      saveCustomPersona(persona)
    }
    setDraft({ name: '', role: '', description: '', systemPrompt: '', skills: '', avatarUrl: '', avatarFile: null, color: DEFAULT_PERSONA_COLOR })
    setCreatorOpen(false)
    onPersonasChange()
    showToast(isChinese ? '分身已创建。' : 'Persona created.')
  }

  const attachPersona = async (planet, persona) => {
    addPersonaToPlanet(planet.id, persona.id)
    if (planet.dbId) {
      try {
        const existing = await loadPlanetMemberPersonas(planet, getAllPersonas(), personas)
        const next = existing.some(member => member.id === persona.id) ? existing : [...existing, persona]
        await savePlanetMemberPersonas(planet, next)
      } catch (error) {
        console.warn('Failed to save persona to Planet:', error)
      }
    }
    setUsePersona(null)
    showToast(isChinese ? `${persona.name} 已加入 ${planet.roomName}。` : `${persona.name} added to ${planet.roomName}.`)
  }

  return (
    <main className="chirp-persona-page">
      <div className="chirp-persona-grid">
        <button className="chirp-persona-card chirp-persona-create" type="button" onClick={() => setCreatorOpen(true)}>
          <div className="persona-title-row persona-create-title-row">
            <span className="persona-avatar persona-create-avatar">+</span>
            <strong>{isChinese ? '创建分身' : 'Create Persona'}</strong>
          </div>
          <p>{isChinese ? '编写系统提示词，定义技能，并上传头像。' : 'Write a system prompt, define skills, and upload an avatar.'}</p>
          <div className="persona-card-foot">
            <span className="persona-create-button">{isChinese ? '创建' : 'Create'}</span>
          </div>
        </button>

        {personas.map(persona => (
          <article className={`chirp-persona-card persona-${persona.pricing}`} key={persona.id} style={getPersonaThemeStyle(persona)}>
            <div className="persona-price">{persona.pricing === 'paid' ? (isChinese ? '付费' : 'Paid') : (isChinese ? '免费' : 'Free')}</div>
            <div className="persona-title-row">
              <div className="persona-avatar"><PersonaAvatar persona={persona} /></div>
              <h2>{persona.name}</h2>
            </div>
            <p>{isChinese && PERSONA_DESCRIPTION_ZH[persona.id] ? PERSONA_DESCRIPTION_ZH[persona.id] : persona.description}</p>
            <div className="persona-card-foot">
              <span>{isChinese ? `${persona.usageCount || 0} 个使用中` : `${persona.usageCount || 0} in use`}</span>
              <button type="button" onClick={() => navigateTo('chirp', 'persona-test', persona.id)}>{isChinese ? '测试' : 'Test'}</button>
              <button type="button" onClick={() => setUsePersona(persona)}>{isChinese ? '使用' : 'Use'}</button>
            </div>
          </article>
        ))}
      </div>

      {creatorOpen && (
        <div className="persona-modal-layer">
          <section className="persona-modal">
            <button className="persona-modal-close" type="button" onClick={() => setCreatorOpen(false)}>×</button>
            <h2>{isChinese ? '创建分身' : 'Create Persona'}</h2>
            <div className="persona-modal-top-row">
              <label className="persona-avatar-picker" style={{ '--draft-avatar-bg': draft.color }}>
                <input type="file" accept="image/*" onChange={handleAvatarUpload} />
                {draft.avatarUrl ? (
                  <img src={draft.avatarUrl} alt="" />
                ) : (
                  <span>{getPersonaAvatarLabel(draft.name)}</span>
                )}
                <em>{isChinese ? '上传图片设置头像' : 'Upload an avatar image'}</em>
              </label>
              <div className="persona-color-palette" aria-label={isChinese ? '选择头像颜色' : 'Choose avatar color'}>
                {PERSONA_AVATAR_COLORS.map(color => (
                  <button
                    className={draft.color === color ? 'active' : ''}
                    type="button"
                    key={color}
                    style={{ backgroundColor: color }}
                    aria-label={isChinese ? `使用颜色 ${color}` : `Use color ${color}`}
                    onClick={() => setDraft(prev => ({ ...prev, color }))}
                  />
                ))}
                <label className={`persona-custom-color ${!PERSONA_AVATAR_COLORS.includes(draft.color) ? 'active' : ''}`}>
                  <input
                    type="color"
                    value={customColor}
                    aria-label={isChinese ? '选择自定义头像颜色' : 'Choose custom avatar color'}
                    onChange={(event) => {
                      setCustomColor(event.target.value)
                      setDraft(prev => ({ ...prev, color: event.target.value }))
                    }}
                  />
                  <span><PaletteIcon /></span>
                </label>
              </div>
            </div>
            <label className="persona-name-field">
              <span>{isChinese ? '名称' : 'Name'}</span>
              <input value={draft.name} onChange={(event) => setDraft(prev => ({ ...prev, name: event.target.value }))} />
            </label>
            <label>
              <span>{isChinese ? '技能' : 'Skill'}</span>
              <input value={draft.skills} onChange={(event) => setDraft(prev => ({ ...prev, skills: event.target.value }))} />
            </label>
            <label>
              <span>{isChinese ? '简短介绍' : 'Short intro'}</span>
              <textarea value={draft.description} onChange={(event) => setDraft(prev => ({ ...prev, description: event.target.value }))} rows="3" />
            </label>
            <label>
              <span>{isChinese ? '系统提示词' : 'System prompt'}</span>
              <textarea value={draft.systemPrompt} onChange={(event) => setDraft(prev => ({ ...prev, systemPrompt: event.target.value }))} rows="5" />
            </label>
            <button className="persona-primary" type="button" onClick={createPersona}>{isChinese ? '创建' : 'Create'}</button>
          </section>
        </div>
      )}

      {usePersona && (
        <div className="persona-modal-layer">
          <section className="persona-use-panel">
            <button className="persona-modal-close" type="button" onClick={() => setUsePersona(null)}>×</button>
            <h2>{isChinese ? '加入星球' : 'Add to Planet'}</h2>
            {planets.map(planet => {
              const Avatar = planet.avatar
              return (
                <div className="persona-planet-row" key={planet.id}>
                  <span style={{ backgroundColor: planet.color }}><Avatar /></span>
                  <strong>{planet.roomName}</strong>
                  <button type="button" onClick={() => attachPersona(planet, usePersona)}>+</button>
                </div>
              )
            })}
          </section>
        </div>
      )}

      {toast && <div className="chirp-toast persona-toast">{toast}</div>}
    </main>
  )
}

function DrawerPlanetCard({ planet, onClick, recent, language, active = false, expandable = false, expanded = false, onToggle }) {
  const Art = planetArt[planet.id] || LoveCat
  const className = planet.id === 'work' ? 'pc-work' : 'pc-love'
  const isChinese = language === 'zh'

  return (
    <button className={`planet-card drawer-planet-card ${className} ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      <div className="drawer-planet-main">
        <div className="pc-avatar"><Art /></div>
        <div className="drawer-planet-copy">
          <div className="drawer-planet-row">
            <div className="pc-name">{truncateTitle(getPlanetCardTitle(planet), 4)}</div>
            {expandable ? (
              <span
                className={`pc-chevron ${expanded ? 'open' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={expanded ? (isChinese ? '收起' : 'Collapse') : (isChinese ? '展开' : 'Expand')}
                onClick={(event) => { event.stopPropagation(); onToggle?.() }}
              >
                <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
              </span>
            ) : (
              <time className="pc-time">{localizeActivityTime(recent.time, isChinese)}</time>
            )}
          </div>
          <div className="pc-quote">{recent.rawText || recent.text}</div>
        </div>
      </div>
    </button>
  )
}

// `docked`: render the same drawer as a permanent left column (not a sliding
// overlay) — always open, planets list, no scrim/close/resize. activePlanetId
// highlights the current chat.
// A conversation row (Bird DM or a persona DM) — same compact look as a planet
// card. Click enters the chat directly, like the group chat.
// WeChat-style group avatar: every member (up to 9) shown, shrunk and tiled
// regularly. Columns by count (≤1→1, ≤4→2, else 3, max 3×3); partial last row
// is centered, so there are no empty cells.
function GroupAvatar({ members = [] }) {
  const items = members.slice(0, 9)
  if (!items.length) return null
  const cols = items.length <= 1 ? 1 : items.length <= 4 ? 2 : 3
  return (
    <div className="group-avatar" style={{ '--cols': cols }}>
      {items.map(member => (
        <span key={member.id} className="group-avatar-cell" style={{ backgroundColor: member.color }}>
          <PersonaAvatar persona={member} />
        </span>
      ))}
    </div>
  )
}

// A planet is a folder (directory) row — same row layout as Bird/conversations
// (38px avatar, name), just with a chevron instead of a preview. Clicking the
// whole row toggles its conversations open/closed.
function DrawerPlanetFolder({ planet, language, expanded, onToggle, onRename }) {
  const Art = planetArt[planet.id] || LoveCat
  const isChinese = language === 'zh'
  const name = getPlanetCardTitle(planet)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const startEdit = (event) => { event.stopPropagation(); setDraft(name); setEditing(true) }
  const commit = () => {
    const value = draft.trim()
    if (value && value !== name) onRename?.(planet, value)
    setEditing(false)
  }
  return (
    <div className="planet-card drawer-planet-card drawer-folder" role="button" tabIndex={0} onClick={() => { if (!editing) onToggle() }}>
      <div className="drawer-planet-main">
        <div className="pc-avatar"><Art /></div>
        <div className="drawer-planet-copy">
          <div className="drawer-planet-row">
            {editing ? (
              <input
                className="pc-name-input"
                value={draft}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); commit() }
                  if (event.key === 'Escape') { setDraft(name); setEditing(false) }
                }}
              />
            ) : (
              <div className="pc-name pc-folder-name">
                <span className="pc-folder-name-text" onClick={startEdit} title={isChinese ? '点击改名' : 'Click to rename'}>{truncateTitle(name, 10)}</span>
                <button type="button" className="pc-folder-edit" onClick={startEdit} aria-label={isChinese ? '改名' : 'Rename'}>
                  <svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                </button>
              </div>
            )}
            <span
              className={`pc-chevron ${expanded ? 'open' : ''}`}
              role="button"
              aria-label={expanded ? (isChinese ? '收起' : 'Collapse') : (isChinese ? '展开' : 'Expand')}
              onClick={(event) => { event.stopPropagation(); onToggle() }}
            >
              <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function DrawerConversationCard({ avatar, name, lastText, time, active, onClick, language, color, pinned = false, nested = false }) {
  const isChinese = language === 'zh'
  return (
    <button className={`planet-card drawer-planet-card dm-card ${pinned ? 'pinned' : ''} ${nested ? 'nested' : ''} ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      <div className="drawer-planet-main">
        <div className="pc-avatar dm-card-avatar" style={color ? { backgroundColor: color } : undefined}>{avatar}</div>
        <div className="drawer-planet-copy">
          <div className="drawer-planet-row">
            <div className="pc-name">{truncateTitle(name, 8)}</div>
            {time ? <time className="pc-time">{time}</time> : null}
          </div>
          <div className="pc-quote">{lastText || (isChinese ? '开始聊天' : 'Start chatting')}</div>
        </div>
      </div>
    </button>
  )
}

function SideDrawer({ open, mode, setMode, onClose, recentFor, planets, drawerWidth, onResizeStart, language, docked = false, activePlanetId = null, activeDmAgentId = null, dmConversations = [], personas = [], onCreatePlanet, onCreatePersona, onRenamePlanet }) {
  const isChinese = language === 'zh'
  const isOpen = docked || open
  const effectiveMode = docked ? 'planets' : mode
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const createMenuRef = useRef(null)
  // Planets are expanded by default (empty = none collapsed); toggling adds/removes.
  const [collapsedPlanets, setCollapsedPlanets] = useState(() => new Set())
  const togglePlanet = (planetId) => setCollapsedPlanets(prev => {
    const next = new Set(prev)
    if (next.has(planetId)) next.delete(planetId)
    else next.add(planetId)
    return next
  })
  const fmtTime = (iso) => (iso ? localizeActivityTime(formatActivityTime(new Date(iso).getTime()), isChinese) : '')
  useEffect(() => {
    if (!createMenuOpen) return
    const onDown = (event) => {
      if (createMenuRef.current && !createMenuRef.current.contains(event.target)) setCreateMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [createMenuOpen])
  return (
    <>
      {!docked && open && <button className="chirp-home-drawer-scrim" type="button" aria-label={isChinese ? '关闭菜单' : 'Close menu'} onClick={onClose} />}
      <aside className={`chirp-home-drawer ${isOpen ? 'open' : ''} ${docked ? 'docked' : ''}`} style={{ '--drawer-width': `${drawerWidth}px` }}>
        <div className="chirp-home-drawer-head">
          {effectiveMode === 'planets' ? (
            <strong>{isChinese ? '我的星球' : 'My Planet'}</strong>
          ) : (
            <button
              className="chirp-home-drawer-home"
              type="button"
              onClick={() => {
                onClose()
                navigateTo('chirp')
              }}
            >
              home
            </button>
          )}
          <div className="chirp-create-menu-wrap" ref={createMenuRef}>
            <button
              className="chirp-create-btn"
              type="button"
              aria-label={isChinese ? '新建' : 'Create'}
              onClick={() => setCreateMenuOpen(open => !open)}
            >+</button>
            {createMenuOpen && (
              <div className="chirp-create-menu">
                <button type="button" onClick={() => { setCreateMenuOpen(false); onClose?.(); onCreatePlanet?.() }}>{isChinese ? '创建我的星球' : 'create my planet'}</button>
                <button type="button" onClick={() => { setCreateMenuOpen(false); onClose?.(); onCreatePersona?.() }}>{isChinese ? '创建分身' : 'create my persona'}</button>
              </div>
            )}
          </div>
          {!docked && <button type="button" aria-label={isChinese ? '关闭菜单' : 'Close menu'} onClick={onClose}>×</button>}
        </div>

        {effectiveMode === 'menu' ? (
          <div className="chirp-home-menu-list">
            <button
              type="button"
              onClick={() => {
                onClose()
                setMode('planets')
                navigateTo('chirp', 'planet', CHIRP_PLANETS[0].id)
              }}
            >
              <span>◐</span><strong>{isChinese ? '星球' : 'Planet'}</strong>
            </button>
            <button
              type="button"
              onClick={() => {
                onClose()
                navigateTo('chirp', 'persona')
              }}
            >
              <span>◎</span><strong>{isChinese ? '分身' : 'Persona'}</strong>
            </button>
            <button
              type="button"
              onClick={() => {
                onClose()
                navigateTo('chirp', 'about-me')
              }}
            >
              <span>○</span><strong>{isChinese ? '关于我' : 'About Me'}</strong>
            </button>
          </div>
        ) : (
          <div className="chirp-home-drawer-planets">
            <DrawerConversationCard
              avatar={<HomeBird />}
              name={isChinese ? '小鸟' : 'Bird'}
              lastText={dmConversations.find(dm => dm.agentId === 'bird')?.lastText || ''}
              time={fmtTime(dmConversations.find(dm => dm.agentId === 'bird')?.lastAt)}
              pinned
              active={activeDmAgentId === 'bird'}
              language={language}
              onClick={() => { onClose(); navigateTo('chirp', 'dm', 'bird') }}
            />
            {planets.map(planet => {
              const planetPersonas = getPersonasForPlanet(planet)
              const planetPersonaIds = new Set(planetPersonas.map(item => item.id))
              const planetDms = dmConversations.filter(dm => planetPersonaIds.has(dm.agentId))
              const expanded = !collapsedPlanets.has(planet.id)
              const planetRecent = recentFor(planet)
              return (
                <Fragment key={planet.id}>
                  <DrawerPlanetFolder
                    planet={planet}
                    language={language}
                    expanded={expanded}
                    onToggle={() => togglePlanet(planet.id)}
                    onRename={onRenamePlanet}
                  />
                  {expanded && (
                    <DrawerConversationCard
                      nested
                      avatar={<GroupAvatar members={[...planetPersonas, { id: 'user', color: '#F5C878', avatar: UserAvatar }]} />}
                      name={getGroupName(planet)}
                      lastText={planetRecent.rawText || planetRecent.text}
                      time={localizeActivityTime(planetRecent.time, isChinese)}
                      active={planet.id === activePlanetId}
                      language={language}
                      onClick={() => { onClose(); navigateTo('chirp', 'planet', planet.id) }}
                    />
                  )}
                  {expanded && planetDms.map(dm => {
                    const persona = personas.find(item => item.id === dm.agentId)
                    return (
                      <DrawerConversationCard
                        key={dm.conversationId}
                        nested
                        avatar={persona ? <PersonaAvatar persona={persona} /> : null}
                        name={persona?.name || dm.title || dm.agentId}
                        lastText={dm.lastText}
                        time={fmtTime(dm.lastAt)}
                        color={persona?.color}
                        active={activeDmAgentId === dm.agentId}
                        language={language}
                        onClick={() => { onClose(); navigateTo('chirp', 'persona-dm', dm.agentId) }}
                      />
                    )
                  })}
                </Fragment>
              )
            })}
            {(() => {
              const inPlanet = new Set(planets.flatMap(planet => getPersonasForPlanet(planet).map(item => item.id)))
              return dmConversations.filter(dm => dm.agentId !== 'bird' && !inPlanet.has(dm.agentId)).map(dm => {
                const persona = personas.find(item => item.id === dm.agentId)
                return (
                  <DrawerConversationCard
                    key={dm.conversationId}
                    avatar={persona ? <PersonaAvatar persona={persona} /> : null}
                    name={persona?.name || dm.title || dm.agentId}
                    lastText={dm.lastText}
                    color={persona?.color}
                    active={activeDmAgentId === dm.agentId}
                    language={language}
                    onClick={() => { onClose(); navigateTo('chirp', 'persona-dm', dm.agentId) }}
                  />
                )
              })
            })()}
          </div>
        )}

        {onResizeStart && <button className="chirp-home-drawer-resize" type="button" aria-label={isChinese ? '调整侧栏宽度' : 'Resize sidebar'} onMouseDown={onResizeStart} />}
      </aside>
    </>
  )
}

export default ChirpHomePage

