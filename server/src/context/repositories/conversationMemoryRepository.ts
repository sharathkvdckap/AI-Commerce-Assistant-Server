import { getContextPool } from '../db.js'
import type { ConversationMemoryRow, JsonArray } from '../types.js'

export async function upsertConversationMemory(input: {
  userId: string
  sessionId: string
  questionsAsked?: JsonArray
  customerAnswers?: JsonArray
  aiRecommendations?: JsonArray
  conversationSummary?: string
  messageLog?: JsonArray
  actor?: string
}): Promise<ConversationMemoryRow> {
  const pool = getContextPool()
  const result = await pool.query<ConversationMemoryRow>(
    `INSERT INTO conversation_memory (
       user_id, session_id, questions_asked, customer_answers,
       ai_recommendations, conversation_summary, message_log,
       created_by, updated_by
     ) VALUES (
       $1, $2::uuid, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8, $8
     )
     ON CONFLICT (session_id) DO UPDATE SET
       questions_asked = EXCLUDED.questions_asked,
       customer_answers = EXCLUDED.customer_answers,
       ai_recommendations = EXCLUDED.ai_recommendations,
       conversation_summary = COALESCE(EXCLUDED.conversation_summary, conversation_memory.conversation_summary),
       message_log = EXCLUDED.message_log,
       is_deleted = FALSE,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [
      input.userId,
      input.sessionId,
      JSON.stringify(input.questionsAsked ?? []),
      JSON.stringify(input.customerAnswers ?? []),
      JSON.stringify(input.aiRecommendations ?? []),
      input.conversationSummary ?? null,
      JSON.stringify(input.messageLog ?? []),
      input.actor ?? input.userId,
    ],
  )
  return result.rows[0]
}

export async function getMemoryBySession(
  sessionId: string,
): Promise<ConversationMemoryRow | null> {
  const pool = getContextPool()
  const result = await pool.query<ConversationMemoryRow>(
    `SELECT * FROM conversation_memory
     WHERE session_id = $1::uuid AND is_deleted = FALSE
     ORDER BY created_at DESC
     LIMIT 1`,
    [sessionId],
  )
  return result.rows[0] ?? null
}

export async function softDeleteMemoryForUser(userId: string): Promise<number> {
  const pool = getContextPool()
  const result = await pool.query(
    `UPDATE conversation_memory
     SET is_deleted = TRUE, updated_at = NOW(), updated_by = $1
     WHERE user_id = $1 AND is_deleted = FALSE`,
    [userId],
  )
  return result.rowCount ?? 0
}
