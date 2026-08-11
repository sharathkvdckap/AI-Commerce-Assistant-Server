import { Link } from 'react-router-dom'
import { BarChart3, Sparkles } from 'lucide-react'

export function AssistantHeader() {
  return (
    <header className="border-b border-border/80 bg-surface-elevated/80 px-4 py-4 backdrop-blur-md sm:px-6">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/ai-assistant"
            className="flex size-10 items-center justify-center rounded-xl bg-accent text-white shadow-sm"
          >
            <Sparkles className="size-5" strokeWidth={1.75} />
          </Link>
          <div>
            <p className="font-display text-2xl leading-none tracking-tight text-ink">
              AI Commerce Assistant
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Conversational product discovery · Magento catalog
            </p>
          </div>
        </div>
        <Link
          to="/analytics"
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-accent-soft hover:text-accent"
        >
          <BarChart3 className="size-4" />
          Analytics
        </Link>
      </div>
    </header>
  )
}
