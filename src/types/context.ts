import type { ProductFilters } from '@/types/assistant'

export interface SimilarHistoryMatch {
  historyId: string
  sessionId: string | null
  originalQuery: string
  intent: string | null
  category: string | null
  subcategory: string | null
  filters: ProductFilters
  similarity: number
  searchFrequency: number
  lastSearchedAt: string
  summary: string | null
}

export interface ContextPreferences {
  preferred_brands?: string[]
  budget?: Record<string, unknown>
  sizes?: string[]
  colours?: string[]
  categories?: string[]
  material?: string[]
  gender?: string | null
  shopping_style?: string | null
}

export interface ContextSearchResponse {
  ok: boolean
  elapsedMs?: number
  shouldReuse: boolean
  similarity: number | null
  threshold: number
  match: SimilarHistoryMatch | null
  message: string | null
  preferences: ContextPreferences | null
}

export interface PendingContextReuse {
  query: string
  match: SimilarHistoryMatch
  message: string
  preferences: ContextPreferences | null
  similarity: number
}
