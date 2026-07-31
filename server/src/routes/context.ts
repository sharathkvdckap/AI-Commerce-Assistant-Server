import { Router } from 'express'
import { z } from 'zod'
import { pingContextDatabase } from '../context/db.js'
import { contextRecommendationService } from '../context/services/ContextRecommendationService.js'
import { isContextMemoryConfigured } from '../config/env.js'

const userIdSchema = z.string().trim().min(1).max(128)

const saveSchema = z.object({
  userId: userIdSchema,
  sessionId: z.string().uuid(),
  originalQuery: z.string().trim().min(1),
  intent: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  domain: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).default({}),
  messages: z
    .array(
      z.object({
        role: z.string(),
        content: z.string(),
      }),
    )
    .default([]),
  questionsAsked: z.array(z.unknown()).optional(),
  customerAnswers: z.array(z.unknown()).optional(),
  products: z.array(z.unknown()).optional(),
  alternatives: z.array(z.unknown()).optional(),
  source: z.string().optional(),
  matchType: z.string().optional(),
  summary: z.string().optional(),
})

const searchSchema = z.object({
  userId: userIdSchema,
  query: z.string().trim().min(1),
})

const clearSchema = z.object({
  userId: userIdSchema,
})

export const contextRouter = Router()

contextRouter.get('/status', async (_req, res) => {
  const ping = await pingContextDatabase()
  res.json({
    enabled: isContextMemoryConfigured(),
    ...ping,
  })
})

/** Persist completed session memory + preferences. */
contextRouter.post('/save', async (req, res) => {
  const parsed = saveSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid save payload', details: parsed.error.flatten() })
    return
  }

  try {
    const result = await contextRecommendationService.save(parsed.data)
    res.json({ ok: true, ...result })
  } catch (error) {
    console.error('[context/save]', error)
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Failed to save context',
    })
  }
})

/** Latest snapshot for a user (fast path). */
contextRouter.get('/latest', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : ''
  if (!userId) {
    res.status(400).json({ error: 'userId query param is required' })
    return
  }

  try {
    const started = Date.now()
    const latest = await contextRecommendationService.getLatest(userId)
    res.json({
      ok: true,
      elapsedMs: Date.now() - started,
      ...latest,
    })
  } catch (error) {
    console.error('[context/latest]', error)
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Failed to load context',
    })
  }
})

/**
 * Semantic search against prior conversations.
 * Returns a reuse recommendation when similarity ≥ threshold (never auto-applies).
 */
contextRouter.post('/search', async (req, res) => {
  const parsed = searchSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'userId and query are required' })
    return
  }

  try {
    const started = Date.now()
    const recommendation = await contextRecommendationService.recommend(
      parsed.data.userId,
      parsed.data.query,
    )
    res.json({
      ok: true,
      elapsedMs: Date.now() - started,
      ...recommendation,
    })
  } catch (error) {
    console.error('[context/search]', error)
    res.status(502).json({
      error:
        error instanceof Error
          ? error.message
          : 'Failed to search conversation history',
    })
  }
})

/** Soft-delete all context for a user (DELETE /api/context?userId=). */
contextRouter.delete('/', async (req, res) => {
  const userId =
    (typeof req.query.userId === 'string' ? req.query.userId.trim() : '') ||
    (typeof req.body?.userId === 'string' ? req.body.userId.trim() : '')

  if (!userId) {
    res.status(400).json({ error: 'userId is required' })
    return
  }

  try {
    await contextRecommendationService.clearUser(userId)
    res.json({ ok: true, cleared: true })
  } catch (error) {
    console.error('[context/delete]', error)
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Failed to delete context',
    })
  }
})

/** Explicit clear endpoint (same as DELETE). */
contextRouter.post('/clear', async (req, res) => {
  const parsed = clearSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'userId is required' })
    return
  }

  try {
    await contextRecommendationService.clearUser(parsed.data.userId)
    res.json({ ok: true, cleared: true })
  } catch (error) {
    console.error('[context/clear]', error)
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Failed to clear context',
    })
  }
})

/** Mark a history hit as reused when user chooses Continue. */
contextRouter.post('/continue', async (req, res) => {
  const schema = z.object({
    userId: userIdSchema,
    historyId: z.string().uuid(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'userId and historyId are required' })
    return
  }

  try {
    await contextRecommendationService.continuePrevious(parsed.data.historyId)
    res.json({ ok: true })
  } catch (error) {
    console.error('[context/continue]', error)
    res.status(502).json({
      error:
        error instanceof Error ? error.message : 'Failed to continue context',
    })
  }
})
