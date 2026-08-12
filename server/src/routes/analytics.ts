import { Router } from 'express'
import { z } from 'zod'
import {
  getAnalyticsSummary,
  isAnalyticsConfigured,
  listRecentSearches,
  trackProductEvents,
} from '../analytics/index.js'
import { identityProofSchema, trustedUserIdFromBody } from '../auth/resolveRequestUser.js'
import { isCustomerIdentityConfigured } from '../auth/customerIdentity.js'

export const analyticsRouter = Router()

analyticsRouter.get('/status', (_req, res) => {
  res.json({
    ok: true,
    enabled: isAnalyticsConfigured(),
    customerIdentityHmac: isCustomerIdentityConfigured(),
    message: isAnalyticsConfigured()
      ? 'Analytics uses DATABASE_URL (Postgres). Run: npm run db:migrate:analytics'
      : 'Set DATABASE_URL in server/.env to enable analytics',
  })
})

analyticsRouter.get('/summary', async (req, res) => {
  if (!isAnalyticsConfigured()) {
    res.status(503).json({ ok: false, error: 'analytics_not_configured' })
    return
  }
  const days = Number(req.query.days ?? 30)
  try {
    const summary = await getAnalyticsSummary(
      Number.isFinite(days) ? days : 30,
    )
    res.json({ ok: true, summary })
  } catch (error) {
    console.error('[analytics/summary]', error)
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'summary_failed',
    })
  }
})

analyticsRouter.get('/searches', async (req, res) => {
  if (!isAnalyticsConfigured()) {
    res.status(503).json({ ok: false, error: 'analytics_not_configured' })
    return
  }
  const limit = Number(req.query.limit ?? 10)
  const page = Number(req.query.page ?? 1)
  const safeLimit = Number.isFinite(limit) ? limit : 10
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
  const offset = (safePage - 1) * Math.min(Math.max(safeLimit, 1), 100)

  try {
    const result = await listRecentSearches(safeLimit, offset)
    const totalPages = Math.max(1, Math.ceil(result.total / result.limit))
    res.json({
      ok: true,
      searches: result.searches,
      total: result.total,
      limit: result.limit,
      page: safePage,
      totalPages,
    })
  } catch (error) {
    console.error('[analytics/searches]', error)
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'searches_failed',
    })
  }
})

const trackSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  identity: identityProofSchema,
  sessionId: z.string().uuid().optional(),
  searchId: z.string().uuid().optional(),
  source: z.string().optional(),
  events: z
    .array(
      z.object({
        eventType: z.enum(['impression', 'click']),
        sku: z.string().trim().min(1),
        productId: z.string().optional(),
        productName: z.string().optional(),
        productUrl: z.string().optional(),
        listType: z.enum(['primary', 'alternative']).optional(),
        position: z.number().int().min(0).optional(),
      }),
    )
    .min(1)
    .max(100),
})

analyticsRouter.post('/track', async (req, res) => {
  if (!isAnalyticsConfigured()) {
    res.status(202).json({ ok: true, inserted: 0, skipped: true })
    return
  }
  const parsed = trackSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'invalid_payload' })
    return
  }
  const trusted = trustedUserIdFromBody({
    userId: parsed.data.userId,
    identity: parsed.data.identity,
  })
  if ('error' in trusted) {
    res.status(401).json({ ok: false, error: trusted.error })
    return
  }
  const { sessionId, searchId, source, events } = parsed.data
  try {
    const inserted = await trackProductEvents(
      events.map((e) => ({
        userId: trusted.userId,
        sessionId,
        searchId,
        source,
        eventType: e.eventType,
        sku: e.sku,
        productId: e.productId,
        productName: e.productName,
        productUrl: e.productUrl,
        listType: e.listType,
        position: e.position,
      })),
    )
    res.json({ ok: true, inserted })
  } catch (error) {
    console.error('[analytics/track]', error)
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'track_failed',
    })
  }
})
