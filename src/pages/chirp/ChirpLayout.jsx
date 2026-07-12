import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { Bird, Sparkles, Sofa, NotebookPen, CircleUserRound, Menu, X, LogOut } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { OnboardingAnimalAvatar, readOnboardingProfile } from '@/pages/ChirpHomePage'
import { cn } from '@/lib/utils'

const CHIRP_LANGUAGE_KEY = 'chirpUiLanguage'

const readChirpLanguage = () => {
  if (typeof window === 'undefined') return 'zh'
  return window.localStorage.getItem(CHIRP_LANGUAGE_KEY) === 'en' ? 'en' : 'zh'
}

const NAV_ITEMS = [
  { to: 'advisor', icon: Sparkles, zh: '军师', en: 'Advisor' },
  { to: 'room', icon: Sofa, zh: '客厅', en: 'Living room' },
  { to: 'diary', icon: NotebookPen, zh: '日记本', en: 'Journal' },
  { to: 'me', icon: CircleUserRound, zh: '我', en: 'Me' }
]

function NavList({ language, onNavigate }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ to, icon: Icon, zh, en }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-2xl px-4 py-3 text-[15px] font-medium transition-colors',
              isActive
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-500 hover:bg-black/5 hover:text-neutral-700'
            )
          }
        >
          <Icon size={20} strokeWidth={2} />
          {language === 'zh' ? zh : en}
        </NavLink>
      ))}
    </nav>
  )
}

function SidebarFooter({ language, onLanguageChange, onSignOut, profile, user }) {
  const displayName =
    user?.user_metadata?.display_name || user?.email?.split('@')[0] || ''

  return (
    <div className="mt-auto flex flex-col gap-3 pt-4">
      <div className="h-px bg-black/5" />
      <div
        className="flex items-center gap-1 self-start rounded-full bg-black/5 p-0.5 text-xs"
        role="group"
        aria-label={language === 'zh' ? '界面语言' : 'Interface language'}
      >
        {['zh', 'en'].map((lang) => (
          <button
            key={lang}
            type="button"
            onClick={() => onLanguageChange(lang)}
            className={cn(
              'cursor-pointer rounded-full border-0 px-2.5 py-1 font-medium transition-colors',
              language === lang ? 'bg-white text-neutral-800 shadow-sm' : 'bg-transparent text-neutral-400'
            )}
          >
            {lang === 'zh' ? '中' : 'EN'}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2.5 rounded-2xl px-1 py-1">
        <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-white shadow-sm">
          {profile ? <OnboardingAnimalAvatar animal={profile.animal} /> : <CircleUserRound size={18} className="text-neutral-400" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-600">{displayName}</span>
        <button
          type="button"
          onClick={onSignOut}
          title={language === 'zh' ? '退出登录' : 'Sign out'}
          className="cursor-pointer rounded-full border-0 bg-transparent p-2 text-neutral-400 transition-colors hover:bg-black/5 hover:text-neutral-700"
        >
          <LogOut size={16} />
        </button>
      </div>
    </div>
  )
}

export default function ChirpLayout() {
  const { user, loading, signOut } = useAuth()
  const [language, setLanguage] = useState(readChirpLanguage)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [profile, setProfile] = useState(() => readOnboardingProfile())

  useEffect(() => {
    const refresh = () => setProfile(readOnboardingProfile())
    window.addEventListener('chirp:onboarding-updated', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('chirp:onboarding-updated', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  useEffect(() => {
    if (!drawerOpen) return undefined
    const onKey = (e) => e.key === 'Escape' && setDrawerOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  if (loading) {
    return (
      <div className="grid h-dvh place-items-center bg-[#FBF9F4]">
        <Bird size={28} className="animate-pulse text-neutral-300" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  const changeLanguage = (lang) => {
    window.localStorage.setItem(CHIRP_LANGUAGE_KEY, lang)
    setLanguage(lang)
  }

  const sidebarInner = (
    <>
      <div className="flex items-center gap-2.5 px-3 pb-6 pt-1">
        <Bird size={22} strokeWidth={2.2} className="text-neutral-800" />
        <span className="text-[17px] font-semibold tracking-tight text-neutral-900">chirp</span>
      </div>
      <NavList language={language} onNavigate={() => setDrawerOpen(false)} />
      <SidebarFooter
        language={language}
        onLanguageChange={changeLanguage}
        onSignOut={signOut}
        profile={profile}
        user={user}
      />
    </>
  )

  return (
    <div className="flex h-dvh w-full bg-[#FBF9F4] text-neutral-900">
      {/* 桌面侧栏 */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-black/5 bg-[#F5F1E8] px-3 py-5 md:flex">
        {sidebarInner}
      </aside>

      {/* 手机：悬浮汉堡 + 抽屉（Tolan 式） */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-label={language === 'zh' ? '打开菜单' : 'Open menu'}
        className="fixed left-4 top-4 z-40 cursor-pointer rounded-full border-0 bg-white/90 p-2.5 shadow-md backdrop-blur transition-transform active:scale-95 md:hidden"
      >
        <Menu size={20} />
      </button>
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col rounded-r-3xl bg-[#F7F4ED] px-4 py-5 shadow-2xl">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label={language === 'zh' ? '关闭菜单' : 'Close menu'}
              className="absolute right-3 top-4 cursor-pointer rounded-full border-0 bg-transparent p-2 text-neutral-400 hover:bg-black/5"
            >
              <X size={18} />
            </button>
            {sidebarInner}
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet context={{ language }} />
      </main>
    </div>
  )
}
