import { config } from '../../config/env.js'
import { embedText, toPgVectorLiteral } from '../embeddings.js'
import { upsertConversationMemory } from '../repositories/conversationMemoryRepository.js'
import {
  createConversationSession,
  updateConversationSession,
} from '../repositories/conversationSessionRepository.js'
import { upsertCustomerContext } from '../repositories/customerContextRepository.js'
import { insertRecommendationLog } from '../repositories/recommendationLogRepository.js'
import { insertSearchHistory } from '../repositories/searchHistoryRepository.js'
import type { JsonObject, SaveContextInput } from '../types.js'

function buildSummary(input: SaveContextInput): string {
  if (input.summary?.trim()) return input.summary.trim()

  const parts: string[] = []
  if (input.originalQuery) parts.push(`Looking for: ${input.originalQuery}`)
  if (input.intent) parts.push(`Intent: ${input.intent}`)
  if (input.category) parts.push(`Category: ${input.category}`)

  const filters = input.filters ?? {}
  const highlightKeys = [
    'budget',
    'brand',
    'size',
    'color',
    'colour',
    'gender',
    'fit',
    'usage',
  ]
  for (const key of highlightKeys) {
    const value = filters[key]
    if (value != null && String(value).trim()) {
      parts.push(`${key}: ${String(value)}`)
    }
  }

  return parts.join('. ') || input.originalQuery
}

function extractQaFromMessages(
  messages: Array<{ role: string; content: string }>,
): { questions: string[]; answers: string[] } {
  const questions: string[] = []
  const answers: string[] = []
  for (const msg of messages) {
    if (msg.role === 'assistant') questions.push(msg.content)
    if (msg.role === 'user') answers.push(msg.content)
  }
  return { questions, answers }
}

function pickPreferenceSnapshot(filters: JsonObject): JsonObject {
  const keys = [
    'budget',
    'brand',
    'size',
    'color',
    'colour',
    'gender',
    'fit',
    'usage',
    'material',
    'category',
  ]
  const out: JsonObject = {}
  for (const key of keys) {
    if (filters[key] != null) out[key] = filters[key]
  }
  return out
}

/**
 * Persists a completed shopping session: session, memory, search history
 * (with embedding), recommendation log, and user_context snapshot.
 */
export class ConversationMemoryService {
  async saveCompletedSession(input: SaveContextInput): Promise<{
    sessionId: string
    historyId: string
    summary: string
  }> {
    const actor = input.actor ?? input.userId
    const summary = buildSummary(input)
    const { questions, answers } = extractQaFromMessages(input.messages)

    const session = await createConversationSession({
      id: input.sessionId,
      userId: input.userId,
      originalQuery: input.originalQuery,
      domain: input.domain,
      filters: input.filters,
      status: 'completed',
      actor,
    })

    await updateConversationSession(session.id, {
      status: 'completed',
      filters: input.filters,
      domain: input.domain,
      completedAt: new Date(),
      actor,
    })

    await upsertConversationMemory({
      userId: input.userId,
      sessionId: session.id,
      questionsAsked: input.questionsAsked ?? questions,
      customerAnswers: input.customerAnswers ?? answers,
      aiRecommendations: input.products ?? [],
      conversationSummary: summary,
      messageLog: input.messages,
      actor,
    })

    let embeddingLiteral: string | undefined
    try {
      const embedding = await embedText(input.originalQuery)
      embeddingLiteral = toPgVectorLiteral(embedding)
    } catch (error) {
      console.warn(
        '[ConversationMemoryService] embedding failed; saving history without vector',
        error instanceof Error ? error.message : error,
      )
    }

    const history = await insertSearchHistory({
      userId: input.userId,
      sessionId: session.id,
      originalQuery: input.originalQuery,
      intent: input.intent,
      category: input.category,
      subcategory: input.subcategory,
      filters: input.filters,
      embeddingLiteral,
      embeddingModel: config.context.embeddingModel,
      actor,
    })

    await insertRecommendationLog({
      userId: input.userId,
      sessionId: session.id,
      query: input.originalQuery,
      filters: input.filters,
      products: input.products,
      alternatives: input.alternatives,
      source: input.source,
      matchType: input.matchType,
      actor,
    })

    await upsertCustomerContext({
      userId: input.userId,
      latestSessionId: session.id,
      latestQuery: input.originalQuery,
      latestSummary: summary,
      latestFilters: input.filters,
      preferenceSnapshot: pickPreferenceSnapshot(input.filters),
      actor,
    })

    return { sessionId: session.id, historyId: history.id, summary }
  }
}

export const conversationMemoryService = new ConversationMemoryService()
