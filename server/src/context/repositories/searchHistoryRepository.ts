import { getContextPool } from '../db.js'
import type { JsonObject, UserSearchHistoryRow } from '../types.js'

export async function insertSearchHistory(input: {
  userId: string
  sessionId?: string
  originalQuery: string
  intent?: string
  category?: string
  subcategory?: string
  filters?: JsonObject
  embeddingLiteral?: string
  embeddingModel?: string
  actor?: string
}): Promise<UserSearchHistoryRow> {
  const pool = getContextPool()
  const result = await pool.query<UserSearchHistoryRow>(
    `INSERT INTO user_search_history (
       user_id, session_id, original_query, intent, category, subcategory,
       filters, embedding, embedding_model, created_by, updated_by
     ) VALUES (
       $1, $2::uuid, $3, $4, $5, $6, $7::jsonb,
       CASE WHEN $8::text IS NULL THEN NULL ELSE $8::vector END,
       $9, $10, $10
     )
     RETURNING
       id, user_id, session_id, original_query, intent, category, subcategory,
       filters, search_frequency, last_searched_at, created_at, updated_at`,
    [
      input.userId,
      input.sessionId ?? null,
      input.originalQuery,
      input.intent ?? null,
      input.category ?? null,
      input.subcategory ?? null,
      JSON.stringify(input.filters ?? {}),
      input.embeddingLiteral ?? null,
      input.embeddingModel ?? 'bge-m3',
      input.actor ?? input.userId,
    ],
  )
  return result.rows[0]
}

export async function findSimilarSearchHistory(input: {
  userId: string
  embeddingLiteral: string
  threshold: number
  limit?: number
}): Promise<UserSearchHistoryRow[]> {
  const pool = getContextPool()
  const result = await pool.query<UserSearchHistoryRow>(
    `SELECT
       id, user_id, session_id, original_query, intent, category, subcategory,
       filters, search_frequency, last_searched_at, created_at, updated_at,
       (1 - (embedding <=> $2::vector))::float8 AS similarity
     FROM user_search_history
     WHERE user_id = $1
       AND is_deleted = FALSE
       AND embedding IS NOT NULL
       AND (1 - (embedding <=> $2::vector)) >= $3
     ORDER BY embedding <=> $2::vector ASC
     LIMIT $4`,
    [
      input.userId,
      input.embeddingLiteral,
      input.threshold,
      input.limit ?? 5,
    ],
  )
  return result.rows
}

export async function incrementSearchFrequency(historyId: string): Promise<void> {
  const pool = getContextPool()
  await pool.query(
    `UPDATE user_search_history
     SET search_frequency = search_frequency + 1,
         last_searched_at = NOW(),
         updated_at = NOW()
     WHERE id = $1::uuid AND is_deleted = FALSE`,
    [historyId],
  )
}

export async function softDeleteSearchHistoryForUser(
  userId: string,
): Promise<number> {
  const pool = getContextPool()
  const result = await pool.query(
    `UPDATE user_search_history
     SET is_deleted = TRUE, updated_at = NOW(), updated_by = $1
     WHERE user_id = $1 AND is_deleted = FALSE`,
    [userId],
  )
  return result.rowCount ?? 0
}
