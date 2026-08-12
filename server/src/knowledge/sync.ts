import { config } from '../config/env.js'
import { embedText, toPgVectorLiteral } from '../context/embeddings.js'
import { loadSheetRows, type SheetRow } from './fetch.js'
import {
  countSheetChunks,
  deleteSheetChunksNotIn,
  listEmbeddedSheetIds,
  upsertSheetChunk,
} from './repository.js'

export interface SyncSheetResult {
  source: string
  scanned: number
  upserted: number
  skipped: number
  failed: number
  removed: number
  totalCount: number
  errors: string[]
}

async function embedAndUpsert(row: SheetRow, source: string): Promise<void> {
  const embedding = await embedText(row.content)
  await upsertSheetChunk({
    id: row.id,
    source,
    topic: row.topic,
    sku: row.sku,
    content: row.content,
    embeddingLiteral: toPgVectorLiteral(embedding),
    embeddingModel: config.context.embeddingModel,
  })
}

/**
 * Google Sheet / CSV → Ollama BGE-M3 → Postgres sheet_chunks.
 */
export async function syncSheetKnowledge(options?: {
  concurrency?: number
  force?: boolean
  onProgress?: (info: {
    scanned: number
    upserted: number
    skipped: number
    totalCount: number
  }) => void
}): Promise<SyncSheetResult> {
  const concurrency = Math.max(
    1,
    options?.concurrency ?? config.sheetRag.syncConcurrency,
  )
  const force = options?.force ?? false
  const { rows, source } = await loadSheetRows()

  let scanned = 0
  let upserted = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []
  const alreadyIndexed = force ? new Set<string>() : await listEmbeddedSheetIds()

  const pending = rows.filter((row) => {
    scanned += 1
    if (alreadyIndexed.has(row.id)) {
      skipped += 1
      return false
    }
    return Boolean(row.content)
  })

  for (let i = 0; i < pending.length; i += concurrency) {
    const batch = pending.slice(i, i + concurrency)
    await Promise.all(
      batch.map(async (row) => {
        try {
          await embedAndUpsert(row, source)
          upserted += 1
        } catch (error) {
          failed += 1
          const msg =
            error instanceof Error ? error.message : 'unknown embedding error'
          if (errors.length < 10) errors.push(`${row.id}: ${msg}`)
          console.error(`[knowledge:sync] ${row.id}:`, msg)
        }
      }),
    )
    options?.onProgress?.({
      scanned,
      upserted,
      skipped,
      totalCount: rows.length,
    })
  }

  const removed = await deleteSheetChunksNotIn(
    source,
    rows.map((row) => row.id),
  )
  const totals = await countSheetChunks()

  return {
    source,
    scanned,
    upserted,
    skipped,
    failed,
    removed,
    totalCount: totals.total,
    errors,
  }
}

export async function getSheetIndexStatus() {
  return countSheetChunks()
}
