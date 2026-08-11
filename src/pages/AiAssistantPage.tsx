import { AssistantHeader } from '@/components/assistant/AssistantHeader'
import { ChatWindow } from '@/components/assistant/ChatWindow'
import { useAssistant } from '@/hooks/useAssistant'

export function AiAssistantPage() {
  const {
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
    sessionId,
    searchId,
    answerQuestion,
    submitAnswer,
    continuePreviousContext,
    startNewSearchFromContext,
    reset,
  } = useAssistant()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AssistantHeader />
      <main className="min-h-0 flex-1">
        <ChatWindow
          messages={messages}
          activeQuestion={activeQuestion}
          products={products}
          alternatives={alternatives}
          filters={filters}
          source={source}
          matchType={matchType}
          warning={warning}
          isThinking={isThinking}
          isComplete={isComplete}
          hasStarted={hasStarted}
          error={error}
          pendingContext={pendingContext}
          sessionId={sessionId}
          searchId={searchId}
          onAnswer={answerQuestion}
          onSend={submitAnswer}
          onContinueContext={() => {
            void continuePreviousContext()
          }}
          onStartNewFromContext={() => {
            void startNewSearchFromContext()
          }}
          onReset={reset}
        />
      </main>
    </div>
  )
}
