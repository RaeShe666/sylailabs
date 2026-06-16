import './ChirpPage.css'
import { PersonaAvatar } from './chirpShared'

// Full-screen persona profile, reached by clicking a persona's avatar in chat.
// MVP: avatar + name + one-line intro + a "Message" button that opens the DM.
function PersonaProfilePage({ persona, onBack, onMessage, language = 'en' }) {
  const isChinese = language === 'zh'
  if (!persona) return null

  return (
    <div className="persona-profile-page" style={{ '--chirp-paper': persona.background || '#FAFAF7' }}>
      <header className="persona-profile-topbar">
        <button className="chirp-back" type="button" aria-label={isChinese ? '返回' : 'Back'} onClick={onBack}>
          <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
        </button>
      </header>
      <main className="persona-profile-main">
        <div className="persona-profile-avatar" style={{ backgroundColor: persona.color }}>
          <PersonaAvatar persona={persona} />
        </div>
        <h1 className="persona-profile-name">{persona.name}</h1>
        {persona.role && <p className="persona-profile-intro">{persona.role}</p>}
        <button className="persona-profile-message-btn" type="button" onClick={() => onMessage?.(persona.id)}>
          {isChinese ? '发消息' : 'Message'}
        </button>
      </main>
    </div>
  )
}

export default PersonaProfilePage
