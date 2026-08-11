import { useEffect, useRef } from 'react'
import { ChatInput } from '@/components/assistant/ChatInput'
import { ChatMessage } from '@/components/assistant/ChatMessage'
import { ContextReuseCard } from '@/components/assistant/ContextReuseCard'
import { ProductGrid } from '@/components/assistant/ProductGrid'
import { QuestionCard } from '@/components/assistant/QuestionCard'
import { TypingIndicator } from '@/components/assistant/TypingIndicator'
import { Button } from '@/components/ui/button'
import type {
  AssistantQuestion,
  ChatMessage as ChatMessageType,
  ProductFilters,
  ProductRecommendation,
} from '@/types/assistant'
import type { PendingContextReuse } from '@/types/context'

interface ChatWindowProps {
  messages: ChatMessageType[]
  activeQuestion: AssistantQuestion | null
  products: ProductRecommendation[]
  alternatives: ProductRecommendation[]
  filters: ProductFilters
  source: 'magento' | 'semantic' | 'hybrid' | null
  matchType: 'exact' | 'recommended' | 'mixed' | 'none' | null
  warning: string | null
  isThinking: boolean
  isComplete: boolean
  hasStarted: boolean
  error: string | null
  pendingContext: PendingContextReuse | null
  onAnswer: (label: string, value: string) => void
  onSend: (text: string) => void
  onContinueContext: () => void
  onStartNewFromContext: () => void
  onReset: () => void
  sessionId?: string | null
  searchId?: string | null
}

export function ChatWindow({
  messages,
  activeQuestion,
  products,
  alternatives,
  filters,
  source,
  matchType,
  warning,
  isThinking,
  isComplete,
  hasStarted,
  error,
  pendingContext,
  onAnswer,
  onSend,
  onContinueContext,
  onStartNewFromContext,
  onReset,
  sessionId,
  searchId,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const hasResults = products.length > 0 || alternatives.length > 0

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [
    messages,
    activeQuestion,
    products,
    alternatives,
    isThinking,
    error,
    pendingContext,
  ])

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col px-4 py-5 sm:px-6">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4">
        {!hasStarted && !isThinking && (
          <div className="animate-fade-up flex h-full min-h-[280px] flex-col items-center justify-center px-4 text-center">
            <p className="font-display text-3xl text-ink sm:text-4xl">
              What are you looking for?
            </p>
            <p className="mt-3 max-w-md text-sm text-ink-muted">
              Describe your need in plain language — gifts, clothing, industrial
              parts, and more. The assistant asks relevant follow-ups based on
              your query.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {[
                "I'm looking for a gift for my husband.",
                'I need something comfortable for the gym',
                'My motor shaft is making a grinding noise. I need the right replacement component.',
              ].map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isThinking}
                  onClick={() => onSend(suggestion)}
                >
                  {suggestion.length > 42
                    ? `${suggestion.slice(0, 42)}…`
                    : suggestion}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}

        {isThinking && <TypingIndicator />}

        {pendingContext && !isThinking && (
          <ContextReuseCard
            pending={pendingContext}
            disabled={isThinking}
            onContinue={onContinueContext}
            onStartNew={onStartNewFromContext}
          />
        )}

        {activeQuestion && !isThinking && !pendingContext && (
          <QuestionCard
            question={activeQuestion}
            onSelect={onAnswer}
            disabled={isThinking}
          />
        )}

        {hasResults && (
          <>
            <ProductGrid
              products={products}
              alternatives={alternatives}
              source={source}
              matchType={matchType}
              sessionId={sessionId}
              searchId={searchId}
            />
            {warning && (
              <div className="ml-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:ml-11">
                {warning}
              </div>
            )}
            <div className="ml-0 rounded-xl border border-dashed border-border bg-surface-elevated/60 p-4 text-xs text-ink-muted sm:ml-11">
              <p className="font-medium text-ink">Structured search criteria</p>
              <pre className="mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed">
                {JSON.stringify(filters, null, 2)}
              </pre>
            </div>
          </>
        )}

        {isComplete && !hasResults && !isThinking && (
          <div className="animate-fade-up ml-0 rounded-xl border border-border bg-surface-elevated px-5 py-10 text-center sm:ml-11">
            <p className="font-display text-2xl text-ink">No products found</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
              {warning ??
                'No matching products in Magento or semantic search. Try different keywords or start over.'}
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-5"
              onClick={onReset}
            >
              Start over
            </Button>
          </div>
        )}

        {error && (
          <div className="ml-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:ml-11">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 space-y-3 border-t border-border/80 bg-surface/80 pt-4 backdrop-blur-sm">
        {!isComplete && !pendingContext && (
          <ChatInput
            disabled={isThinking}
            onSend={onSend}
            placeholder={
              !hasStarted
                ? 'e.g. black Nike hoodie under $60'
                : activeQuestion
                  ? 'Or type your own answer…'
                  : 'Describe what you are looking for…'
            }
          />
        )}

        {isComplete ? (
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <p className="text-sm text-ink-muted">
              Search complete
              {source === 'hybrid'
                ? ' · Magento + semantic'
                : source === 'semantic'
                  ? ' · semantic (pgvector)'
                  : source === 'magento'
                    ? ' · results from Magento'
                    : ''}
              . Start over to try another query.
            </p>
            <Button variant="outline" onClick={onReset}>
              Start over
            </Button>
          </div>
        ) : (
          <p className="text-center text-xs text-ink-faint">
            Powered by Ollama · questions are generated dynamically from your
            input
          </p>
        )}
      </div>
    </div>
  )
}
