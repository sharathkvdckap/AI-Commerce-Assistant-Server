import { Router } from 'express'
import { z } from 'zod'
import {
  getAnalyticsSummary,
  isAnalyticsConfigured,
  listRecentSearches,
  trackProductEvents,
} from '../analytics/index.js'
import { CONVERSION_EVENT_TYPES } from '../analytics/repository.js'
import {
  isAnalyticsIngestConfigured,
  verifyAnalyticsIngestToken,
} from '../auth/analyticsIngest.js'
import { identityProofSchema, trustedUserIdFromBody } from '../auth/resolveRequestUser.js'
import { isCustomerIdentityConfigured } from '../auth/customerIdentity.js'

export const analyticsRouter = Router()

analyticsRouter.get('/status', (_req, res) => {
  res.json({
    ok: true,
    enabled: isAnalyticsConfigured(),
    customerIdentityHmac: isCustomerIdentityConfigured(),
    conversionIngest: isAnalyticsIngestConfigured(),
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
        eventType: z.enum(['impression', 'click', 'cart', 'checkout', 'order']),
        sku: z.string().trim().min(1),
        productId: z.string().optional(),
        productName: z.string().optional(),
        productUrl: z.string().optional(),
        listType: z.enum(['primary', 'alternative']).optional(),
        position: z.number().int().min(0).optional(),
        searchId: z.string().uuid().optional(),
        sessionId: z.string().uuid().optional(),
        source: z.string().optional(),
        quoteId: z.string().trim().min(1).max(64).optional(),
        orderId: z.string().trim().min(1).max(64).optional(),
        qty: z.number().finite().nonnegative().optional(),
        revenue: z.number().finite().nonnegative().optional(),
        currency: z.string().trim().min(1).max(8).optional(),
        meta: z.record(z.string(), z.unknown()).optional(),
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
  const hasConversion = parsed.data.events.some((e) =>
    (CONVERSION_EVENT_TYPES as readonly string[]).includes(e.eventType),
  )
  let userId: string
  if (hasConversion) {
    if (!verifyAnalyticsIngestToken(req)) {
      res.status(401).json({
        ok: false,
        error: isAnalyticsIngestConfigured()
          ? 'ingest_token_invalid'
          : 'ingest_token_not_configured',
      })
      return
    }
    userId = parsed.data.userId
  } else {
    const trusted = trustedUserIdFromBody({
      userId: parsed.data.userId,
      identity: parsed.data.identity,
    })
    if ('error' in trusted) {
      res.status(401).json({ ok: false, error: trusted.error })
      return
    }
    userId = trusted.userId
  }
  const { sessionId, searchId, source, events } = parsed.data
  try {
    const inserted = await trackProductEvents(
      events.map((e) => ({
        userId,
        sessionId: e.sessionId ?? sessionId,
        searchId: e.searchId ?? searchId,
        source: e.source ?? source,
        eventType: e.eventType,
        sku: e.sku,
        productId: e.productId,
        productName: e.productName,
        productUrl: e.productUrl,
        listType: e.listType,
        position: e.position,
        quoteId: e.quoteId,
        orderId: e.orderId,
        qty: e.qty,
        revenue: e.revenue,
        currency: e.currency,
        meta: e.meta,
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
