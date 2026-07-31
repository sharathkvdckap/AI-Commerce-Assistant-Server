import { getContextPool } from '../db.js'
import type { JsonArray, JsonObject } from '../types.js'

export async function insertRecommendationLog(input: {
  userId: string
  sessionId?: string
  query?: string
  filters?: JsonObject
  products?: JsonArray
  alternatives?: JsonArray
  source?: string
  matchType?: string
  actor?: string
}): Promise<void> {
  const pool = getContextPool()
  await pool.query(
    `INSERT INTO ai_recommendation_logs (
       user_id, session_id, query, filters, products, alternatives,
       source, match_type, created_by, updated_by
     ) VALUES (
       $1, $2::uuid, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9, $9
     )`,
    [
      input.userId,
      input.sessionId ?? null,
      input.query ?? null,
      JSON.stringify(input.filters ?? {}),
      JSON.stringify(input.products ?? []),
      JSON.stringify(input.alternatives ?? []),
      input.source ?? null,
      input.matchType ?? null,
      input.actor ?? input.userId,
    ],
  )
}

export interface RecommendationSnapshot {
  query: string | null
  filters: JsonObject
  products: JsonArray
  alternatives: JsonArray
  source: string | null
  matchType: string | null
  createdAt: Date
}

/**
 * All product snapshots for the same user's same normalized query as the
 * history entry the shopper chose. Oldest-first ordering makes merging stable:
 * an SKU keeps the position where it was first recommended.
 */
export async function getRecommendationSnapshotsByHistoryId(
  historyId: string,
  userId: string,
): Promise<RecommendationSnapshot[]> {
  const pool = getContextPool()
  const result = await pool.query<{
    query: string | null
    filters: JsonObject | null
    products: JsonArray | null
    alternatives: JsonArray | null
    source: string | null
    match_type: string | null
    created_at: Date
  }>(
    `WITH selected AS (
       SELECT user_id, LOWER(BTRIM(original_query)) AS normalized_query
       FROM user_search_history
       WHERE id = $1::uuid
         AND user_id = $2
         AND is_deleted = FALSE
     )
     SELECT r.query, r.filters, r.products, r.alternatives,
            r.source, r.match_type, r.created_at
     FROM selected s
     JOIN user_search_history h
       ON h.user_id = s.user_id
      AND LOWER(BTRIM(h.original_query)) = s.normalized_query
      AND h.is_deleted = FALSE
     JOIN ai_recommendation_logs r ON r.session_id = h.session_id
     WHERE r.is_deleted = FALSE
     ORDER BY r.created_at ASC`,
    [historyId, userId],
  )

  return result.rows.map((row) => ({
    query: row.query,
    filters: row.filters ?? {},
    products: row.products ?? [],
    alternatives: row.alternatives ?? [],
    source: row.source,
    matchType: row.match_type,
    createdAt: row.created_at,
  }))
}

export async function softDeleteRecommendationLogsForUser(
  userId: string,
): Promise<number> {
  const pool = getContextPool()
  const result = await pool.query(
    `UPDATE ai_recommendation_logs
     SET is_deleted = TRUE, updated_at = NOW(), updated_by = $1
     WHERE user_id = $1 AND is_deleted = FALSE`,
    [userId],
  )
  return result.rowCount ?? 0
}
