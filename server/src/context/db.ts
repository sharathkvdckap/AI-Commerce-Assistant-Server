import pg from 'pg'
import {
  config,
  isContextMemoryConfigured,
  isDatabaseConfigured,
  isSemanticConfigured,
} from '../config/env.js'

const { Pool } = pg

let pool: pg.Pool | null = null

/**
 * Shared Postgres pool for context memory + product semantic search.
 */
export function getDbPool(): pg.Pool {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'Database is not configured. Set DATABASE_URL in server/.env',
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

/** Pool for context-memory repositories (requires CONTEXT_MEMORY_ENABLED). */
export function getContextPool(): pg.Pool {
  if (!isContextMemoryConfigured()) {
    throw new Error(
      'Context memory is not configured. Set CONTEXT_MEMORY_ENABLED=true and DATABASE_URL.',
    )
  }
  return getDbPool()
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
    const client = await getDbPool().connect()
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

export async function pingSemanticDatabase(): Promise<{
  ok: boolean
  error?: string
  productCount?: number
  withEmbedding?: number
}> {
  if (!isSemanticConfigured()) {
    return { ok: false, error: 'not_configured' }
  }
  try {
    const client = await getDbPool().connect()
    try {
      await client.query('SELECT 1')
      const count = await client.query<{ total: string; embedded: string }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(embedding)::text AS embedded
         FROM product_embeddings`,
      )
      return {
        ok: true,
        productCount: Number(count.rows[0]?.total ?? 0),
        withEmbedding: Number(count.rows[0]?.embedded ?? 0),
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
