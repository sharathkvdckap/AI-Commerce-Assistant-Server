import { getContextPool, getDbPool } from '../context/db.js'
import { isDatabaseConfigured } from '../config/env.js'

export function isAnalyticsConfigured(): boolean {
  return isDatabaseConfigured()
}

export interface SearchAnalyticsInput {
  userId: string
  sessionId?: string
  originalQuery: string
  filters?: Record<string, unknown>
  source?: string
  matchType?: string
  products?: Array<{ sku?: string; id?: string }>
  alternatives?: Array<{ sku?: string; id?: string }>
  fromMemory?: boolean
}

export async function insertSearchAnalytics(
  input: SearchAnalyticsInput,
): Promise<string | null> {
  if (!isAnalyticsConfigured()) return null

  const products = input.products ?? []
  const alternatives = input.alternatives ?? []
  const productSkus = products.map((p) => p.sku).filter(Boolean)
  const alternativeSkus = alternatives.map((p) => p.sku).filter(Boolean)
  const productCount = products.length
  const alternativeCount = alternatives.length
  const isZeroResult = productCount === 0 && alternativeCount === 0

  const pool = getDbPool()
  const result = await pool.query<{ id: string }>(
    `INSERT INTO ai_search_analytics (
       user_id, session_id, original_query, filters, source, match_type,
       product_count, alternative_count, product_skus, alternative_skus,
       is_zero_result, from_memory
     ) VALUES (
       $1, $2::uuid, $3, $4::jsonb, $5, $6,
       $7, $8, $9::jsonb, $10::jsonb,
       $11, $12
     )
     RETURNING id`,
    [
      input.userId,
      input.sessionId ?? null,
      input.originalQuery,
      JSON.stringify(input.filters ?? {}),
      input.source ?? null,
      input.matchType ?? null,
      productCount,
      alternativeCount,
      JSON.stringify(productSkus),
      JSON.stringify(alternativeSkus),
      isZeroResult,
      input.fromMemory ?? false,
    ],
  )
  return result.rows[0]?.id ?? null
}

export interface ProductEventInput {
  userId: string
  sessionId?: string
  searchId?: string
  eventType: 'impression' | 'click'
  sku: string
  productId?: string
  productName?: string
  productUrl?: string
  listType?: 'primary' | 'alternative'
  source?: string
  position?: number
}

export async function insertProductEvents(
  events: ProductEventInput[],
): Promise<number> {
  if (!isAnalyticsConfigured() || events.length === 0) return 0

  const pool = getContextPool()
  let inserted = 0
  for (const event of events) {
    await pool.query(
      `INSERT INTO ai_product_events (
         user_id, session_id, search_id, event_type, sku, product_id,
         product_name, product_url, list_type, source, position
       ) VALUES (
         $1, $2::uuid, $3::uuid, $4, $5, $6,
         $7, $8, $9, $10, $11
       )`,
      [
        event.userId,
        event.sessionId ?? null,
        event.searchId ?? null,
        event.eventType,
        event.sku,
        event.productId ?? null,
        event.productName ?? null,
        event.productUrl ?? null,
        event.listType ?? 'primary',
        event.source ?? null,
        event.position ?? null,
      ],
    )
    inserted += 1
  }
  return inserted
}

export interface AnalyticsSummary {
  windowDays: number
  totalSearches: number
  zeroResultCount: number
  zeroResultRate: number
  sourceBreakdown: Record<string, number>
  hybridOrSemanticCount: number
  hybridLiftShare: number
  magentoOnlyCount: number
  impressions: number
  clicks: number
  ctr: number
  uniqueUsers: number
  topQueries: Array<{ query: string; count: number; zeroResults: number }>
  topClickedSkus: Array<{
    sku: string
    name: string | null
    impressions: number
    clicks: number
    ctr: number
  }>
}

function sinceClause(days: number): { sql: string; params: number[] } {
  if (days <= 0) return { sql: 'TRUE', params: [] }
  return { sql: `created_at >= NOW() - ($1::text || ' days')::interval`, params: [days] }
}

