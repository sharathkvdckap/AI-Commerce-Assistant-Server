import { getContextPool } from '../db.js'
import type {
  ConversationSessionRow,
  JsonObject,
  SessionStatus,
} from '../types.js'

export async function createConversationSession(input: {
  id?: string
  userId: string
  originalQuery?: string
  domain?: string
  filters?: JsonObject
  status?: SessionStatus
  actor?: string
}): Promise<ConversationSessionRow> {
  const pool = getContextPool()
  const result = await pool.query<ConversationSessionRow>(
    `INSERT INTO conversation_sessions (
       id, user_id, status, original_query, domain, filters, created_by, updated_by
     ) VALUES (
       COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6::jsonb, $7, $7
     )
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       original_query = COALESCE(EXCLUDED.original_query, conversation_sessions.original_query),
       domain = COALESCE(EXCLUDED.domain, conversation_sessions.domain),
       filters = EXCLUDED.filters,
       is_deleted = FALSE,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [
      input.id ?? null,
      input.userId,
      input.status ?? 'collecting',
      input.originalQuery ?? null,
      input.domain ?? null,
      JSON.stringify(input.filters ?? {}),
      input.actor ?? input.userId,
    ],
  )
  return result.rows[0]
}

export async function updateConversationSession(
  sessionId: string,
  patch: {
    status?: SessionStatus
    filters?: JsonObject
    domain?: string
    completedAt?: Date | null
    actor?: string
  },
): Promise<ConversationSessionRow | null> {
  const pool = getContextPool()
  const result = await pool.query<ConversationSessionRow>(
    `UPDATE conversation_sessions SET
       status = COALESCE($2, status),
       filters = COALESCE($3::jsonb, filters),
       domain = COALESCE($4, domain),
       completed_at = COALESCE($5, completed_at),
       updated_at = NOW(),
       updated_by = COALESCE($6, updated_by)
     WHERE id = $1::uuid AND is_deleted = FALSE
     RETURNING *`,
    [
      sessionId,
      patch.status ?? null,
      patch.filters ? JSON.stringify(patch.filters) : null,
      patch.domain ?? null,
      patch.completedAt ?? null,
      patch.actor ?? null,
    ],
  )
  return result.rows[0] ?? null
}

export async function getConversationSession(
  sessionId: string,
): Promise<ConversationSessionRow | null> {
  const pool = getContextPool()
  const result = await pool.query<ConversationSessionRow>(
    `SELECT * FROM conversation_sessions
     WHERE id = $1::uuid AND is_deleted = FALSE`,
    [sessionId],
  )
  return result.rows[0] ?? null
}

export async function softDeleteSessionsForUser(userId: string): Promise<number> {
  const pool = getContextPool()
  const result = await pool.query(
    `UPDATE conversation_sessions
     SET is_deleted = TRUE, updated_at = NOW(), updated_by = $1
     WHERE user_id = $1 AND is_deleted = FALSE`,
    [userId],
  )
  return result.rowCount ?? 0
}
