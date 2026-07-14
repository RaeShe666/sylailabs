import { useEffect, useState } from 'react'
import { Menu, X, MessagesSquare, NotebookPen, CircleUserRound, LogOut } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import ChirpPage from '@/pages/ChirpPage'
import {
  ChirpOnboarding,
  HomeBird,
  OnboardingAnimalAvatar,
  readOnboardingProfile,
  saveOnboardingProfile
} from '@/pages/ChirpHomePage'
import { loadChirpProfile, saveChirpProfile } from '@/pages/chirpSupabase'
import { ensureCoupleSpace } from './coupleSpace'
import JournalPage from './JournalPage'
import AboutMePage from './AboutMePage'
import { cn } from '@/lib/utils'

const CHIRP_LANGUAGE_KEY = 'chirpUiLanguage'

const navigateTo = (...segments) => {
  window.location.hash = '/' + segments.filter(Boolean).join('/')
}

const readChirpLanguage = () => {
  if (typeof window === 'undefined') return 'en'
  return window.localStorage.getItem(CHIRP_LANGUAGE_KEY) === 'zh' ? 'zh' : 'en'
}

const NAV_ITEMS = [
  { key: 'space', icon: MessagesSquare, label: 'Space', hash: ['chirp'] },
  { key: 'journal', icon: NotebookPen, label: 'Journal', hash: ['chirp', 'journal'] },
  { key: 'me', icon: CircleUserRound, label: 'About me', hash: ['chirp', 'me'] }
]

function BirdSplash() {
  return (
    <div className="grid h-full w-full place-items-center">
      <span className="size-12 animate-pulse"><HomeBird /></span>
    </div>
  )
}

// 主对话窗口：唯一的窗口（A+bird，B 加入后三方），复用 planet 聊天交互
function CoupleChat({ language }) {
  const { user } = useAuth()
  const [space, setSpace] = useState(null)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!user) return undefined
    let alive = true
    setError(null)
    ensureCoupleSpace(user)
      .then(config => { if (alive) setSpace(config) })
      .catch(err => { if (alive) setError(err) })
    return () => { alive = false }
  }, [user, attempt])

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="text-sm text-[var(--text-secondary)]">
          {language === 'zh' ? '空间没能加载出来。' : "Couldn't load your space."}
        </p>
        <button
          type="button"
          onClick={() => setAttempt(value => value + 1)}
          className="cursor-pointer rounded-full border border-[var(--border-light)] bg-white px-4 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--gray-50)]"
        >
          {language === 'zh' ? '重试' : 'Retry'}
        </button>
      </div>
    )
  }

  if (!space) return <BirdSplash />

  return <ChirpPage planetConfig={{ ...space, avatar: HomeBird }} language={language} />
}