export async function getAnalyticsSummary(
  days = 30,
): Promise<AnalyticsSummary | null> {
  if (!isAnalyticsConfigured()) return null

  const pool = getDbPool()
  const windowDays = Math.min(Math.max(days, 1), 365)
  const { sql: since, params } = sinceClause(windowDays)

  const searchStats = await pool.query<{
    total: string
    zero_count: string
    unique_users: string
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE is_zero_result)::text AS zero_count,
       COUNT(DISTINCT user_id)::text AS unique_users
     FROM ai_search_analytics
     WHERE ${since}`,
    params,
  )

  const sources = await pool.query<{ source: string | null; c: string }>(
    `SELECT COALESCE(source, 'unknown') AS source, COUNT(*)::text AS c
     FROM ai_search_analytics
     WHERE ${since}
     GROUP BY 1
     ORDER BY COUNT(*) DESC`,
    params,
  )

  const events = await pool.query<{
    impressions: string
    clicks: string
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE event_type = 'impression')::text AS impressions,
       COUNT(*) FILTER (WHERE event_type = 'click')::text AS clicks
     FROM ai_product_events
     WHERE ${since}`,
    params,
  )

  const topQueries = await pool.query<{
    query: string
    count: string
    zero_results: string
  }>(
    `SELECT
       original_query AS query,
       COUNT(*)::text AS count,
       COUNT(*) FILTER (WHERE is_zero_result)::text AS zero_results
     FROM ai_search_analytics
     WHERE ${since}
     GROUP BY original_query
     ORDER BY COUNT(*) DESC
     LIMIT 5`,
    params,
  )

  const topClicked = await pool.query<{
    sku: string
    name: string | null
    impressions: string
    clicks: string
  }>(
    `SELECT
       sku,
       MAX(product_name) FILTER (WHERE product_name IS NOT NULL AND product_name <> '') AS name,
       COUNT(*) FILTER (WHERE event_type = 'impression')::text AS impressions,
       COUNT(*) FILTER (WHERE event_type = 'click')::text AS clicks
     FROM ai_product_events
     WHERE ${since}
     GROUP BY sku
     HAVING COUNT(*) FILTER (WHERE event_type = 'click') > 0
     ORDER BY COUNT(*) FILTER (WHERE event_type = 'click') DESC,
              COUNT(*) FILTER (WHERE event_type = 'impression') DESC
     LIMIT 5`,
    params,
  )

  const total = Number(searchStats.rows[0]?.total ?? 0)
  const zeroCount = Number(searchStats.rows[0]?.zero_count ?? 0)
  const sourceBreakdown: Record<string, number> = {}
  for (const row of sources.rows) {
    sourceBreakdown[row.source ?? 'unknown'] = Number(row.c)
  }
  const hybridOrSemanticCount =
    (sourceBreakdown.hybrid ?? 0) + (sourceBreakdown.semantic ?? 0)
  const magentoOnlyCount = sourceBreakdown.magento ?? 0
  const impressions = Number(events.rows[0]?.impressions ?? 0)
  const clicks = Number(events.rows[0]?.clicks ?? 0)

  return {
    windowDays,
    totalSearches: total,
    zeroResultCount: zeroCount,
    zeroResultRate: total > 0 ? zeroCount / total : 0,
    sourceBreakdown,
    hybridOrSemanticCount,
    /** Share of searches that used semantic/hybrid recall (lift opportunity realized). */
    hybridLiftShare: total > 0 ? hybridOrSemanticCount / total : 0,
    magentoOnlyCount,
    impressions,
    clicks,
    ctr: impressions > 0 ? clicks / impressions : 0,
    uniqueUsers: Number(searchStats.rows[0]?.unique_users ?? 0),
    topQueries: topQueries.rows.map((r) => ({
      query: r.query,
      count: Number(r.count),
      zeroResults: Number(r.zero_results),
    })),
    topClickedSkus: topClicked.rows.map((r) => {
      const impressions = Number(r.impressions)
      const clicks = Number(r.clicks)
      return {
        sku: r.sku,
        name: r.name,
        impressions,
        clicks,
        ctr: impressions > 0 ? clicks / impressions : clicks > 0 ? 1 : 0,
      }
    }),
  }
}

export async function listRecentSearches(
  limit = 10,
  offset = 0,
): Promise<{
  searches: Array<{
    id: string
    userId: string
    sessionId: string | null
    query: string
    source: string | null
    matchType: string | null
    productCount: number
    alternativeCount: number
    isZeroResult: boolean
    fromMemory: boolean
    filters: Record<string, unknown>
    createdAt: string
  }>
  total: number
  limit: number
  offset: number
}> {
  if (!isAnalyticsConfigured()) {
    return { searches: [], total: 0, limit: 10, offset: 0 }
  }

  const pool = getDbPool()
  const capped = Math.min(Math.max(limit, 1), 100)
  const skip = Math.max(offset, 0)

  const countResult = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM ai_search_analytics`,
  )
  const total = Number(countResult.rows[0]?.c ?? 0)

  const result = await pool.query<{
    id: string
    user_id: string
    session_id: string | null
    original_query: string
    source: string | null
    match_type: string | null
    product_count: number
    alternative_count: number
    is_zero_result: boolean
    from_memory: boolean
    filters: Record<string, unknown>
    created_at: Date
  }>(
    `SELECT
       id, user_id, session_id, original_query, source, match_type,
       product_count, alternative_count, is_zero_result, from_memory,
       filters, created_at
     FROM ai_search_analytics
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [capped, skip],
  )

  return {
    searches: result.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      sessionId: r.session_id,
      query: r.original_query,
      source: r.source,
      matchType: r.match_type,
      productCount: r.product_count,
      alternativeCount: r.alternative_count,
      isZeroResult: r.is_zero_result,
      fromMemory: r.from_memory,
      filters: r.filters ?? {},
      createdAt: r.created_at.toISOString(),
    })),
    total,
    limit: capped,
    offset: skip,
  }
}
