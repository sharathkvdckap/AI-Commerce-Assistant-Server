import type { ProductFilters } from '../ai/engine.js'
import { config } from '../config/env.js'
import { magentoGraphql } from './client.js'
import { matchCategoriesFromSearch } from './categoryMatch.js'
import {
  buildProductFilter,
  buildSearchQuery,
  mapMagentoProduct,
} from './mapper.js'
import type {
  CatalogProduct,
  MagentoProductItem,
  MagentoProductsResponse,
} from './types.js'

const PRODUCTS_QUERY = `
  query SearchProducts(
    $search: String
    $filter: ProductAttributeFilterInput
    $pageSize: Int!
    $currentPage: Int!
  ) {
    products(
      search: $search
      filter: $filter
      pageSize: $pageSize
      currentPage: $currentPage
    ) {
      total_count
      items {
        id
        sku
        name
        url_key
        stock_status
        small_image {
          url
          label
        }
        price_range {
          minimum_price {
            final_price {
              value
              currency
            }
            regular_price {
              value
              currency
            }
          }
        }
      }
    }
  }
`

/** Per-request batch size (Magento GraphQL often caps around 100). */
const BATCH_PAGE_SIZE = 100
/** Safety cap so a huge catalog cannot hang the request. */
const MAX_FETCH_PAGES = 50
/** Cap alternatives returned for the carousel. */
const MAX_ALTERNATIVES = 12

async function runProductsQuery(
  search: string | null,
  filter: Record<string, unknown>,
): Promise<{ items: MagentoProductsResponse['products']['items']; totalCount: number }> {
  const hasFilter = Object.keys(filter).length > 0
  // 0 / unset = fetch all pages; otherwise honor configured size as a soft max total
  const configured = config.magento.pageSize
  const fetchAll = !configured || configured <= 0
  const batchSize = fetchAll
    ? BATCH_PAGE_SIZE
    : Math.min(Math.max(configured, 1), BATCH_PAGE_SIZE)
  const maxTotal = fetchAll ? BATCH_PAGE_SIZE * MAX_FETCH_PAGES : configured

  const allItems: MagentoProductsResponse['products']['items'] = []
  let totalCount = 0
  let currentPage = 1

  while (currentPage <= MAX_FETCH_PAGES && allItems.length < maxTotal) {
    const data = await magentoGraphql<MagentoProductsResponse>(PRODUCTS_QUERY, {
      search,
      filter: hasFilter ? filter : {},
      pageSize: batchSize,
      currentPage,
    })
    const items = data.products?.items ?? []
    totalCount = data.products?.total_count ?? allItems.length + items.length
    allItems.push(...items)

    if (items.length === 0 || allItems.length >= totalCount) {
      break
    }
    currentPage += 1
  }

  return {
    items: allItems.slice(0, maxTotal),
    totalCount,
  }
}

/** Magento rejects oversized filter arrays, so SKU lookups are chunked. */
const SKU_LOOKUP_BATCH = 50

/**
 * Current catalog state for a known set of SKUs, keyed by SKU.
 * A missing key means the product is no longer purchasable (removed,
 * disabled, or out of the current store scope).
 */
export async function fetchProductsBySku(
  skus: string[],
): Promise<Map<string, MagentoProductItem>> {
  const unique = [
    ...new Set(skus.map((sku) => sku.trim()).filter((sku) => sku !== '')),
  ]
  const live = new Map<string, MagentoProductItem>()

  for (let i = 0; i < unique.length; i += SKU_LOOKUP_BATCH) {
    const batch = unique.slice(i, i + SKU_LOOKUP_BATCH)
    const data = await magentoGraphql<MagentoProductsResponse>(PRODUCTS_QUERY, {
      search: null,
      filter: { sku: { in: batch } },
      pageSize: batch.length,
      currentPage: 1,
    })
    for (const item of data.products?.items ?? []) {
      if (item.sku) live.set(item.sku, item)
    }
  }

  return live
}

function productKey(item: { id?: number | string; sku?: string }): string {
  return String(item.id ?? item.sku ?? '')
}

function excludeItems(
  items: MagentoProductsResponse['products']['items'],
  excludeIds: Set<string>,
) {
  return items.filter((item) => {
    const key = productKey(item)
    return key !== '' && !excludeIds.has(key)
  })
}

