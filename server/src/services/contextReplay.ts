import { isContextMemoryConfigured, isMagentoConfigured } from '../config/env.js'
import { getRecommendationSnapshotsByHistoryId } from '../context/repositories/recommendationLogRepository.js'
import type { JsonArray, JsonObject } from '../context/types.js'
import { mapMagentoProduct } from '../magento/mapper.js'
import { fetchProductsBySku } from '../magento/search.js'
import type {
  CatalogProduct,
  MagentoProductItem,
  ProductSource,
} from '../magento/types.js'

export type MatchType = 'exact' | 'recommended' | 'mixed' | 'none'
const MAX_ALTERNATIVES = 12

export interface ReplayedSearch {
  products: CatalogProduct[]
  alternatives: CatalogProduct[]
  source: ProductSource
  matchType: MatchType
  totalCount: number
  previousQuery: string | null
  filters: JsonObject
  /** Saved products that are no longer purchasable and were dropped. */
  droppedCount: number
  savedAt: string
}

function readSku(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return ''
  const sku = (entry as { sku?: unknown }).sku
  return typeof sku === 'string' ? sku.trim() : ''
}

function readReasons(entry: unknown): string[] {
  if (!entry || typeof entry !== 'object') return []
  const reasons = (entry as { reasons?: unknown }).reasons
  if (!Array.isArray(reasons)) return []
  return reasons.filter((reason): reason is string => typeof reason === 'string')
}

function skuKey(entry: unknown): string {
  return readSku(entry).toLowerCase()
}

function uniqueBySku(entries: JsonArray, excluded = new Set<string>()): JsonArray {
  const unique: JsonArray = []
  const seen = new Set(excluded)

  for (const entry of entries) {
    const key = skuKey(entry)
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(entry)
  }

  return unique
}

/**
 * Rebuilds saved products from the live catalog, keeping the original order and
 * the explanation the shopper saw last time, but taking price, stock, name and
 * URLs from Magento. Products that no longer resolve are dropped.
 */
function refreshList(
  stored: JsonArray,
  live: Map<string, MagentoProductItem>,
): CatalogProduct[] {
  const refreshed: CatalogProduct[] = []

  for (const entry of stored) {
    const sku = readSku(entry)
    const item = sku ? live.get(sku) : undefined
    if (!item) continue

    const current = mapMagentoProduct(item, {}, [])
    const reasons = readReasons(entry)
    refreshed.push(reasons.length > 0 ? { ...current, reasons } : current)
  }

  return refreshed
}

/**
 * Replays all snapshots saved for the same normalized query instead of running
 * a new search. Product and alternative SKUs are unique across the response.
 */
export async function replayPreviousSearch(
  historyId: string,
  userId: string,
): Promise<ReplayedSearch | null> {
  if (!isContextMemoryConfigured() || !isMagentoConfigured()) return null

  const snapshots = await getRecommendationSnapshotsByHistoryId(
    historyId,
    userId,
  )
  if (snapshots.length === 0) return null

  const storedProducts = uniqueBySku(
    snapshots.flatMap((snapshot) => snapshot.products),
  )
  const productKeys = new Set(storedProducts.map(skuKey))
  const storedAlternatives = uniqueBySku(
    snapshots.flatMap((snapshot) => snapshot.alternatives),
    productKeys,
  )

  const storedSkus = [...storedProducts, ...storedAlternatives]
    .map(readSku)
    .filter((sku) => sku !== '')

  if (storedSkus.length === 0) return null

  const live = await fetchProductsBySku(storedSkus)
  const products = refreshList(storedProducts, live)
  const refreshedAlternatives = refreshList(storedAlternatives, live)
  const alternatives = refreshedAlternatives.slice(0, MAX_ALTERNATIVES)

  // Everything from that session is gone — a fresh search is more useful.
  if (products.length === 0 && alternatives.length === 0) return null

  const latest = snapshots[snapshots.length - 1]
  const matchType: MatchType =
    products.length > 0
      ? alternatives.length > 0
        ? 'mixed'
        : 'exact'
      : 'recommended'

  return {
    products,
    alternatives,
    source: 'magento',
    matchType,
    totalCount: products.length,
    previousQuery: latest.query,
    filters: latest.filters,
    droppedCount:
      storedSkus.length - (products.length + refreshedAlternatives.length),
    savedAt: latest.createdAt.toISOString(),
  }
}
