import type {
  AskQuestionResponse,
  AssistantApiResponse,
  ProductFilters,
  SearchProductsResponse,
} from '@/types/assistant'

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(err?.error ?? `Request failed (${res.status})`)
  }

  return res.json() as Promise<T>
}

export function startAssistant(
  query: string,
  options?: {
    userId?: string
    reuseFilters?: ProductFilters
    reuseHistoryId?: string
  },
) {
  return postJson<AssistantApiResponse>('/api/assistant/start', {
    query,
    userId: options?.userId,
    reuseFilters: options?.reuseFilters,
    reuseHistoryId: options?.reuseHistoryId,
  })
}

export function sendAssistantMessage(
  sessionId: string,
  answer: string,
  options?: { userId?: string },
) {
  return postJson<AssistantApiResponse>('/api/assistant/message', {
    sessionId,
    answer,
    userId: options?.userId,
  })
}

export function searchProducts(filters: ProductFilters) {
  return postJson<SearchProductsResponse>('/api/assistant/search', filters)
}

export function isAskResponse(
  response: AssistantApiResponse,
): response is AskQuestionResponse {
  return response.action === 'ask_question'
}
