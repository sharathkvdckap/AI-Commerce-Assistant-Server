import { getContextPool } from '../db.js'
import type { CustomerContextRow, JsonObject } from '../types.js'

/** Row shape for user_context table. */
export type UserContextRow = CustomerContextRow

export async function getCustomerContext(
  userId: string,
): Promise<UserContextRow | null> {
  const pool = getContextPool()
  const result = await pool.query<UserContextRow>(
    `SELECT * FROM user_context
     WHERE user_id = $1 AND is_deleted = FALSE`,
    [userId],
  )
  return result.rows[0] ?? null
}

export async function upsertCustomerContext(input: {
  userId: string
  latestSessionId?: string
  latestQuery?: string
  latestSummary?: string
  latestFilters?: JsonObject
  preferenceSnapshot?: JsonObject
  actor?: string
}): Promise<UserContextRow> {
  const pool = getContextPool()
  const result = await pool.query<UserContextRow>(
    `INSERT INTO user_context (
       user_id, latest_session_id, latest_query, latest_summary,
       latest_filters, preference_snapshot, last_activity_at,
       created_by, updated_by
     ) VALUES (
       $1, $2::uuid, $3, $4, $5::jsonb, $6::jsonb, NOW(), $7, $7
     )
     ON CONFLICT (user_id) DO UPDATE SET
       latest_session_id = COALESCE(EXCLUDED.latest_session_id, user_context.latest_session_id),
       latest_query = COALESCE(EXCLUDED.latest_query, user_context.latest_query),
       latest_summary = COALESCE(EXCLUDED.latest_summary, user_context.latest_summary),
       latest_filters = COALESCE(EXCLUDED.latest_filters, user_context.latest_filters),
       preference_snapshot = COALESCE(EXCLUDED.preference_snapshot, user_context.preference_snapshot),
       last_activity_at = NOW(),
       is_deleted = FALSE,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [
      input.userId,
      input.latestSessionId ?? null,
      input.latestQuery ?? null,
      input.latestSummary ?? null,
      JSON.stringify(input.latestFilters ?? {}),
      JSON.stringify(input.preferenceSnapshot ?? {}),
      input.actor ?? input.userId,
    ],
  )
  return result.rows[0]
}

export async function softDeleteCustomerContext(
  userId: string,
): Promise<number> {
  const pool = getContextPool()
  const result = await pool.query(
    `UPDATE user_context
     SET is_deleted = TRUE, updated_at = NOW(), updated_by = $1
     WHERE user_id = $1 AND is_deleted = FALSE`,
    [userId],
  )
  return result.rowCount ?? 0
}