async function fetchBroadAlternatives(
  filters: ProductFilters,
  categoryIds: string[],
  hasCategoryFilter: boolean,
  excludeIds: Set<string>,
): Promise<MagentoProductsResponse['products']['items']> {
  const broadSearch =
    buildSearchQuery(filters, { mode: 'broad' }) ||
    String(filters.part_family ?? filters.equipment ?? filters.category ?? filters.query ?? '') ||
    null

  const categoryOnlyFilter =
    categoryIds.length === 1
      ? { category_id: { eq: categoryIds[0] } }
      : categoryIds.length > 1
        ? { category_id: { in: categoryIds } }
        : {}

  const attempts: Array<{ search: string | null; filter: Record<string, unknown> }> = []

  // 1) Broad keywords + category (no price) — related items slightly outside budget still OK
  if (hasCategoryFilter || broadSearch) {
    attempts.push({
      search: broadSearch,
      filter: hasCategoryFilter ? categoryOnlyFilter : {},
    })
  }

  // 2) Category browse only (different SKUs in same aisle)
  if (hasCategoryFilter) {
    attempts.push({ search: null, filter: categoryOnlyFilter })
  }

  // 3) Broad keywords, no category filter
  if (broadSearch) {
    attempts.push({ search: broadSearch, filter: {} })
  }

  const seen = new Set(excludeIds)
  const collected: MagentoProductsResponse['products']['items'] = []

  for (const attempt of attempts) {
    if (collected.length >= MAX_ALTERNATIVES) {
      break
    }
    const rec = await runProductsQuery(attempt.search, attempt.filter)
    for (const item of excludeItems(rec.items, seen)) {
      const key = productKey(item)
      if (!key || seen.has(key)) {
        continue
      }
      seen.add(key)
      collected.push(item)
      if (collected.length >= MAX_ALTERNATIVES) {
        break
      }
    }
  }

  return collected
}

/**
 * True when Magento item SKU or name clearly matches the customer text.
 * Used to skip clarifying questions for direct product lookups.
 */
export function isSkuOrNameMatch(
  query: string,
  item: { sku?: string; name?: string },
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false

  const sku = String(item.sku ?? '')
    .trim()
    .toLowerCase()
  const name = String(item.name ?? '')
    .trim()
    .toLowerCase()

  const intentLike =
    /\b(i\s+need|i'?m\s+looking|looking\s+for|gift\s+for|help\s+me|can\s+you|my\s+\w+\s+is|making\s+a|replacement)\b/i.test(
      q,
    ) || q.split(/\s+/).length >= 7

  // Exact SKU always wins
  if (sku && sku === q) return true

  // Compact SKU-like query (no spaces) vs SKU
  if (sku && !/\s/.test(q) && (sku.includes(q) || q.includes(sku))) {
    return true
  }

  if (!name) return false

  // Exact product name
  if (name === q) return true

  // Intent / problem sentences must not short-circuit on loose name hits
  if (intentLike) return false

  // Query is a clear product name / phrase contained in catalog name (or vice versa)
  if (q.length >= 3 && name.includes(q)) return true
  if (name.length >= 4 && q.includes(name) && q.split(/\s+/).length <= 5) {
    return true
  }

  const qTokens = q.split(/\s+/).filter((t) => t.length > 2)
  const nameTokens = name.split(/\s+/).filter((t) => t.length > 2)
  if (qTokens.length >= 2 && nameTokens.length > 0) {
    const hit = qTokens.filter((t) =>
      nameTokens.some((n) => n === t || n.includes(t) || t.includes(n)),
    )
    if (hit.length / qTokens.length >= 0.8) return true
  }

  return false
}

/**
 * Probe Magento for a direct SKU / product-name hit.
 * Returns null when nothing matches closely — caller should ask clarifying questions.
 */
