import { Bot, User } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { ChatMessage as ChatMessageType } from '@/types/assistant'

interface ChatMessageProps {
  message: ChatMessageType
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isAssistant = message.role === 'assistant'

  return (
    <div
      className={cn(
        'animate-fade-up flex gap-3',
        isAssistant ? 'justify-start' : 'justify-end',
      )}
    >
      {isAssistant && (
        <Avatar className="bg-accent-soft text-accent">
          <Bot className="size-4" />
        </Avatar>
      )}

      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[75%]',
          isAssistant
            ? 'rounded-tl-md bg-ai-bubble text-ink'
            : 'rounded-tr-md bg-user-bubble text-white',
        )}
      >
        {message.content}
      </div>

      {!isAssistant && (
        <Avatar className="bg-ink text-white">
          <User className="size-4" />
        </Avatar>
      )}
    </div>
  )
}