export default function ChirpAppShell({ page }) {
  const { user, loading, signOut } = useAuth()
  const [language, setLanguage] = useState(readChirpLanguage)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [profile, setProfile] = useState(() => readOnboardingProfile())
  const [profileChecked, setProfileChecked] = useState(() => Boolean(readOnboardingProfile()))
  const [editingProfile, setEditingProfile] = useState(false)

  // localStorage 没有 profile 时，尝试从 DB 恢复（换设备场景），失败则走 onboarding
  useEffect(() => {
    if (!user || profile || profileChecked) return undefined
    let alive = true
    ;(async () => {
      try {
        const remote = await loadChirpProfile(user)
        if (alive && remote?.animal) {
          saveOnboardingProfile(remote)
          setProfile(remote)
        }
      } catch { /* 走 onboarding */ }
      if (alive) setProfileChecked(true)
    })()
    return () => { alive = false }
  }, [user, profile, profileChecked])

  useEffect(() => {
    if (!loading && !user) navigateTo('login')
  }, [loading, user])

  useEffect(() => {
    if (!drawerOpen) return undefined
    const onKey = (event) => event.key === 'Escape' && setDrawerOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  if (loading || !user) {
    return <div className="h-dvh w-full bg-[var(--bg-secondary)]"><BirdSplash /></div>
  }

  const changeLanguage = (nextLanguage) => {
    window.localStorage.setItem(CHIRP_LANGUAGE_KEY, nextLanguage)
    setLanguage(nextLanguage)
  }

  const completeOnboarding = async (nextProfile) => {
    saveOnboardingProfile(nextProfile)
    setProfile(nextProfile)
    setEditingProfile(false)
    try {
      await saveChirpProfile(user, nextProfile)
    } catch (error) {
      console.warn('Failed to save Chirp profile:', error)
    }
  }

  // 首次进入：先做 onboarding（旧组件占位），完成后直接落进对话
  if (profileChecked && !profile) {
    return (
      <div className="h-dvh w-full bg-[var(--bg-secondary)]">
        <ChirpOnboarding onComplete={completeOnboarding} language={language} />
      </div>
    )
  }
  if (!profile) {
    return <div className="h-dvh w-full bg-[var(--bg-secondary)]"><BirdSplash /></div>
  }

  const activeKey = page === 'journal' ? 'journal' : page === 'me' ? 'me' : 'space'
  const displayName = user?.user_metadata?.display_name || user?.email?.split('@')[0] || ''

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-[var(--bg-secondary)] text-[var(--text-primary)]">
      {/* Tolan 式：功能栏默认收起，点按钮滑出 */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-label="Menu"
        className="fixed left-4 top-3.5 z-40 cursor-pointer rounded-full border-0 bg-white/90 p-2.5 shadow-md backdrop-blur transition-transform active:scale-95"
      >
        <Menu size={18} />
      </button>

      <main className="flex min-h-0 flex-1 flex-col">
        {activeKey === 'journal' && <JournalPage language={language} />}
        {activeKey === 'me' && (
          <AboutMePage profile={profile} language={language} onEditProfile={() => setEditingProfile(true)} />
        )}
        {activeKey === 'space' && <CoupleChat language={language} />}
      </main>

      {editingProfile && (
        <ChirpOnboarding onComplete={completeOnboarding} existingProfile={profile} language={language} />
      )}

      {drawerOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col rounded-r-2xl bg-white px-4 py-5 shadow-2xl">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close"
              className="absolute right-3 top-4 cursor-pointer rounded-full border-0 bg-transparent p-2 text-[var(--text-muted)] hover:bg-[var(--gray-100)]"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-2 px-2 pb-6 pt-0.5">
              <span className="size-8 shrink-0"><HomeBird /></span>
              <span className="text-base font-semibold tracking-tight">chirp</span>
            </div>

            <nav className="flex flex-col gap-0.5">
              {NAV_ITEMS.map(({ key, icon: Icon, label, hash }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setDrawerOpen(false); navigateTo(...hash) }}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-xl border-0 px-3 py-2.5 text-left text-sm font-medium transition-colors',
                    activeKey === key
                      ? 'bg-[#69b1f0]/15 text-[var(--text-primary)]'
                      : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--gray-100)] hover:text-[var(--text-primary)]'
                  )}
                >
                  <Icon size={18} strokeWidth={2} />
                  {label}
                </button>
              ))}
            </nav>

            <div className="mt-auto flex flex-col gap-2.5 pt-4">
              <div className="h-px bg-[var(--border-light)]" />
              <div className="flex items-center gap-1 self-start rounded-full bg-[var(--gray-100)] p-0.5 text-xs" role="group" aria-label="Language">
                {['zh', 'en'].map(lang => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => changeLanguage(lang)}
                    className={cn(
                      'cursor-pointer rounded-full border-0 px-2.5 py-1 font-medium transition-colors',
                      language === lang
                        ? 'bg-white text-[var(--text-primary)] shadow-sm'
                        : 'bg-transparent text-[var(--text-muted)]'
                    )}
                  >
                    {lang === 'zh' ? '中' : 'EN'}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 py-1">
                <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full">
                  <OnboardingAnimalAvatar animal={profile.animal} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">{displayName}</span>
                <button
                  type="button"
                  onClick={async () => { await signOut(); navigateTo() }}
                  title="Sign out"
                  className="cursor-pointer rounded-full border-0 bg-transparent p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--gray-100)] hover:text-[var(--text-primary)]"
                >
                  <LogOut size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
