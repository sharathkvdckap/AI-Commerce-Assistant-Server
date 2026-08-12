import { Router } from 'express'
import { z } from 'zod'
import { runAssistantTurn, type AiResponse, type ProductFilters } from '../ai/engine.js'
import { trackSearchAnalytics } from '../analytics/index.js'
import { identityProofSchema, trustedUserIdFromBody } from '../auth/resolveRequestUser.js'
import { isContextMemoryConfigured } from '../config/env.js'
import { contextRecommendationService } from '../context/services/ContextRecommendationService.js'
import { findDirectSkuOrNameMatch } from '../magento/search.js'
import {
  replayPreviousSearch,
  type ReplayedSearch,
} from '../services/contextReplay.js'
import { searchProducts } from '../services/productSearch.js'
import {
  attachKnowledgeMessage,
  retrieveSheetChunksSafe,
} from '../knowledge/index.js'
import {
  createSession,
  getSession,
  saveSession,
  type AssistantSession,
} from '../session/store.js'

const filtersRecord = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
)

const startSchema = z.object({
  query: z.string().trim().min(1),
  userId: z.string().trim().min(1).max(128).optional(),
  identity: identityProofSchema,
  /** When customer chooses Continue Previous Search — seed known filters. */
  reuseFilters: filtersRecord.optional(),
  reuseHistoryId: z.string().uuid().optional(),
})

const messageSchema = z.object({
  sessionId: z.string().uuid(),
  answer: z.string().trim().min(1),
  userId: z.string().trim().min(1).max(128).optional(),
  identity: identityProofSchema,
})

const searchSchema = z
  .object({
    category: z.string().optional(),
    usage: z.string().optional(),
    fit: z.string().optional(),
    price_min: z.number().optional(),
    price_max: z.number().optional(),
  })
  .passthrough()

function toClientResponse(sessionId: string, ai: AiResponse) {
  if (ai.action === 'ask_question') {
    return {
      sessionId,
      action: 'ask_question' as const,
      message: ai.message ?? ai.question,
      question: ai.question,
      options: ai.options,
      filters: ai.filters ?? {},
    }
  }

  return {
    sessionId,
    action: 'search_products' as const,
    message:
      ai.message ??
      'Based on your preferences, here are products from the Magento catalog.',
    filters: ai.filters,
  }
}

function buildReplayMessage(replayed: ReplayedSearch): string {
  const forQuery = replayed.previousQuery
    ? ` for "${replayed.previousQuery}"`
    : ''
  const parts = [
    `Continuing your previous search${forQuery}. Showing the same products, with current prices and availability.`,
  ]

  if (replayed.droppedCount > 0) {
    parts.push(
      replayed.droppedCount === 1
        ? '1 item is no longer available and has been removed.'
        : `${replayed.droppedCount} items are no longer available and have been removed.`,
    )
  }

  return parts.join(' ')
}

async function persistSessionContext(
  session: AssistantSession,
  extras?: {
    products?: unknown[]
    alternatives?: unknown[]
    source?: string
    matchType?: string
  },
): Promise<void> {
  if (!isContextMemoryConfigured() || !session.userId) return

  const originalQuery =
    typeof session.filters.query === 'string'
      ? session.filters.query
      : session.messages.find((m) => m.role === 'user')?.content

  if (!originalQuery?.trim()) return

  try {
    await contextRecommendationService.save({
      userId: session.userId,
      sessionId: session.id,
      originalQuery: originalQuery.trim(),
      domain:
        typeof session.filters.domain === 'string'
          ? session.filters.domain
          : undefined,
      category:
        typeof session.filters.category === 'string'
          ? session.filters.category
          : undefined,
      filters: session.filters as Record<string, unknown>,
      messages: session.messages,
      products: extras?.products,
      alternatives: extras?.alternatives,
      source: extras?.source,
      matchType: extras?.matchType,
      actor: session.userId,
    })
  } catch (error) {
    console.warn(
      '[assistant] context save failed',
      error instanceof Error ? error.message : error,
    )
  }
}

function resolveQuery(session: AssistantSession, fallback?: string): string {
  if (typeof session.filters.query === 'string' && session.filters.query.trim()) {
    return session.filters.query.trim()
  }
  const fromHistory = session.messages.find((m) => m.role === 'user')?.content
  return (fromHistory ?? fallback ?? '').trim()
}

/** Log search analytics (Postgres). Returns searchId for CTR linking. */
async function logSearchAnalytics(
  session: AssistantSession,
  extras: {
    products?: Array<{ sku?: string; id?: string }>
    alternatives?: Array<{ sku?: string; id?: string }>
    source?: string
    matchType?: string
    fromMemory?: boolean
    queryFallback?: string
  },
): Promise<string | null> {
  const userId = session.userId ?? 'anonymous'
  const originalQuery = resolveQuery(session, extras.queryFallback)
  if (!originalQuery) return null
  return trackSearchAnalytics({
    userId,
    sessionId: session.id,
    originalQuery,
    filters: session.filters as Record<string, unknown>,
    source: extras.source,
    matchType: extras.matchType,
    products: extras.products,
    alternatives: extras.alternatives,
    fromMemory: extras.fromMemory,
  })
}

