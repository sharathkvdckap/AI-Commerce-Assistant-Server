export type SessionStatus =
  | 'collecting'
  | 'ready_to_search'
  | 'completed'
  | 'abandoned'

export type JsonObject = Record<string, unknown>
export type JsonArray = unknown[]

export interface ConversationSessionRow {
  id: string
  user_id: string
  status: SessionStatus
  original_query: string | null
  domain: string | null
  filters: JsonObject
  started_at: Date
  completed_at: Date | null
  created_at: Date
  updated_at: Date
  created_by: string | null
  updated_by: string | null
  is_deleted: boolean
}

export interface ConversationMemoryRow {
  id: string
  user_id: string
  session_id: string
  questions_asked: JsonArray
  customer_answers: JsonArray
  ai_recommendations: JsonArray
  conversation_summary: string | null
  message_log: JsonArray
  created_at: Date
  updated_at: Date
}

export interface UserSearchHistoryRow {
  id: string
  user_id: string
  session_id: string | null
  original_query: string
  intent: string | null
  category: string | null
  subcategory: string | null
  filters: JsonObject
  search_frequency: number
  last_searched_at: Date
  created_at: Date
  updated_at: Date
  similarity?: number
}

export interface UserPreferencesRow {
  id: string
  user_id: string
  preferred_brands: string[]
  budget: JsonObject
  sizes: string[]
  colours: string[]
  categories: string[]
  material: string[]
  gender: string | null
  shopping_style: string | null
  favourite_products: JsonArray
  frequently_purchased_cats: string[]
  extra: JsonObject
  created_at: Date
  updated_at: Date
}

export interface CustomerContextRow {
  id: string
  user_id: string
  latest_session_id: string | null
  latest_query: string | null
  latest_summary: string | null
  latest_filters: JsonObject
  preference_snapshot: JsonObject
  last_activity_at: Date
  created_at: Date
  updated_at: Date
}

export interface SimilarHistoryMatch {
  historyId: string
  sessionId: string | null
  originalQuery: string
  intent: string | null
  category: string | null
  subcategory: string | null
  filters: JsonObject
  similarity: number
  searchFrequency: number
  lastSearchedAt: string
  summary: string | null
}

export interface ContextRecommendation {
  shouldReuse: boolean
  similarity: number | null
  threshold: number
  match: SimilarHistoryMatch | null
  message: string | null
  preferences: Partial<UserPreferencesRow> | null
}

export interface SaveContextInput {
  userId: string
  sessionId: string
  originalQuery: string
  intent?: string
  category?: string
  subcategory?: string
  domain?: string
  filters: JsonObject
  messages: Array<{ role: string; content: string }>
  questionsAsked?: JsonArray
  customerAnswers?: JsonArray
  products?: JsonArray
  alternatives?: JsonArray
  source?: string
  matchType?: string
  summary?: string
  actor?: string
}
