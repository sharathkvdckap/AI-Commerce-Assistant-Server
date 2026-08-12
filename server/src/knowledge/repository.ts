import { getDbPool } from '../context/db.js'

export interface SheetChunkRow {
  id: string
  source: string
  topic: string | null
  sku: string | null
  content: string
  similarity?: number
}

export async function upsertSheetChunk(input: {
  id: string
  source: string
  topic?: string
  sku?: string
  content: string
  embeddingLiteral: string
  embeddingModel: string
}): Promise<void> {
  const pool = getDbPool()
  await pool.query(
    `INSERT INTO sheet_chunks (
       id, source, topic, sku, content, embedding, embedding_model, synced_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6::vector, $7, NOW(), NOW()
     )
     ON CONFLICT (id) DO UPDATE SET
       source = EXCLUDED.source,
       topic = EXCLUDED.topic,
       sku = EXCLUDED.sku,
       content = EXCLUDED.content,
       embedding = EXCLUDED.embedding,
       embedding_model = EXCLUDED.embedding_model,
       synced_at = NOW(),
       updated_at = NOW()`,
    [
      input.id,
      input.source,
      input.topic || null,
      input.sku || null,
      input.content,
      input.embeddingLiteral,
      input.embeddingModel,
    ],
  )
}

export async function searchSheetChunks(input: {
  embeddingLiteral: string
  minScore: number
  limit: number
}): Promise<SheetChunkRow[]> {
  const pool = getDbPool()
  const result = await pool.query<SheetChunkRow>(
    `SELECT
       id, source, topic, sku, content,
       (1 - (embedding <=> $1::vector))::float8 AS similarity
     FROM sheet_chunks
     WHERE embedding IS NOT NULL
       AND (1 - (embedding <=> $1::vector)) >= $2
     ORDER BY embedding <=> $1::vector ASC
     LIMIT $3`,
    [input.embeddingLiteral, input.minScore, input.limit],
  )
  return result.rows
}

export async function listSheetChunksBySku(
  skus: string[],
): Promise<SheetChunkRow[]> {
  const cleaned = [...new Set(skus.map((s) => s.trim()).filter(Boolean))]
  if (cleaned.length === 0) return []
  const pool = getDbPool()
  const result = await pool.query<SheetChunkRow>(
    `SELECT id, source, topic, sku, content, 1::float8 AS similarity
     FROM sheet_chunks
     WHERE sku = ANY($1::text[])`,
    [cleaned],
  )
  return result.rows
}

export async function listEmbeddedSheetIds(): Promise<Set<string>> {
  const pool = getDbPool()
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM sheet_chunks WHERE embedding IS NOT NULL`,
  )
  return new Set(result.rows.map((row) => row.id))
}

export async function deleteSheetChunksNotIn(
  source: string,
  keepIds: string[],
): Promise<number> {
  const pool = getDbPool()
  if (keepIds.length === 0) {
    const result = await pool.query(
      `DELETE FROM sheet_chunks WHERE source = $1`,
      [source],
    )
    return result.rowCount ?? 0
  }
  const result = await pool.query(
    `DELETE FROM sheet_chunks
     WHERE source = $1
       AND NOT (id = ANY($2::text[]))`,
    [source, keepIds],
  )
  return result.rowCount ?? 0
}

export async function countSheetChunks(): Promise<{
  total: number
  withEmbedding: number
}> {
  const pool = getDbPool()
  const result = await pool.query<{ total: string; embedded: string }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(embedding)::text AS embedded
     FROM sheet_chunks`,
  )
  return {
    total: Number(result.rows[0]?.total ?? 0),
    withEmbedding: Number(result.rows[0]?.embedded ?? 0),
  }
}

export async function pingSheetKnowledge(): Promise<{
  ok: boolean
  error?: string
  chunkCount?: number
  withEmbedding?: number
}> {
  try {
    const counts = await countSheetChunks()
    return {
      ok: true,
      chunkCount: counts.total,
      withEmbedding: counts.withEmbedding,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'unreachable',
    }
  }
}