export const assistantRouter = Router()

assistantRouter.post('/start', async (req, res) => {
  const parsed = startSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'query is required' })
    return
  }

  const trusted = trustedUserIdFromBody({
    userId: parsed.data.userId,
    identity: parsed.data.identity,
  })
  if ('error' in trusted) {
    res.status(401).json({ error: trusted.error })
    return
  }
  const userId = trusted.userId
  console.log('[assistant/start] identity', {
    claimedUserId: parsed.data.userId ?? null,
    trustedUserId: userId,
    identityAttached: Boolean(parsed.data.identity),
    identityCustomerId: parsed.data.identity?.customerId ?? null,
  })

  const { query, reuseFilters, reuseHistoryId } = parsed.data
  const seeded: ProductFilters = {
    ...(reuseFilters ?? {}),
    query,
  }

  const session = createSession({
    userId,
    filters: seeded,
    reusedContext: Boolean(reuseFilters && Object.keys(reuseFilters).length),
  })
  session.messages.push({ role: 'user', content: query })

  if (reuseHistoryId && isContextMemoryConfigured()) {
    void contextRecommendationService
      .continuePrevious(reuseHistoryId)
      .catch(() => undefined)

    try {
      const replayed = await replayPreviousSearch(reuseHistoryId, userId)
      if (replayed) {
        const message = buildReplayMessage(replayed)
        session.filters = {
          ...(replayed.filters as ProductFilters),
          query: replayed.previousQuery ?? query,
        }
        session.messages.push({ role: 'assistant', content: message })
        session.status = 'completed'
        saveSession(session)

        const searchId = await logSearchAnalytics(session, {
          products: replayed.products,
          alternatives: replayed.alternatives,
          source: replayed.source,
          matchType: replayed.matchType,
          fromMemory: true,
          queryFallback: query,
        })

        // Not persisted as new context: replaying is not a new search, and
        // continuePrevious() already recorded the reuse.
        res.json({
          sessionId: session.id,
          searchId,
          action: 'search_products' as const,
          message,
          filters: session.filters,
          products: replayed.products,
          alternatives: replayed.alternatives,
          source: replayed.source,
          totalCount: replayed.totalCount,
          matchedCategories: [],
          matchType: replayed.matchType,
          fromMemory: true,
          previousQuery: replayed.previousQuery,
          savedAt: replayed.savedAt,
        })
        return
      }
    } catch (error) {
      console.warn(
        '[assistant/start] context replay failed; running a live search',
        error instanceof Error ? error.message : error,
      )
    }
  }

  try {
    const direct = await findDirectSkuOrNameMatch(query)
    if (direct && direct.products.length > 0) {
      const knowledge = await retrieveSheetChunksSafe(query, {
        skus: direct.products
          .map((p) => p.sku)
          .filter((sku): sku is string => Boolean(sku)),
      })
      const baseMessage =
        direct.alternatives.length > 0
          ? 'Found a matching product in Magento. Here it is, plus related alternatives.'
          : 'Found a matching product in Magento.'
      const message = attachKnowledgeMessage(baseMessage, knowledge)
      session.messages.push({ role: 'assistant', content: message })
      session.status = 'completed'
      saveSession(session)
      void persistSessionContext(session, {
        products: direct.products,
        alternatives: direct.alternatives,
        source: 'magento',
        matchType: direct.matchType,
      })

      const searchId = await logSearchAnalytics(session, {
        products: direct.products,
        alternatives: direct.alternatives,
        source: 'magento',
        matchType: direct.matchType,
        queryFallback: query,
      })

      res.json({
        sessionId: session.id,
        searchId,
        action: 'search_products' as const,
        message,
        filters: session.filters,
        products: direct.products,
        alternatives: direct.alternatives,
        source: 'magento' as const,
        totalCount: direct.totalCount,
        matchedCategories: direct.matchedCategories,
        matchType: direct.matchType,
      })
      return
    }

    const ai = await runAssistantTurn({
      query,
      history: session.messages,
      knownFilters: session.filters,
    })

    if (ai.filters) {
      session.filters = { ...ai.filters, query: session.filters.query ?? query }
    }

    if (ai.action === 'ask_question') {
      const preface = ai.message?.trim()
      const question = ai.question.trim()
      const content =
        preface && preface !== question && !preface.includes(question)
          ? `${preface}\n\n${question}`
          : question || preface || ''
      session.messages.push({
        role: 'assistant',
        content,
      })
      session.status = 'collecting'
      saveSession(session)
      res.json(toClientResponse(session.id, ai))
      return
    }

    session.messages.push({
      role: 'assistant',
      content: ai.message ?? 'Searching Magento catalog…',
    })
    session.status = 'ready_to_search'
    saveSession(session)

    const searchFilters = {
      ...ai.filters,
      query: session.filters.query ?? query,
    }
    const result = await searchProducts(searchFilters)
    session.filters = searchFilters
    session.status = 'completed'
    saveSession(session)
    void persistSessionContext(session, {
      products: result.products,
      alternatives: result.alternatives,
      source: result.source,
      matchType: result.matchType,
    })

    const searchId = await logSearchAnalytics(session, {
      products: result.products,
      alternatives: result.alternatives,
      source: result.source,
      matchType: result.matchType,
      queryFallback: query,
    })

    res.json({
      ...toClientResponse(session.id, { ...ai, filters: searchFilters }),
      searchId,
      products: result.products,
      alternatives: result.alternatives,
      source: result.source,
      totalCount: result.totalCount,
      matchedCategories: result.matchedCategories,
      matchedAttributes: result.matchedAttributes,
      matchType: result.matchType,
      warning: result.warning,
    })
    return
  } catch (error) {
    console.error('[assistant/start]', error)
    res.status(502).json({
      error:
        error instanceof Error
          ? error.message
          : 'Failed to start assistant session',
    })
  }
})

