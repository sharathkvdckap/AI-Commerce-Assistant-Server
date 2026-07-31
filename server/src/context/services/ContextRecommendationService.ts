import { config, isContextMemoryConfigured } from '../../config/env.js'
import { softDeleteCustomerContext } from '../repositories/customerContextRepository.js'
import { getCustomerContext } from '../repositories/customerContextRepository.js'
import { softDeleteMemoryForUser } from '../repositories/conversationMemoryRepository.js'
import { softDeleteSessionsForUser } from '../repositories/conversationSessionRepository.js'
import { softDeleteRecommendationLogsForUser } from '../repositories/recommendationLogRepository.js'
import { softDeleteSearchHistoryForUser } from '../repositories/searchHistoryRepository.js'
import { conversationMemoryService } from './ConversationMemoryService.js'
import { semanticHistorySearchService } from './SemanticHistorySearchService.js'
import { userPreferenceService } from './UserPreferenceService.js'
import type { ContextRecommendation, SaveContextInput } from '../types.js'

function buildReuseMessage(query: string, previousQuery: string): string {
  return (
    `Welcome back! Last time you were looking for "${previousQuery}". ` +
    `I found a similar shopping preference for "${query}". ` +
    `Would you like to continue with those preferences or start a new search?`
  )
}

/**
 * Orchestrates context lookup, reuse recommendation, save, and clear.
 * Never auto-applies previous context — only suggests when similarity ≥ threshold.
 */
export class ContextRecommendationService {
  isAvailable(): boolean {
    return isContextMemoryConfigured()
  }

  async recommend(
    userId: string,
    query: string,
  ): Promise<ContextRecommendation> {
    const threshold = config.context.similarityThreshold

    if (!this.isAvailable()) {
      return {
        shouldReuse: false,
        similarity: null,
        threshold,
        match: null,
        message: null,
        preferences: null,
      }
    }

    const matches = await semanticHistorySearchService.findSimilar(
      userId,
      query,
      { threshold, limit: 1 },
    )
    const best = matches[0] ?? null
    const preferences = await userPreferenceService.getPreferences(userId)

    if (!best || best.similarity < threshold) {
      return {
        shouldReuse: false,
        similarity: best?.similarity ?? null,
        threshold,
        match: null,
        message: null,
        preferences,
      }
    }

    return {
      shouldReuse: true,
      similarity: best.similarity,
      threshold,
      match: best,
      message: buildReuseMessage(query, best.originalQuery),
      preferences,
    }
  }

  async getLatest(userId: string) {
    if (!this.isAvailable()) return null
    const [context, preferences] = await Promise.all([
      getCustomerContext(userId),
      userPreferenceService.getPreferences(userId),
    ])
    return { context, preferences }
  }

  async save(input: SaveContextInput) {
    if (!this.isAvailable()) {
      return { skipped: true as const, reason: 'not_configured' }
    }
    const saved = await conversationMemoryService.saveCompletedSession(input)
    await userPreferenceService.updateFromFilters(
      input.userId,
      input.filters,
      input.actor,
    )
    return { skipped: false as const, ...saved }
  }

  async continuePrevious(historyId: string): Promise<void> {
    if (!this.isAvailable()) return
    await semanticHistorySearchService.recordReuse(historyId)
  }

  async clearUser(userId: string): Promise<{ cleared: true }> {
    if (!this.isAvailable()) return { cleared: true }
    await Promise.all([
      softDeleteSearchHistoryForUser(userId),
      softDeleteMemoryForUser(userId),
      softDeleteSessionsForUser(userId),
      softDeleteRecommendationLogsForUser(userId),
      softDeleteCustomerContext(userId),
      userPreferenceService.clear(userId),
    ])
    return { cleared: true }
  }
}

export const contextRecommendationService = new ContextRecommendationService()
