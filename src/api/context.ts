import type { ContextSearchResponse } from '@/types/context'

async function requestJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(err?.error ?? `Request failed (${res.status})`)
  }

  return res.json() as Promise<T>
}

export function searchSimilarContext(userId: string, query: string) {
  return requestJson<ContextSearchResponse>('/api/context/search', {
    method: 'POST',
    body: JSON.stringify({ userId, query }),
  })
}

export function continueContext(userId: string, historyId: string) {
  return requestJson<{ ok: boolean }>('/api/context/continue', {
    method: 'POST',
    body: JSON.stringify({ userId, historyId }),
  })
}

export function clearContext(userId: string) {
  return requestJson<{ ok: boolean }>('/api/context/clear', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
}
