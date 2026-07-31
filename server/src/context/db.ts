import pg from 'pg'
import { config, isContextMemoryConfigured } from '../config/env.js'

const { Pool } = pg

let pool: pg.Pool | null = null

export function getContextPool(): pg.Pool {
  if (!isContextMemoryConfigured()) {
    throw new Error(
      'Context memory is not configured. Set CONTEXT_MEMORY_ENABLED=true and DATABASE_URL.',
    )
  }
  if (!pool) {
    pool = new Pool({
      connectionString: config.context.databaseUrl,
      max: 8,
    })
  }
  return pool
}

export async function closeContextPool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

export async function pingContextDatabase(): Promise<{
  ok: boolean
  error?: string
  historyCount?: number
}> {
  if (!isContextMemoryConfigured()) {
    return { ok: false, error: 'not_configured' }
  }
  try {
    const client = await getContextPool().connect()
    try {
      await client.query('SELECT 1')
      const count = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM user_search_history WHERE is_deleted = FALSE`,
      )
      return {
        ok: true,
        historyCount: Number(count.rows[0]?.c ?? 0),
      }
    } finally {
      client.release()
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'unreachable',
    }
  }
}
