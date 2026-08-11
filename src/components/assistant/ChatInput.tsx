import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ChatInputProps {
  disabled?: boolean
  placeholder?: string
  onSend: (text: string) => void
}

export function ChatInput({
  disabled = false,
  placeholder = 'Type your answer or refine your search…',
  onSend,
}: ChatInputProps) {
  const [value, setValue] = useState('')

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    setValue('')
    onSend(trimmed)
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const canSend = !disabled && value.trim().length > 0

  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        rows={1}
        placeholder={placeholder}
        className={cn(
          'min-h-11 max-h-28 flex-1 resize-none rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-sm text-ink shadow-sm outline-none transition',
          'placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent/20',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      />
      <Button
        type="button"
        disabled={!canSend}
        onClick={(event) => {
          event.preventDefault()
          submit()
        }}
        className="size-11 shrink-0 rounded-xl p-0"
        aria-label="Send message"
      >
        <Send className="size-4" aria-hidden />
      </Button>
    </form>
  )
}
