import { Router } from 'express'
import { z } from 'zod'
import { config, isSheetRagConfigured } from '../config/env.js'
import {
  getSheetIndexStatus,
  pingSheetKnowledge,
  retrieveSheetChunks,
  syncSheetKnowledge,
} from '../knowledge/index.js'

export const knowledgeRouter = Router()

knowledgeRouter.get('/status', async (_req, res) => {
  const ping = isSheetRagConfigured()
    ? await pingSheetKnowledge()
    : { ok: false, error: 'not_configured' }
  let index: { total: number; withEmbedding: number } | undefined
  if (ping.ok) {
    try {
      index = await getSheetIndexStatus()
    } catch {
      index = undefined
    }
  }
  res.json({
    enabled: isSheetRagConfigured(),
    csvUrl: config.sheetRag.csvUrl || null,
    csvPath: config.sheetRag.csvPath,
    embeddingModel: config.context.embeddingModel,
    topK: config.sheetRag.topK,
    minScore: config.sheetRag.minScore,
    ...ping,
    index,
  })
})

const syncSchema = z.object({
  force: z.boolean().optional(),
  concurrency: z.number().int().min(1).max(16).optional(),
})

knowledgeRouter.post('/sync', async (req, res) => {
  if (!isSheetRagConfigured()) {
    res.status(503).json({
      ok: false,
      error:
        'Sheet RAG is not configured. Set SHEET_RAG_ENABLED=true and DATABASE_URL.',
    })
    return
  }

  const parsedBody = syncSchema.safeParse(req.body ?? {})
  if (!parsedBody.success) {
    res.status(400).json({ ok: false, error: parsedBody.error.flatten() })
    return
  }

  try {
    console.log('[knowledge] sync started')
    const result = await syncSheetKnowledge({
      force: parsedBody.data.force,
      concurrency: parsedBody.data.concurrency,
      onProgress: (info) => {
        console.log(
          `[knowledge] sync: embedded ${info.upserted}, skipped ${info.skipped}, scanned ${info.scanned}/${info.totalCount}`,
        )
      },
    })
    console.log(
      `[knowledge] sync done: upserted=${result.upserted} failed=${result.failed} removed=${result.removed}`,
    )
    res.json({ ok: true, ...result })
  } catch (error) {
    console.error('[knowledge] sync failed:', error)
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'sync_failed',
    })
  }
})

const searchSchema = z.object({
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(20).optional(),
  minScore: z.number().min(0).max(1).optional(),
})

knowledgeRouter.post('/search', async (req, res) => {
  if (!isSheetRagConfigured()) {
    res.status(503).json({
      ok: false,
      error:
        'Sheet RAG is not configured. Set SHEET_RAG_ENABLED=true and DATABASE_URL.',
    })
    return
  }

  const parsed = searchSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.flatten() })
    return
  }

  try {
    const hits = await retrieveSheetChunks(parsed.data.query, {
      limit: parsed.data.limit,
      minScore: parsed.data.minScore,
    })
    res.json({
      ok: true,
      query: parsed.data.query,
      count: hits.length,
      hits,
    })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'search_failed',
    })
  }
})