assistantRouter.post('/message', async (req, res) => {
  const parsed = messageSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'sessionId and answer are required' })
    return
  }

  const { sessionId, answer } = parsed.data
  const session = getSession(sessionId)
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  const trusted = trustedUserIdFromBody({
    userId: parsed.data.userId,
    identity: parsed.data.identity,
  })
  if ('error' in trusted) {
    res.status(401).json({ error: trusted.error })
    return
  }
  if (trusted.userId && !session.userId) {
    session.userId = trusted.userId
  }

  session.messages.push({ role: 'user', content: answer })

  try {
    const ai = await runAssistantTurn({
      query: answer,
      history: session.messages,
      knownFilters: session.filters,
    })

    if (ai.filters) {
      session.filters = {
        ...ai.filters,
        query: session.filters.query ?? ai.filters.query,
      }
    }

    if (ai.action === 'ask_question') {
      const preface = ai.message?.trim()
      const question = ai.question.trim()
      const content =
        preface && preface !== question && !preface.includes(question)
          ? `${preface}\n\n${question}`
          : question || preface || ''
      session.messages.push({
        role: 'assistant',
        content,
      })
      session.status = 'collecting'
      saveSession(session)
      res.json(toClientResponse(session.id, ai))
      return
    }

    session.messages.push({
      role: 'assistant',
      content: ai.message ?? 'Searching Magento catalog…',
    })
    session.status = 'ready_to_search'
    saveSession(session)

    const searchFilters = {
      ...ai.filters,
      query: session.filters.query ?? ai.filters.query,
    }
    const result = await searchProducts(searchFilters)
    session.filters = searchFilters
    session.status = 'completed'
    saveSession(session)
    void persistSessionContext(session, {
      products: result.products,
      alternatives: result.alternatives,
      source: result.source,
      matchType: result.matchType,
    })

    const searchId = await logSearchAnalytics(session, {
      products: result.products,
      alternatives: result.alternatives,
      source: result.source,
      matchType: result.matchType,
    })

    res.json({
      ...toClientResponse(session.id, { ...ai, filters: searchFilters }),
      searchId,
      products: result.products,
      alternatives: result.alternatives,
      source: result.source,
      totalCount: result.totalCount,
      matchedCategories: result.matchedCategories,
      matchedAttributes: result.matchedAttributes,
      matchType: result.matchType,
      warning: result.warning,
    })
  } catch (error) {
    console.error('[assistant/message]', error)
    res.status(502).json({
      error:
        error instanceof Error ? error.message : 'Failed to process message',
    })
  }
})

assistantRouter.post('/search', async (req, res) => {
  const parsed = searchSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid filters payload' })
    return
  }

  const filters = parsed.data as Record<string, string | number | boolean>

  try {
    const result = await searchProducts(filters)
    res.json({
      action: 'search_products',
      filters,
      products: result.products,
      alternatives: result.alternatives,
      source: result.source,
      totalCount: result.totalCount,
      matchedCategories: result.matchedCategories,
      matchedAttributes: result.matchedAttributes,
      matchType: result.matchType,
      warning: result.warning,
    })
  } catch (error) {
    console.error('[assistant/search]', error)
    res.status(502).json({
      error:
        error instanceof Error ? error.message : 'Magento product search failed',
    })
  }
})
