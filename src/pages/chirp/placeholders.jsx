import { useOutletContext } from 'react-router-dom'
import { Sparkles, Sofa, NotebookPen, CircleUserRound } from 'lucide-react'

function Space({ icon: Icon, title, line }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-[#F1EDE1]">
        <Icon size={24} className="text-neutral-400" />
      </div>
      <h1 className="text-lg font-semibold text-neutral-800">{title}</h1>
      <p className="max-w-xs text-sm leading-relaxed text-neutral-500">{line}</p>
    </div>
  )
}

export function AdvisorPage() {
  const { language } = useOutletContext()
  return (
    <Space
      icon={Sparkles}
      title={language === 'zh' ? '军师' : 'Advisor'}
      line={
        language === 'zh'
          ? '只属于你的军师会住在这里——正在搬进来，很快见面。'
          : 'Your own advisor will live here. Moving in now — see you soon.'
      }
    />
  )
}

export function RoomPage() {
  const { language } = useOutletContext()
  return (
    <Space
      icon={Sofa}
      title={language === 'zh' ? '客厅' : 'Living room'}
      line={
        language === 'zh'
          ? '你们的客厅。等 TA 拿着钥匙进来，想认真说的话就在这里说。'
          : 'Your shared room. Once your partner joins with the key, this is where the real talks happen.'
      }
    />
  )
}

export function DiaryPage() {
  const { language } = useOutletContext()
  return (
    <Space
      icon={NotebookPen}
      title={language === 'zh' ? '日记本' : 'Journal'}
      line={
        language === 'zh'
          ? '我的日记，和你们的故事，以后都记在这里。'
          : 'Your private journal and the story you two share will be kept here.'
      }
    />
  )
}

export function MePage() {
  const { language } = useOutletContext()
  return (
    <Space
      icon={CircleUserRound}
      title={language === 'zh' ? '我' : 'Me'}
      line={
        language === 'zh'
          ? '你的信息、重要的日子和邀请钥匙，以后都放在这里。'
          : 'Your info, the dates that matter, and the invite key will all live here.'
      }
    />
  )
}
