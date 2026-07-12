import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { Sparkles, MessagesSquare, NotebookPen, CircleUserRound, Menu, X, LogOut } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { OnboardingAnimalAvatar, readOnboardingProfile, HomeBird } from '@/pages/ChirpHomePage'
import { cn } from '@/lib/utils'

const CHIRP_LANGUAGE_KEY = 'chirpUiLanguage'

const readChirpLanguage = () => {
  if (typeof window === 'undefined') return 'zh'
  return window.localStorage.getItem(CHIRP_LANGUAGE_KEY) === 'en' ? 'en' : 'zh'
}

const NAV_ITEMS = [
  { to: 'advisor', icon: Sparkles, label: 'advisor' },
  { to: 'room', icon: MessagesSquare, label: 'group chat' },
  { to: 'diary', icon: NotebookPen, label: 'journal' },
  { to: 'me', icon: CircleUserRound, label: 'me' }
]

function NavList({ onNavigate }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-[var(--radius-lg)] px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-[#69b1f0]/15 text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--gray-100)] hover:text-[var(--text-primary)]'
            )
          }
        >
          <Icon size={18} strokeWidth={2} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

function SidebarFooter({ language, onLanguageChange, onSignOut, profile, user }) {
  const displayName =
    user?.user_metadata?.display_name || user?.email?.split('@')[0] || ''

  return (
    <div className="mt-auto flex flex-col gap-2.5 pt-4">
      <div className="h-px bg-[var(--border-light)]" />
      <div
        className="flex items-center gap-1 self-start rounded-full bg-[var(--gray-100)] p-0.5 text-xs"
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
          {profile ? <OnboardingAnimalAvatar animal={profile.animal} /> : <CircleUserRound size={18} className="text-[var(--text-muted)]" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">{displayName}</span>
        <button
          type="button"
          onClick={onSignOut}
          title={language === 'zh' ? '退出登录' : 'Sign out'}
          className="cursor-pointer rounded-full border-0 bg-transparent p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--gray-100)] hover:text-[var(--text-primary)]"
        >
          <LogOut size={15} />
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
      <div className="grid h-dvh place-items-center bg-[var(--bg-secondary)]">
        <span className="size-10 animate-pulse"><HomeBird /></span>
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
      <div className="flex items-center gap-2 px-2 pb-5 pt-0.5">
        <span className="size-8 shrink-0"><HomeBird /></span>
        <span className="text-base font-semibold tracking-tight text-[var(--text-primary)]">chirp</span>
      </div>
      <NavList onNavigate={() => setDrawerOpen(false)} />
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
    <div className="flex h-dvh w-full bg-[var(--bg-secondary)] text-[var(--text-primary)]">
      {/* 桌面侧栏 */}
      <aside className="hidden w-44 shrink-0 flex-col border-r border-[var(--border-light)] bg-white px-2.5 py-4 md:flex">
        {sidebarInner}
      </aside>

      {/* 手机：悬浮汉堡 + 抽屉 */}
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
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col rounded-r-2xl bg-white px-3 py-4 shadow-2xl">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label={language === 'zh' ? '关闭菜单' : 'Close menu'}
              className="absolute right-3 top-4 cursor-pointer rounded-full border-0 bg-transparent p-2 text-[var(--text-muted)] hover:bg-[var(--gray-100)]"
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
