export type MessageRole = 'assistant' | 'user'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: number
}

export interface QuestionOption {
  label: string
  value: string
}

export interface AssistantQuestion {
  id: string
  question: string
  options: QuestionOption[]
}

export interface ProductRecommendation {
  id: string
  sku: string
  name: string
  price: number
  currency: string
  imageUrl: string
  productUrl: string
  reasons: string[]
  inStock: boolean
}

export type ProductFilters = Record<string, string | number | boolean>

export type AssistantAction = 'ask_question' | 'search_products'

export interface AskQuestionResponse {
  sessionId: string
  action: 'ask_question'
  message: string
  question: string
  options: string[]
  filters: ProductFilters
}

export interface SearchProductsResponse {
  sessionId?: string
  searchId?: string | null
  action: 'search_products'
  message?: string
  filters: ProductFilters
  products: ProductRecommendation[]
  alternatives?: ProductRecommendation[]
  source?: 'magento' | 'semantic' | 'hybrid'
  totalCount?: number
  matchType?: 'exact' | 'recommended' | 'mixed' | 'none'
  warning?: string
}

export type AssistantApiResponse = AskQuestionResponse | SearchProductsResponse
