import { config } from '../../config/env.js'
import { embedText, toPgVectorLiteral } from '../embeddings.js'
import { getMemoryBySession } from '../repositories/conversationMemoryRepository.js'
import {
  findSimilarSearchHistory,
  incrementSearchFrequency,
} from '../repositories/searchHistoryRepository.js'
import type { SimilarHistoryMatch } from '../types.js'

/**
 * Semantic search over a user's prior queries using BGE-M3 + pgvector.
 */
export class SemanticHistorySearchService {
  async findSimilar(
    userId: string,
    query: string,
    options?: { threshold?: number; limit?: number },
  ): Promise<SimilarHistoryMatch[]> {
    const threshold =
      options?.threshold ?? config.context.similarityThreshold
    const embedding = await embedText(query)
    const embeddingLiteral = toPgVectorLiteral(embedding)

    const rows = await findSimilarSearchHistory({
      userId,
      embeddingLiteral,
      threshold,
      limit: options?.limit ?? 5,
    })

    const matches: SimilarHistoryMatch[] = []
    for (const row of rows) {
      let summary: string | null = null
      if (row.session_id) {
        const memory = await getMemoryBySession(row.session_id)
        summary = memory?.conversation_summary ?? null
      }

      matches.push({
        historyId: row.id,
        sessionId: row.session_id,
        originalQuery: row.original_query,
        intent: row.intent,
        category: row.category,
        subcategory: row.subcategory,
        filters: row.filters ?? {},
        similarity: Number(row.similarity ?? 0),
        searchFrequency: row.search_frequency,
        lastSearchedAt: new Date(row.last_searched_at).toISOString(),
        summary,
      })
    }

    return matches
  }

  async recordReuse(historyId: string): Promise<void> {
    await incrementSearchFrequency(historyId)
  }
}

export const semanticHistorySearchService = new SemanticHistorySearchService()
