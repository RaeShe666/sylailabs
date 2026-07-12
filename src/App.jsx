import { useEffect, useMemo, useRef, useState } from 'react'
import { HashRouter, Routes, Route, NavLink, Navigate, Outlet, useNavigate, useParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import BrandStudioPage from './pages/BrandStudioPage'
import LoginPage from './pages/LoginPage'
import ChirpHomePage from './pages/ChirpHomePage'
import ChirpLayout from './pages/chirp/ChirpLayout'
import { AdvisorPage, RoomPage, DiaryPage, MePage } from './pages/chirp/placeholders'
import './App.css'

const CHIRP_LANGUAGE_KEY = 'chirpUiLanguage'

const readChirpLanguage = () => {
  if (typeof window === 'undefined') return 'zh'
  return window.localStorage.getItem(CHIRP_LANGUAGE_KEY) === 'en' ? 'en' : 'zh'
}

/* ---------- SYL.AILABS 站点外壳（落地页 / Brand Studio，保持原顶部导航） ---------- */

function SiteShell() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/')
  }

  return (
    <div className="app">
      <nav className="global-nav">
        <div className="global-nav-brand">
          <img
            src="/logo-home-transparent.png"
            alt="Logo"
            className="global-nav-logo"
            onClick={() => navigate('/')}
          />
          <button className="global-nav-brand-text" type="button" onClick={() => navigate('/')}>
            SYL.AILABS
          </button>
        </div>

        <div className="global-nav-links">
          <NavLink className={({ isActive }) => `global-nav-link ${isActive ? 'active' : ''}`} to="/brandkit">
            Brand Studio
          </NavLink>
          <NavLink className="global-nav-link" to="/chirp">
            Chirp
          </NavLink>
        </div>

        <div className="global-nav-right">
          {user ? (
            <UserMenu user={user} onSignOut={handleSignOut} />
          ) : (
            <a className="global-nav-auth" onClick={() => navigate('/login')}>
              [ Sign In ]
            </a>
          )}
        </div>
      </nav>

      <div className="app-body">
        <Outlet />
      </div>
    </div>
  )
}

function LandingPage() {
  return (
    <div className="landing-page">
      <div className="landing-text">
        <Typewriter lines={[
          'Something is changing here.',
          'The builder is lazy, leaving nothing here.'
        ]} />
      </div>
    </div>
  )
}

function LoginRoute() {
  const { user } = useAuth()
  if (user) return <Navigate to="/chirp" replace />
  return <LoginPage />
}

/* ---------- 旧版 Chirp 页面（隐藏不删：仅通过旧链接可达） ---------- */

function LegacyChirp({ page }) {
  const { id } = useParams()
  const [language] = useState(readChirpLanguage)
  return <ChirpHomePage page={page} id={id || null} language={language} />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />

      {/* 新版 Chirp 外壳：左侧导航 + 内容区 */}
      <Route path="/chirp" element={<ChirpLayout />}>
        <Route index element={<Navigate to="advisor" replace />} />
        <Route path="advisor" element={<AdvisorPage />} />
        <Route path="room" element={<RoomPage />} />
        <Route path="diary" element={<DiaryPage />} />
        <Route path="me" element={<MePage />} />
      </Route>

      {/* 旧版 Chirp 路由（兼容内部链接，导航中不出现） */}
      <Route path="/chirp/legacy" element={<LegacyChirp page={null} />} />
      <Route path="/chirp/planet/:id" element={<LegacyChirp page="planet" />} />
      <Route path="/chirp/persona" element={<LegacyChirp page="persona" />} />
      <Route path="/chirp/persona-profile/:id" element={<LegacyChirp page="persona-profile" />} />
      <Route path="/chirp/persona-dm/:id" element={<LegacyChirp page="persona-dm" />} />
      <Route path="/chirp/persona-test/:id" element={<LegacyChirp page="persona-test" />} />
      <Route path="/chirp/dm/:id" element={<LegacyChirp page="dm" />} />
      <Route path="/chirp/about-me" element={<LegacyChirp page="about-me" />} />

      {/* SYL.AILABS 站点 */}
      <Route path="/" element={<SiteShell />}>
        <Route index element={<LandingPage />} />
        <Route path="brandkit" element={<BrandStudioPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function Typewriter({ lines }) {
  const fullText = useMemo(() => lines.join('\n'), [lines])
  const [charIndex, setCharIndex] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (charIndex < fullText.length) {
      const char = fullText[charIndex]
      const delay = char === '\n' ? 400 : char === '.' ? 200 : 50 + Math.random() * 40
      const timer = setTimeout(() => setCharIndex(i => i + 1), delay)
      return () => clearTimeout(timer)
    }

    setDone(true)
  }, [charIndex, fullText])

  const displayed = fullText.slice(0, charIndex)
  const displayedLines = displayed.split('\n')

  return (
    <div className="typewriter-container">
      {lines.map((line, i) => (
        <p key={line} className="landing-line">
          {displayedLines[i] || ''}
          {i === displayedLines.length - 1 && !done && (
            <span className="typewriter-cursor">|</span>
          )}
        </p>
      ))}
    </div>
  )
}

function useMenuDismiss(open, setOpen) {
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    const handlePointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, setOpen])

  return menuRef
}

function UserMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false)
  const menuRef = useMenuDismiss(open, setOpen)

  return (
    <div className="global-user-menu" ref={menuRef} onClick={() => setOpen(!open)}>
      <div className="global-user-dot"></div>
      <span>{user.displayName || user.email.split('@')[0]}</span>
      {open && (
        <div className="global-dropdown">
          {user.displayName && (
            <div className="global-dropdown-info">
              <span className="global-dropdown-name">{user.displayName}</span>
            </div>
          )}
          <div className="global-dropdown-info">
            <span className="global-dropdown-email">{user.email}</span>
          </div>
          <div className="global-dropdown-divider"></div>
          <button className="global-dropdown-item" onClick={onSignOut}>
            Sign Out
          </button>
        </div>
      )}
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </AuthProvider>
  )
}

export default App
