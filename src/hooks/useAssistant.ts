import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isAskResponse,
  sendAssistantMessage,
  startAssistant,
} from '@/api/assistant'
import { searchSimilarContext } from '@/api/context'
import { getOrCreateUserId } from '@/lib/userId'
import type {
  AssistantQuestion,
  ChatMessage,
  ProductFilters,
  ProductRecommendation,
} from '@/types/assistant'
import type { PendingContextReuse } from '@/types/context'

/** Don't block the first search if context memory / Postgres is slow. */
const CONTEXT_LOOKUP_TIMEOUT_MS = 2500

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch(() => {
        clearTimeout(timer)
        resolve(null)
      })
  })
}

function createMessage(
  role: ChatMessage['role'],
  content: string,
): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role,
    content,
    createdAt: Date.now(),
  }
}

function toQuestion(
  question: string,
  options: string[],
): AssistantQuestion {
  return {
    id: `q-${Date.now()}`,
    question,
    options: options.map((label) => ({
      label,
      value: label.toLowerCase().replace(/\s+/g, '_'),
    })),
  }
}

/** Build ask bubble text without repeating the question when message already includes it. */
function formatAskContent(message: string | undefined, question: string): string {
  const preface = message?.trim() ?? ''
  const q = question.trim()
  if (!q) return preface
  if (!preface || preface === q) return q
  if (preface.includes(q)) return preface
  return `${preface}\n\n${q}`
}

function lastAssistantContent(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant') return messages[i].content.trim()
  }
  return null
}

function readQueryParam(): string | null {
  const params = new URLSearchParams(window.location.search)
  const q = params.get('q')?.trim()
  return q || null
}

