import { Sparkles } from 'lucide-react'

export function AssistantHeader() {
  return (
    <header className="border-b border-border/80 bg-surface-elevated/80 px-4 py-4 backdrop-blur-md sm:px-6">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-accent text-white shadow-sm">
          <Sparkles className="size-5" strokeWidth={1.75} />
        </div>
        <div>
          <p className="font-display text-2xl leading-none tracking-tight text-ink">
            AI Commerce Assistant
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Conversational product discovery · Magento catalog
          </p>
        </div>
      </div>
    </header>
  )
}
