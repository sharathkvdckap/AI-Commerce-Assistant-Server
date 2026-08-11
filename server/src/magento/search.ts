import type { ProductFilters } from '../ai/engine.js'
import { config } from '../config/env.js'
import { resolveMagentoAttributeFilters } from './attributes.js'
import { magentoGraphql } from './client.js'
import { matchCategoriesFromSearch } from './categoryMatch.js'
import {
  buildProductFilter,
  buildSearchQuery,
  mapMagentoProduct,
} from './mapper.js'
import { extractPriceBounds, filterProductsByBudget } from './priceFilter.js'
import { refinePrimaryAndAlternatives } from './intentFilter.js'
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

/** Catalog crawl for embedding sync — includes description text. */
const CATALOG_SYNC_QUERY = `
  query CatalogSync(
    $search: String
    $pageSize: Int!
    $currentPage: Int!
  ) {
    products(
      search: $search
      filter: {}
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
        short_description { html }
        description { html }
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

export interface MagentoCatalogSyncItem extends MagentoProductItem {
  short_description?: { html?: string | null } | null
  description?: { html?: string | null } | null
}

interface MagentoCatalogSyncResponse {
  products: {
    total_count: number
    items: MagentoCatalogSyncItem[]
  }
}

/**
 * Page through the Magento catalog for embedding sync.
 * Caps at the same safety limit as search (5000 products).
 */
export async function* iterateMagentoCatalogForSync(
  pageSize = BATCH_PAGE_SIZE,
): AsyncGenerator<{
  items: MagentoCatalogSyncItem[]
  page: number
  totalCount: number
}> {
  const batchSize = Math.min(Math.max(pageSize, 1), BATCH_PAGE_SIZE)
  let currentPage = 1
  let totalCount = 0
  let fetched = 0

  while (currentPage <= MAX_FETCH_PAGES) {
    const data = await magentoGraphql<MagentoCatalogSyncResponse>(
      CATALOG_SYNC_QUERY,
      {
        search: null,
        pageSize: batchSize,
        currentPage,
      },
    )
    const items = data.products?.items ?? []
    totalCount = data.products?.total_count ?? fetched + items.length
    fetched += items.length

    yield { items, page: currentPage, totalCount }

    if (items.length === 0 || fetched >= totalCount) {
      break
    }
    currentPage += 1
  }
}

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

  const priceMin = filters.price_min
  const priceMax = filters.price_max
  const priceFilter: Record<string, unknown> = {}
  if (priceMin != null || priceMax != null) {
    const price: Record<string, string> = {}
    if (typeof priceMin === 'number') price.from = String(priceMin)
    else if (typeof priceMin === 'string' && priceMin) price.from = priceMin
    if (typeof priceMax === 'number') price.to = String(priceMax)
    else if (typeof priceMax === 'string' && priceMax) price.to = priceMax
    if (Object.keys(price).length > 0) priceFilter.price = price
  }

  // Prefer budget-respecting alternatives first
  if (hasCategoryFilter || broadSearch) {
    attempts.push({
      search: broadSearch,
      filter: {
        ...(hasCategoryFilter ? categoryOnlyFilter : {}),
        ...priceFilter,
      },
    })
  }

  if (hasCategoryFilter) {
    attempts.push({
      search: null,
      filter: { ...categoryOnlyFilter, ...priceFilter },
    })
  }

  if (broadSearch) {
    attempts.push({
      search: broadSearch,
      filter: { ...priceFilter },
    })
  }

  // Only if no price constraint: allow broader (out-of-budget) related items
  if (Object.keys(priceFilter).length === 0) {
    if (hasCategoryFilter || broadSearch) {
      attempts.push({
        search: broadSearch,
        filter: hasCategoryFilter ? categoryOnlyFilter : {},
      })
    }
    if (hasCategoryFilter) {
      attempts.push({ search: null, filter: categoryOnlyFilter })
    }
    if (broadSearch) {
      attempts.push({ search: broadSearch, filter: {} })
    }
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
  matchedAttributes: Array<{
    code: string
    label: string
    optionIds: string[]
  }>
  matchType: 'exact' | 'recommended' | 'mixed' | 'none'
  /** True when products are category/type matches without the requested attribute (e.g. color). */
  attributeRelaxed?: boolean
}> {
  const rawQuery = String(filters.query ?? filters.category ?? '')
  // Re-apply budget from original query if filters lost price during clarification
  const fromQuery = extractPriceBounds(rawQuery)
  if (filters.price_max == null && fromQuery.price_max != null) {
    filters = { ...filters, price_max: fromQuery.price_max }
  }
  if (filters.price_min == null && fromQuery.price_min != null) {
    filters = { ...filters, price_min: fromQuery.price_min }
  }

  const categoryMatch = await matchCategoriesFromSearch(filters, rawQuery)
  const categoryIds = categoryMatch.categoryIds
  const matchedPaths = categoryMatch.matched.map((m) => m.path)
  const hasCategoryFilter = categoryIds.length > 0
  const matchedCategories = categoryMatch.matched.map(({ id, name, path }) => ({
    id,
    name,
    path,
  }))

  const { filter: attributeFilters, matched: attributeHits } =
    await resolveMagentoAttributeFilters(filters, {
      // Explicit "for men/women" → apply Magento gender attribute too
      skipGenderAttribute: !filters.gender,
    })
  const attributeCodes = Object.keys(attributeFilters)
  const hasAttributeFilters = attributeCodes.length > 0
  const matchedAttributes = attributeHits.map((hit) => ({
    code: hit.code,
    label: hit.matchedLabel,
    optionIds: hit.optionIds,
  }))

  // Enrich "why recommended" with live Magento attribute labels
  const filtersWithAttrHints: ProductFilters = { ...filters }
  for (const hit of attributeHits) {
    if (hit.code === 'color' && !filtersWithAttrHints.color) {
      filtersWithAttrHints.color = hit.matchedLabel
    }
    if (hit.code === 'material' && !filtersWithAttrHints.material) {
      filtersWithAttrHints.material = hit.matchedLabel
    }
    if (hit.code === 'size' && !filtersWithAttrHints.size) {
      filtersWithAttrHints.size = hit.matchedLabel
    }
    if (
      (hit.code === 'activity' || hit.code.startsWith('style_')) &&
      !filtersWithAttrHints.style
    ) {
      filtersWithAttrHints.style = hit.matchedLabel
    }
  }

  const preciseSearch =
    buildSearchQuery(filters, {
      hasCategoryFilter,
      mode: 'precise',
      attributeFiltered: attributeCodes,
    }) || null

  const exactFilter = buildProductFilter(
    filters,
    categoryIds,
    attributeFilters,
  )

  // 1) Exact: category + Magento attribute filters (color, size, …)
  let { items, totalCount } = await runProductsQuery(
    preciseSearch,
    exactFilter,
  )
  let attributeRelaxed = false

  // 2) Category-scoped exact (still with attributes) if keyword+filter empty
  if (items.length === 0 && hasCategoryFilter && hasAttributeFilters) {
    const retry = await runProductsQuery(
      null,
      buildProductFilter(filters, categoryIds, attributeFilters),
    )
    items = retry.items
    totalCount = retry.totalCount
  }

  // 3) Matchable: drop attribute filters (e.g. other colors in same aisle)
  if (items.length === 0 && hasAttributeFilters) {
    const matchableFilter = buildProductFilter(filters, categoryIds, {})
    const matchableSearch =
      buildSearchQuery(filters, {
        hasCategoryFilter,
        mode: 'precise',
        attributeFiltered: [],
      }) || null
    const retry = await runProductsQuery(matchableSearch, matchableFilter)
    if (retry.items.length === 0 && hasCategoryFilter) {
      const categoryOnly = await runProductsQuery(null, matchableFilter)
      items = categoryOnly.items
      totalCount = categoryOnly.totalCount
    } else {
      items = retry.items
      totalCount = retry.totalCount
    }
    if (items.length > 0) {
      attributeRelaxed = true
    }
  }

  // 4) Category-only without attributes (legacy path when no attrs requested)
  if (items.length === 0 && hasCategoryFilter && !hasAttributeFilters) {
    const retry = await runProductsQuery(null, exactFilter)
    items = retry.items
    totalCount = retry.totalCount
  }

  // 5) Keyword-only from problem text
  if (items.length === 0) {
    const keywordSearch =
      buildSearchQuery(filters, {
        mode: 'precise',
        attributeFiltered: attributeCodes,
      }) ||
      String(filters.query ?? '') ||
      null
    if (keywordSearch) {
      const retry = await runProductsQuery(
        keywordSearch,
        buildProductFilter(filters, [], attributeFilters),
      )
      items = retry.items
      totalCount = retry.totalCount
    }
  }

  if (items.length > 0) {
    let products = items.map((item) =>
      mapMagentoProduct(item, filtersWithAttrHints, matchedPaths),
    )
    products = filterProductsByBudget(products, filters)

    const excludeIds = new Set(products.map((p) => p.id).filter(Boolean))
    for (const item of items) {
      const mapped = mapMagentoProduct(item, filtersWithAttrHints, matchedPaths)
      if (!filterProductsByBudget([mapped], filters).length) {
        excludeIds.add(productKey(item))
      }
    }

    const altItems = await fetchBroadAlternatives(
      filters,
      categoryIds,
      hasCategoryFilter,
      excludeIds,
    )
    let alternatives = filterProductsByBudget(
      altItems.map((item) =>
        mapMagentoProduct(item, filtersWithAttrHints, matchedPaths),
      ),
      filters,
    )

    const refined = refinePrimaryAndAlternatives(
      products,
      alternatives,
      filters,
    )
    products = refined.products
    // Intent filter already drops cross-gender / off-category noise.
    alternatives = refined.alternatives

    if (products.length === 0 && alternatives.length === 0) {
      // fall through
    } else if (products.length === 0) {
      return {
        totalCount: alternatives.length,
        matchType: 'recommended',
        matchedCategories,
        matchedAttributes,
        products: [],
        alternatives,
        attributeRelaxed,
      }
    } else {
      return {
        totalCount: products.length,
        matchType: alternatives.length > 0 ? 'mixed' : 'exact',
        matchedCategories,
        matchedAttributes,
        products,
        alternatives,
        attributeRelaxed: false,
      }
    }
  }

  // 6) No exact/matchable — alternatives only (broader search)
  const altItems = await fetchBroadAlternatives(
    filters,
    categoryIds,
    hasCategoryFilter,
    new Set(),
  )

  const alternatives = refinePrimaryAndAlternatives(
    [],
    filterProductsByBudget(
      altItems.map((item) =>
        mapMagentoProduct(item, filtersWithAttrHints, matchedPaths),
      ),
      filters,
    ),
    filters,
  ).alternatives

  if (alternatives.length > 0) {
    return {
      totalCount: alternatives.length,
      matchType: 'recommended',
      matchedCategories,
      matchedAttributes,
      products: [],
      alternatives,
      attributeRelaxed,
    }
  }

  return {
    totalCount: 0,
    matchType: 'none',
    matchedCategories,
    matchedAttributes,
    products: [],
    alternatives: [],
  }
}
