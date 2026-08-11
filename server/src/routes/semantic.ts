import { Router } from 'express'
import { z } from 'zod'
import {
  config,
  isSemanticConfigured,
} from '../config/env.js'
import { pingSemanticDatabase } from '../context/db.js'
import {
  getSemanticIndexStatus,
  hydrateSemanticHits,
  searchSemanticProducts,
  syncProductEmbeddings,
} from '../semantic/index.js'

export const semanticRouter = Router()

semanticRouter.get('/status', async (_req, res) => {
  const ping = await pingSemanticDatabase()
  let index: { total: number; withEmbedding: number } | undefined
  if (ping.ok) {
    try {
      index = await getSemanticIndexStatus()
    } catch {
      index = undefined
    }
  }
  res.json({
    enabled: isSemanticConfigured(),
    embeddingModel: config.context.embeddingModel,
    topK: config.semantic.topK,
    minScore: config.semantic.minScore,
    fallbackMinScore: config.semantic.fallbackMinScore,
    ...ping,
    index,
  })
})

const syncSchema = z.object({
  force: z.boolean().optional(),
  concurrency: z.number().int().min(1).max(16).optional(),
})

semanticRouter.post('/sync', async (req, res) => {
  if (!isSemanticConfigured()) {
    res.status(503).json({
      ok: false,
      error:
        'Semantic search is not configured. Set SEMANTIC_ENABLED=true and DATABASE_URL.',
    })
    return
  }

  const parsedBody = syncSchema.safeParse(req.body ?? {})
  if (!parsedBody.success) {
    res.status(400).json({ ok: false, error: parsedBody.error.flatten() })
    return
  }

  try {
    console.log('[semantic] sync started')
    const result = await syncProductEmbeddings({
      force: parsedBody.data.force,
      concurrency: parsedBody.data.concurrency,
      onProgress: (info) => {
        console.log(
          `[semantic] sync page ${info.page}: embedded ${info.upserted}, skipped ${info.skipped}, scanned ${info.scanned}/${info.totalCount}`,
        )
      },
    })
    console.log(
      `[semantic] sync done: upserted=${result.upserted} failed=${result.failed}`,
    )
    res.json({ ok: true, ...result })
  } catch (error) {
    console.error('[semantic] sync failed:', error)
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'sync_failed',
    })
  }
})

const searchSchema = z.object({
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(50).optional(),
  minScore: z.number().min(0).max(1).optional(),
})

semanticRouter.post('/search', async (req, res) => {
  if (!isSemanticConfigured()) {
    res.status(503).json({
      ok: false,
      error:
        'Semantic search is not configured. Set SEMANTIC_ENABLED=true and DATABASE_URL.',
    })
    return
  }

  const parsed = searchSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.flatten() })
    return
  }

  try {
    const filters = { query: parsed.data.query }
    const hits = await searchSemanticProducts(filters, {
      limit: parsed.data.limit ?? config.semantic.topK,
      minScore: parsed.data.minScore ?? config.semantic.minScore,
    })
    const products = await hydrateSemanticHits(hits, filters)
    res.json({
      ok: true,
      source: 'semantic',
      query: parsed.data.query,
      count: products.length,
      products,
      scores: hits.map((h) => ({ sku: h.sku, similarity: h.similarity })),
    })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'search_failed',
    })
  }
})
