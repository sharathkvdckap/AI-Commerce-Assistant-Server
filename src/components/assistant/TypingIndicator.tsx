export function TypingIndicator() {
  return (
    <div className="animate-fade-up flex items-center gap-3">
      <div className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-accent">
        <span className="sr-only">AI is thinking</span>
        <span className="flex gap-1">
          <span className="typing-dot size-1.5 rounded-full bg-accent" />
          <span className="typing-dot size-1.5 rounded-full bg-accent" />
          <span className="typing-dot size-1.5 rounded-full bg-accent" />
        </span>
      </div>
      <div className="rounded-2xl rounded-tl-md bg-ai-bubble px-4 py-3">
        <p className="text-sm text-ink-muted">Finding the right question…</p>
      </div>
    </div>
  )
}
