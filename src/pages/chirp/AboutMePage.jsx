import { useState } from 'react'
import { PencilLine } from 'lucide-react'
import { OnboardingAnimalAvatar } from '@/pages/ChirpHomePage'

// About me 占位：先只展示 onboarding 信息（重要日子/邀请等后续在这里长出来）
export default function AboutMePage({ profile, language, onEditProfile }) {
  const isChinese = language === 'zh'
  const [expanded, setExpanded] = useState(false)

  if (!profile) return null

  const rows = [
    { label: isChinese ? '你的动物型' : 'Your animal', value: profile.animal || '—' },
    { label: isChinese ? '小鸟的名字' : "Bird's name", value: profile.birdName || 'Bird' }
  ]

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto px-6 pb-10 pt-16">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">About me</h1>

      <div className="flex items-center gap-4 rounded-2xl border border-[var(--border-light)] bg-white p-5">
        <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--gray-100)]">
          <OnboardingAnimalAvatar animal={profile.animal} />
        </span>
        <div className="min-w-0 flex-1">
          {rows.map(({ label, value }) => (
            <div key={label} className="flex items-baseline gap-2 text-sm">
              <span className="shrink-0 text-[var(--text-muted)]">{label}</span>
              <span className="truncate text-[var(--text-primary)]">{value}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onEditProfile}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border-light)] bg-white px-3 py-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--gray-50)]"
        >
          <PencilLine size={14} />
          {isChinese ? '重新测' : 'Retake'}
        </button>
      </div>

      {profile.answers && (
        <div className="rounded-2xl border border-[var(--border-light)] bg-white p-5">
          <button
            type="button"
            onClick={() => setExpanded(value => !value)}
            className="cursor-pointer border-0 bg-transparent p-0 text-sm font-medium text-[var(--text-primary)]"
          >
            {isChinese ? 'Onboarding 回答' : 'Onboarding answers'} {expanded ? '▾' : '▸'}
          </button>
          {expanded && (
            <div className="mt-3 flex flex-col gap-1 text-sm text-[var(--text-secondary)]">
              {Object.entries(profile.answers).map(([question, answer]) => (
                <div key={question}>{question}: {String(answer)}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)]">
        {isChinese ? '重要的日子、邀请另一半，之后都会放在这里。' : 'Important dates and inviting your partner will live here soon.'}
      </p>
    </div>
  )
}
