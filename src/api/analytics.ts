import { getOrCreateUserId } from '@/lib/userId'

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

export interface AnalyticsSearchRow {
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
}

export type TrackableProduct = {
  id: string
  sku: string
  name: string
  productUrl: string
}

async function postJson(path: string, body: unknown) {
  await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => undefined)
}

export async function trackProductEvents(input: {
  sessionId?: string | null
  searchId?: string | null
  source?: string | null
  events: Array<{
    eventType: 'impression' | 'click'
    sku: string
    productId?: string
    productName?: string
    productUrl?: string
    listType?: 'primary' | 'alternative'
    position?: number
  }>
}): Promise<void> {
  if (!input.events.length) return
  await postJson('/api/analytics/track', {
    userId: getOrCreateUserId(),
    sessionId: input.sessionId ?? undefined,
    searchId: input.searchId ?? undefined,
    source: input.source ?? undefined,
    events: input.events,
  })
}

export function trackImpressions(input: {
  sessionId?: string | null
  searchId?: string | null
  source?: string | null
  products: TrackableProduct[]
  alternatives?: TrackableProduct[]
}): void {
  const events = [
    ...input.products.map((p, position) => ({
      eventType: 'impression' as const,
      sku: p.sku,
      productId: p.id,
      productName: p.name,
      productUrl: p.productUrl,
      listType: 'primary' as const,
      position,
    })),
    ...(input.alternatives ?? []).map((p, position) => ({
      eventType: 'impression' as const,
      sku: p.sku,
      productId: p.id,
      productName: p.name,
      productUrl: p.productUrl,
      listType: 'alternative' as const,
      position,
    })),
  ]
  void trackProductEvents({
    sessionId: input.sessionId,
    searchId: input.searchId,
    source: input.source,
    events,
  })
}

export function trackProductClick(input: {
  sessionId?: string | null
  searchId?: string | null
  source?: string | null
  product: TrackableProduct
  listType?: 'primary' | 'alternative'
  position?: number
}): void {
  void trackProductEvents({
    sessionId: input.sessionId,
    searchId: input.searchId,
    source: input.source,
    events: [
      {
        eventType: 'click',
        sku: input.product.sku,
        productId: input.product.id,
        productName: input.product.name,
        productUrl: input.product.productUrl,
        listType: input.listType ?? 'primary',
        position: input.position,
      },
    ],
  })
}

export async function fetchAnalyticsSummary(
  days = 30,
): Promise<AnalyticsSummary | null> {
  const res = await fetch(`/api/analytics/summary?days=${days}`)
  if (!res.ok) return null
  const data = (await res.json()) as {
    ok?: boolean
    summary?: AnalyticsSummary
  }
  return data.summary ?? null
}

export async function fetchAnalyticsSearches(
  page = 1,
  limit = 10,
): Promise<{
  searches: AnalyticsSearchRow[]
  total: number
  page: number
  totalPages: number
  limit: number
}> {
  const res = await fetch(
    `/api/analytics/searches?page=${page}&limit=${limit}`,
  )
  if (!res.ok) {
    return { searches: [], total: 0, page: 1, totalPages: 1, limit }
  }
  const data = (await res.json()) as {
    ok?: boolean
    searches?: AnalyticsSearchRow[]
    total?: number
    page?: number
    totalPages?: number
    limit?: number
  }
  return {
    searches: data.searches ?? [],
    total: data.total ?? 0,
    page: data.page ?? page,
    totalPages: data.totalPages ?? 1,
    limit: data.limit ?? limit,
  }
}