export function useAssistant() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activeQuestion, setActiveQuestion] =
    useState<AssistantQuestion | null>(null)
  const [products, setProducts] = useState<ProductRecommendation[]>([])
  const [alternatives, setAlternatives] = useState<ProductRecommendation[]>([])
  const [filters, setFilters] = useState<ProductFilters>({})
  const [source, setSource] = useState<'magento' | 'semantic' | 'hybrid' | null>(
    null,
  )
  const [matchType, setMatchType] = useState<
    'exact' | 'recommended' | 'mixed' | 'none' | null
  >(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [isThinking, setIsThinking] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingContext, setPendingContext] =
    useState<PendingContextReuse | null>(null)
  const [sessionKey, setSessionKey] = useState(0)
  const sessionIdRef = useRef<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [searchId, setSearchId] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const userIdRef = useRef<string>(getOrCreateUserId())

  const applyResponse = useCallback(
    (response: Awaited<ReturnType<typeof startAssistant>>) => {
      if (response.sessionId) {
        sessionIdRef.current = response.sessionId
        setSessionId(response.sessionId)
      }

      if (isAskResponse(response)) {
        setSearchId(null)
        setFilters(response.filters ?? {})
        const content = formatAskContent(response.message, response.question)
        setMessages((prev) => {
          const last = lastAssistantContent(prev)
          const question = response.question.trim()
          if (last && (last === content || last.includes(question))) {
            return prev
          }
          return [...prev, createMessage('assistant', content)]
        })
        setActiveQuestion(toQuestion(response.question, response.options))
        setProducts([])
        setAlternatives([])
        setSource(null)
        setMatchType(null)
        setWarning(null)
        setIsComplete(false)
        return
      }

      setSearchId(response.searchId ?? null)
      setFilters(response.filters ?? {})
      const isEmpty =
        response.matchType === 'none' ||
        ((response.products?.length ?? 0) === 0 &&
          (response.alternatives?.length ?? 0) === 0)

      const defaultSearchMessage = isEmpty
        ? 'No products found for your requirements.'
        : 'Based on your preferences, here are products from the Magento catalog.'

      setMessages((prev) => {
        let text = (response.message ?? defaultSearchMessage).trim()
        const last = lastAssistantContent(prev)
        if (last && text !== last) {
          if (text.startsWith(last)) {
            text = text.slice(last.length).trim()
          } else if (text.includes(last)) {
            text = text.replace(last, '').replace(/\n{2,}/g, '\n\n').trim()
          }
        }
        if (isEmpty) {
          text = 'No products found for your requirements.'
        } else if (!text || (last && text === last)) {
          text =
            'Thanks — searching the Magento catalog with your requirements.'
        }
        if (last && text === last) return prev
        return [...prev, createMessage('assistant', text)]
      })
      setActiveQuestion(null)
      setProducts(isEmpty ? [] : (response.products ?? []))
      setAlternatives(isEmpty ? [] : (response.alternatives ?? []))
      setSource(isEmpty ? null : (response.source ?? null))
      setMatchType(isEmpty ? 'none' : (response.matchType ?? null))
      setWarning(
        isEmpty
          ? response.warning ??
              'No matching products in Magento or semantic search. Try different keywords or start over.'
          : (response.warning ?? null),
      )
      setIsComplete(true)
    },
    [],
  )

  const runAssistantStart = useCallback(
    async (
      query: string,
      options?: {
        reuseFilters?: ProductFilters
        reuseHistoryId?: string
      },
    ) => {
      setIsThinking(true)
      setError(null)
      setPendingContext(null)
      try {
        const response = await startAssistant(query, {
          userId: userIdRef.current,
          reuseFilters: options?.reuseFilters,
          reuseHistoryId: options?.reuseHistoryId,
        })
        applyResponse(response)
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Could not reach the assistant API. Is the backend running?',
        )
      } finally {
        setIsThinking(false)
      }
    },
    [applyResponse],
  )

  const beginWithQuery = useCallback(
    async (query: string) => {
      const trimmed = query.trim()
      if (!trimmed) return
      if (submittingRef.current) return
      submittingRef.current = true

      sessionIdRef.current = null
      setHasStarted(true)
      setMessages([createMessage('user', trimmed)])
      setActiveQuestion(null)
      setProducts([])
      setAlternatives([])
      setFilters({})
      setSource(null)
      setMatchType(null)
      setWarning(null)
      setIsComplete(false)
      setError(null)
      setPendingContext(null)
      setSessionId(null)
      setSearchId(null)
      setIsThinking(true)

      try {
        // Check for similar prior context before clarifying questions.
        // Timed out so a slow/hung Postgres never blocks Send.
        const context = await withTimeout(
          searchSimilarContext(userIdRef.current, trimmed),
          CONTEXT_LOOKUP_TIMEOUT_MS,
        )

        if (context?.shouldReuse && context.match) {
          const message =
            context.message ??
            `Welcome back! Last time you were looking for "${context.match.originalQuery}". Would you like to continue with those preferences or start a new search?`
          setMessages((prev) => [...prev, createMessage('assistant', message)])
          setPendingContext({
            query: trimmed,
            match: context.match,
            message,
            preferences: context.preferences,
            similarity: context.similarity ?? context.match.similarity,
          })
          return
        }

        await runAssistantStart(trimmed)
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Could not reach the assistant API. Is the backend running?',
        )
      } finally {
        submittingRef.current = false
        setIsThinking(false)
      }
    },
    [runAssistantStart],
  )

  const continuePreviousContext = useCallback(async () => {
    if (!pendingContext || isThinking) return
    const { query, match } = pendingContext
    setMessages((prev) => [
      ...prev,
      createMessage('user', 'Continue Previous Search'),
    ])
    await runAssistantStart(query, {
      reuseFilters: {
        ...match.filters,
        query,
      },
      reuseHistoryId: match.historyId,
    })
  }, [isThinking, pendingContext, runAssistantStart])

  const startNewSearchFromContext = useCallback(async () => {
    if (!pendingContext || isThinking) return
    const { query } = pendingContext
    setMessages((prev) => [
      ...prev,
      createMessage('user', 'Start New Search'),
    ])
    await runAssistantStart(query)
  }, [isThinking, pendingContext, runAssistantStart])

  const beginWithQueryRef = useRef(beginWithQuery)
  beginWithQueryRef.current = beginWithQuery

  useEffect(() => {
    sessionIdRef.current = null
    submittingRef.current = false
    userIdRef.current = getOrCreateUserId()
    setMessages([])
    setActiveQuestion(null)
    setProducts([])
    setAlternatives([])
    setFilters({})
    setSource(null)
    setMatchType(null)
    setWarning(null)
    setIsComplete(false)
    setError(null)
    setIsThinking(false)
    setHasStarted(false)
    setPendingContext(null)
    setSessionId(null)
    setSearchId(null)

    const fromUrl = readQueryParam()
    if (fromUrl) {
      void beginWithQueryRef.current(fromUrl)
    }
    // Only re-bootstrap on Start over (sessionKey). Do not depend on beginWithQuery
    // or a changing callback will wipe an in-flight search.
  }, [sessionKey])

  const submitAnswer = useCallback(
    async (answer: string) => {
      const trimmed = answer.trim()
      if (!trimmed || submittingRef.current) return

      if (pendingContext) return

      if (!sessionIdRef.current) {
        await beginWithQuery(trimmed)
        return
      }

      submittingRef.current = true
      setMessages((prev) => [...prev, createMessage('user', trimmed)])
      setActiveQuestion(null)
      setError(null)
      setIsThinking(true)

      try {
        const response = await sendAssistantMessage(
          sessionIdRef.current,
          trimmed,
          { userId: userIdRef.current },
        )
        applyResponse(response)
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to send your answer',
        )
      } finally {
        submittingRef.current = false
        setIsThinking(false)
      }
    },
    [applyResponse, beginWithQuery, pendingContext],
  )

  const answerQuestion = useCallback(
    (label: string, _value: string) => {
      void submitAnswer(label)
    },
    [submitAnswer],
  )

  const reset = useCallback(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has('q')) {
      url.searchParams.delete('q')
      window.history.replaceState({}, '', url.pathname)
    }
    setSessionKey((k) => k + 1)
  }, [])

  return {
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
  }
}
