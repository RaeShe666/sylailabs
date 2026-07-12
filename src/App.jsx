import { useEffect, useMemo, useRef, useState } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import BrandStudioPage from './pages/BrandStudioPage'
import LoginPage from './pages/LoginPage'
import ChirpHomePage, { OnboardingAnimalAvatar, readOnboardingProfile } from './pages/ChirpHomePage'
import './App.css'

const parseRoute = () => {
  const hash = window.location.hash.slice(1) || '/'
  const parts = hash.split('/').filter(Boolean)
  // Routes: / (landing), brandkit (Brand Studio download), chirp, chirp/planet/:id, login
  return {
    section: parts[0] || 'landing',
    page: parts[1] || null,
    id: parts[2] || null
  }
}

const navigateTo = (...segments) => {
  window.location.hash = '/' + segments.filter(Boolean).join('/')
}

const CHIRP_LANGUAGE_KEY = 'chirpUiLanguage'

const readChirpLanguage = () => {
  if (typeof window === 'undefined') return 'en'
  return window.localStorage.getItem(CHIRP_LANGUAGE_KEY) === 'zh' ? 'zh' : 'en'
}

function AppContent() {
  const { user, signOut } = useAuth()
  const route = parseRoute()
  const [currentSection, setCurrentSection] = useState(route.section)
  const [currentPage, setCurrentPage] = useState(route.page)
  const [currentId, setCurrentId] = useState(route.id)
  const [chirpProfile, setChirpProfile] = useState(() => readOnboardingProfile())
  const [chirpLanguage, setChirpLanguage] = useState(() => readChirpLanguage())

  useEffect(() => {
    const handleHashChange = () => {
      const nextRoute = parseRoute()
      setCurrentSection(nextRoute.section)
      setCurrentPage(nextRoute.page)
      setCurrentId(nextRoute.id)
    }

    if (!window.location.hash) {
      window.location.hash = '/'
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    const refreshChirpProfile = () => {
      setChirpProfile(readOnboardingProfile())
    }
    window.addEventListener('chirp:onboarding-updated', refreshChirpProfile)
    window.addEventListener('storage', refreshChirpProfile)
    return () => {
      window.removeEventListener('chirp:onboarding-updated', refreshChirpProfile)
      window.removeEventListener('storage', refreshChirpProfile)
    }
  }, [])

  const handleSignOut = async () => {
    await signOut()
    navigateTo()
  }

  const changeChirpLanguage = (language) => {
    window.localStorage.setItem(CHIRP_LANGUAGE_KEY, language)
    setChirpLanguage(language)
  }

  const handleGlobalLogoClick = () => {
    navigateTo()
  }

  const handleGlobalBrandTextClick = () => {
    if (currentSection === 'chirp') {
      navigateTo(currentSection)
      return
    }

    navigateTo()
  }

  const chirpNavItems = [
    { label: 'home', page: null, action: () => navigateTo('chirp') },
    { label: 'planet', page: 'planet', action: () => navigateTo('chirp', 'planet', 'love') },
    { label: 'persona', page: 'persona', action: () => navigateTo('chirp', 'persona') },
    { label: 'about me', page: 'about-me', action: () => navigateTo('chirp', 'about-me') }
  ]

  const isChirpSection = currentSection === 'chirp'

  if (currentSection === 'login' && !user) {
    return <LoginPage />
  }

  if (currentSection === 'login' && user) {
    navigateTo('chirp')
  }

  const renderContent = () => {
    if (currentSection === 'brandkit') {
      return <BrandStudioPage />
    }

    if (isChirpSection) {
      return <ChirpHomePage page={currentPage} id={currentId} language={chirpLanguage} />
    }

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

  return (
    <div className="app">
      <nav className={`global-nav ${isChirpSection ? 'chirp-nav' : ''}`}>
        <div className="global-nav-brand">
          <img
            src="/logo-home-transparent.png"
            alt="Logo"
            className="global-nav-logo"
            onClick={handleGlobalLogoClick}
          />
          <button className="global-nav-brand-text" type="button" onClick={handleGlobalBrandTextClick}>
            {isChirpSection ? currentSection : 'SYL.AILABS'}
          </button>
        </div>

        {isChirpSection ? (
          <div className="global-nav-center">
            {chirpNavItems.map(item => (
              <button
                className={`global-nav-home-link ${currentPage === item.page ? 'active' : ''}`}
                type="button"
                key={item.label}
                onClick={item.action}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="global-nav-links">
            <a
              className={`global-nav-link ${currentSection === 'brandkit' ? 'active' : ''}`}
              onClick={() => navigateTo('brandkit')}
            >
              Brand Studio
            </a>
            <a
              className={`global-nav-link ${currentSection === 'chirp' ? 'active' : ''}`}
              onClick={() => navigateTo('chirp')}
            >
              Chirp
            </a>
          </div>
        )}

        <div className="global-nav-right">
          {isChirpSection && user && chirpProfile ? (
            <ChirpUserMenu animal={chirpProfile.animal} language={chirpLanguage} onLanguageChange={changeChirpLanguage} onSignOut={handleSignOut} />
          ) : user ? (
            <UserMenu user={user} language={isChirpSection ? chirpLanguage : null} onLanguageChange={isChirpSection ? changeChirpLanguage : null} onSignOut={handleSignOut} />
          ) : (
            <a className="global-nav-auth" onClick={() => navigateTo('login')}>
              [ Sign In ]
            </a>
          )}
        </div>
      </nav>

      <div className="app-body">
        {renderContent()}
      </div>
    </div>
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

function LanguageSwitch({ language, onLanguageChange }) {
  if (!onLanguageChange) return null

  return (
    <div className="global-language-switch" role="group" aria-label={language === 'zh' ? '界面语言' : 'Interface language'}>
      <button className={language === 'zh' ? 'active' : ''} type="button" onClick={() => onLanguageChange('zh')}>中文</button>
      <button className={language === 'en' ? 'active' : ''} type="button" onClick={() => onLanguageChange('en')}>English</button>
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

function UserMenu({ user, language, onLanguageChange, onSignOut }) {
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
          <LanguageSwitch language={language} onLanguageChange={onLanguageChange} />
          <div className="global-dropdown-divider"></div>
          <button className="global-dropdown-item" onClick={onSignOut}>
            {language === 'zh' ? '退出登录' : 'Sign Out'}
          </button>
        </div>
      )}
    </div>
  )
}

function ChirpUserMenu({ animal, language, onLanguageChange, onSignOut }) {
  const [open, setOpen] = useState(false)
  const menuRef = useMenuDismiss(open, setOpen)

  const choose = (action) => {
    setOpen(false)
    action()
  }

  return (
    <div className="global-profile-menu" ref={menuRef}>
      <button className="global-nav-animal-button" type="button" onClick={() => setOpen(previous => !previous)} aria-label="Account menu" aria-expanded={open}>
        <OnboardingAnimalAvatar animal={animal} />
      </button>
      {open && (
        <div className="global-dropdown global-chirp-dropdown">
          <LanguageSwitch language={language} onLanguageChange={onLanguageChange} />
          <div className="global-dropdown-divider"></div>
          <button className="global-dropdown-item" type="button" onClick={() => choose(onSignOut)}>
            {language === 'zh' ? '退出登录' : 'Sign Out'}
          </button>
        </div>
      )}
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
