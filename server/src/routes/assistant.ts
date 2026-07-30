import { Router } from 'express'
import { z } from 'zod'
import { runAssistantTurn, type AiResponse } from '../ai/engine.js'
import { findDirectSkuOrNameMatch } from '../magento/search.js'
import { searchProducts } from '../services/productSearch.js'
import {
  createSession,
  getSession,
  saveSession,
} from '../session/store.js'

const startSchema = z.object({
  query: z.string().trim().min(1),
})

const messageSchema = z.object({
  sessionId: z.string().uuid(),
  answer: z.string().trim().min(1),
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

export const assistantRouter = Router()

assistantRouter.post('/start', async (req, res) => {
  const parsed = startSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'query is required' })
    return
  }

  const { query } = parsed.data
  const session = createSession()
  session.messages.push({ role: 'user', content: query })
  session.filters = { query }

  try {
    // Direct SKU / product name → show matches + alternatives, skip clarifying questions
    const direct = await findDirectSkuOrNameMatch(query)
    if (direct && direct.products.length > 0) {
      const message =
        direct.alternatives.length > 0
          ? 'Found a matching product in Magento. Here it is, plus related alternatives.'
          : 'Found a matching product in Magento.'
      session.messages.push({ role: 'assistant', content: message })
      session.status = 'completed'
      saveSession(session)

      res.json({
        sessionId: session.id,
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
    session.status = 'completed'
    saveSession(session)

    res.json({
      ...toClientResponse(session.id, { ...ai, filters: searchFilters }),
      products: result.products,
      alternatives: result.alternatives,
      source: result.source,
      totalCount: result.totalCount,
      matchedCategories: result.matchedCategories,
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
    session.status = 'completed'
    saveSession(session)

    res.json({
      ...toClientResponse(session.id, { ...ai, filters: searchFilters }),
      products: result.products,
      alternatives: result.alternatives,
      source: result.source,
      totalCount: result.totalCount,
      matchedCategories: result.matchedCategories,
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
