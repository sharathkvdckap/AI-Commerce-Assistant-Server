import {
  softDeleteCustomerContext,
  getCustomerContext,
  upsertCustomerContext,
} from './repositories/customerContextRepository.js'
import {
  getMemoryBySession,
  softDeleteMemoryForUser,
  upsertConversationMemory,
} from './repositories/conversationMemoryRepository.js'
import {
  createConversationSession,
  getConversationSession,
  softDeleteSessionsForUser,
  updateConversationSession,
} from './repositories/conversationSessionRepository.js'
import {
  insertRecommendationLog,
  softDeleteRecommendationLogsForUser,
} from './repositories/recommendationLogRepository.js'
import {
  findSimilarSearchHistory,
  incrementSearchFrequency,
  insertSearchHistory,
  softDeleteSearchHistoryForUser,
} from './repositories/searchHistoryRepository.js'
import {
  getUserPreferences,
  softDeletePreferencesForUser,
  upsertUserPreferences,
} from './repositories/userPreferenceRepository.js'
import { conversationMemoryService } from './services/ConversationMemoryService.js'
import { contextRecommendationService } from './services/ContextRecommendationService.js'
import { semanticHistorySearchService } from './services/SemanticHistorySearchService.js'
import { userPreferenceService } from './services/UserPreferenceService.js'
import { pingContextDatabase, getContextPool, closeContextPool, pingSemanticDatabase, getDbPool } from './db.js'
import { embedText, toPgVectorLiteral } from './embeddings.js'

export type * from './types.js'

export {
  pingContextDatabase,
  pingSemanticDatabase,
  getContextPool,
  getDbPool,
  closeContextPool,
  embedText,
  toPgVectorLiteral,
  conversationMemoryService,
  contextRecommendationService,
  semanticHistorySearchService,
  userPreferenceService,
  createConversationSession,
  getConversationSession,
  updateConversationSession,
  softDeleteSessionsForUser,
  upsertConversationMemory,
  getMemoryBySession,
  softDeleteMemoryForUser,
  insertSearchHistory,
  findSimilarSearchHistory,
  incrementSearchFrequency,
  softDeleteSearchHistoryForUser,
  getUserPreferences,
  upsertUserPreferences,
  softDeletePreferencesForUser,
  getCustomerContext,
  upsertCustomerContext,
  softDeleteCustomerContext,
  insertRecommendationLog,
  softDeleteRecommendationLogsForUser,
}
