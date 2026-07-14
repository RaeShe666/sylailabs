import { NotebookPen, BookHeart, Plus } from 'lucide-react'

// Journal 骨架占位（切片3接数据）：我的日记 / 我们的故事 / 新建日记
export default function JournalPage({ language }) {
  const isChinese = language === 'zh'

  const books = [
    {
      key: 'mine',
      icon: NotebookPen,
      title: isChinese ? '我的日记' : 'My journal',
      hint: isChinese ? '只有你自己看得到。' : 'Only you can see this.'
    },
    {
      key: 'ours',
      icon: BookHeart,
      title: isChinese ? '我们的故事' : 'Our story',
      hint: isChinese ? '你们共同写下的一本。' : 'The one you write together.'
    }
  ]

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto px-6 pb-10 pt-16">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">Journal</h1>
      {books.map(({ key, icon: Icon, title, hint }) => (
        <div key={key} className="flex items-center gap-4 rounded-2xl border border-[var(--border-light)] bg-white p-5">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--gray-100)]">
            <Icon size={20} className="text-[var(--text-secondary)]" />
          </div>
          <div className="min-w-0">
            <div className="font-medium text-[var(--text-primary)]">{title}</div>
            <div className="text-sm text-[var(--text-secondary)]">{hint}</div>
          </div>
          <span className="ml-auto shrink-0 rounded-full bg-[var(--gray-100)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
            {isChinese ? '打磨中' : 'Coming soon'}
          </span>
        </div>
      ))}
      <button
        type="button"
        disabled
        className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--border-medium)] bg-transparent p-4 text-sm text-[var(--text-muted)]"
      >
        <Plus size={16} />
        {isChinese ? '新建日记（即将开放）' : 'New journal (coming soon)'}
      </button>
    </div>
  )
}