export async function findDirectSkuOrNameMatch(query: string): Promise<{
  products: CatalogProduct[]
  alternatives: CatalogProduct[]
  totalCount: number
  matchedCategories: Array<{ id: string; name: string; path: string }>
  matchType: 'exact' | 'mixed'
} | null> {
  const trimmed = query.trim()
  if (!trimmed) return null

  const filters: ProductFilters = { query: trimmed }
  const seen = new Set<string>()
  const matched: MagentoProductsResponse['products']['items'] = []

  // 1) Exact SKU filter (best for codes like 24-MB01)
  try {
    const bySku = await runProductsQuery(null, { sku: { eq: trimmed } })
    for (const item of bySku.items) {
      if (!isSkuOrNameMatch(trimmed, item)) continue
      const key = productKey(item)
      if (!key || seen.has(key)) continue
      seen.add(key)
      matched.push(item)
    }
  } catch {
    // Some Magento schemas reject sku filter — fall through to search
  }

  // 2) Keyword search — keep only strong SKU/name matches
  if (matched.length === 0) {
    const bySearch = await runProductsQuery(trimmed, {})
    for (const item of bySearch.items) {
      if (!isSkuOrNameMatch(trimmed, item)) continue
      const key = productKey(item)
      if (!key || seen.has(key)) continue
      seen.add(key)
      matched.push(item)
    }
  }

  if (matched.length === 0) return null

  const products = matched.map((item) => mapMagentoProduct(item, filters, []))
  const excludeIds = new Set(matched.map((item) => productKey(item)).filter(Boolean))
  const altItems = await fetchBroadAlternatives(filters, [], false, excludeIds)
  const alternatives = altItems.map((item) =>
    mapMagentoProduct(item, filters, []),
  )

  return {
    products,
    alternatives,
    totalCount: products.length,
    matchedCategories: [],
    matchType: alternatives.length > 0 ? 'mixed' : 'exact',
  }
}

export async function searchMagentoProducts(
  filters: ProductFilters,
): Promise<{
  products: CatalogProduct[]
  alternatives: CatalogProduct[]
  totalCount: number
  matchedCategories: Array<{ id: string; name: string; path: string }>
  matchType: 'exact' | 'recommended' | 'mixed' | 'none'
}> {
  const rawQuery = String(filters.query ?? filters.category ?? '')
  const categoryMatch = await matchCategoriesFromSearch(filters, rawQuery)
  const categoryIds = categoryMatch.categoryIds
  const matchedPaths = categoryMatch.matched.map((m) => m.path)
  const hasCategoryFilter = categoryIds.length > 0
  const matchedCategories = categoryMatch.matched.map(({ id, name, path }) => ({
    id,
    name,
    path,
  }))

  const preciseSearch =
    buildSearchQuery(filters, {
      hasCategoryFilter,
      mode: 'precise',
    }) || null

  const filter = buildProductFilter(filters, categoryIds)

  // 1) Precise search
  let { items, totalCount } = await runProductsQuery(
    preciseSearch,
    filter,
  )

  // 2) Category-only if precise returned nothing
  if (items.length === 0 && hasCategoryFilter) {
    const retry = await runProductsQuery(null, filter)
    items = retry.items
    totalCount = retry.totalCount
  }

  // 3) Keyword-only from problem text
  if (items.length === 0) {
    const keywordSearch =
      buildSearchQuery(filters, { mode: 'precise' }) ||
      String(filters.query ?? '') ||
      null
    if (keywordSearch) {
      const retry = await runProductsQuery(
        keywordSearch,
        buildProductFilter(filters, []),
      )
      items = retry.items
      totalCount = retry.totalCount
    }
  }

  if (items.length > 0) {
    const products = items.map((item) =>
      mapMagentoProduct(item, filters, matchedPaths),
    )
    const excludeIds = new Set(items.map((item) => productKey(item)).filter(Boolean))
    const altItems = await fetchBroadAlternatives(
      filters,
      categoryIds,
      hasCategoryFilter,
      excludeIds,
    )
    const alternatives = altItems.map((item) =>
      mapMagentoProduct(item, filters, matchedPaths),
    )

    return {
      totalCount,
      matchType: alternatives.length > 0 ? 'mixed' : 'exact',
      matchedCategories,
      products,
      alternatives,
    }
  }

  // 4) No exact match — alternatives only (broader search)
  const altItems = await fetchBroadAlternatives(
    filters,
    categoryIds,
    hasCategoryFilter,
    new Set(),
  )

  if (altItems.length > 0) {
    return {
      totalCount: altItems.length,
      matchType: 'recommended',
      matchedCategories,
      products: [],
      alternatives: altItems.map((item) =>
        mapMagentoProduct(item, filters, matchedPaths),
      ),
    }
  }

  return {
    totalCount: 0,
    matchType: 'none',
    matchedCategories,
    products: [],
    alternatives: [],
  }
}
