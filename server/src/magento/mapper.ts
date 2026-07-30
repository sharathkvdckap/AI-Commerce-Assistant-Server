import type { ProductFilters } from '../ai/engine.js'
import { config } from '../config/env.js'
import type { CatalogProduct, MagentoProductItem } from './types.js'

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/**
 * Keyword search text built from original query + collected filter answers.
 */
export function buildSearchQuery(
  filters: ProductFilters,
  options?: { hasCategoryFilter?: boolean; mode?: 'precise' | 'broad' },
): string {
  const mode = options?.mode ?? 'precise'

  const technical = [
    asString(filters.part_type),
    asString(filters.part_family),
    asString(filters.motor_type),
    asString(filters.equipment),
    asString(filters.symptom),
    asString(filters.latest_answer),
    asString(filters.brand),
    asString(filters.material),
    asString(filters.size),
  ].filter(Boolean)

  const lifestyle = [
    asString(filters.category),
    asString(filters.usage),
    asString(filters.style),
    asString(filters.fit),
    asString(filters.color) !== 'any' ? asString(filters.color) : undefined,
    asString(filters.gender),
  ].filter(Boolean)

  if (mode === 'broad') {
    // Broader recommendation search — keep core nouns from query + part family
    const q = asString(filters.query) ?? ''
    const nouns = q
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 3 &&
          !['looking', 'need', 'right', 'making', 'grinding', 'noise', 'replacement'].includes(
            w,
          ),
      )
    return [...new Set([...nouns.slice(0, 4), ...technical.map(String)])]
      .join(' ')
      .trim()
  }

  if (options?.hasCategoryFilter) {
    const refinements = [...technical, ...lifestyle]
    // Prefer technical answers over full long query when category-scoped
    if (refinements.length > 0) {
      return [...new Set(refinements.map((p) => String(p).toLowerCase()))]
        .join(' ')
        .trim()
    }
  }

  // Extract useful keywords from the original problem statement
  const query = asString(filters.query) ?? ''
  const queryKeywords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(
      (w) =>
        w.length > 2 &&
        ![
          'the',
          'and',
          'for',
          'my',
          'is',
          'a',
          'an',
          'to',
          'of',
          'i',
          'need',
          'looking',
          'want',
          'please',
          'right',
          'with',
        ].includes(w),
    )

  const parts = [
    ...queryKeywords.slice(0, 8),
    ...technical,
    ...lifestyle,
  ].filter(Boolean)

  return [...new Set(parts.map((p) => String(p).toLowerCase()))].join(' ').trim()
}

export function buildProductFilter(
  filters: ProductFilters,
  categoryIds: string[] = [],
): Record<string, unknown> {
  const filter: Record<string, unknown> = {}

  const priceMin = asNumber(filters.price_min)
  const priceMax = asNumber(filters.price_max)
  if (priceMin != null || priceMax != null) {
    const price: Record<string, string> = {}
    if (priceMin != null) price.from = String(priceMin)
    if (priceMax != null) price.to = String(priceMax)
    filter.price = price
  }

  if (categoryIds.length === 1) {
    filter.category_id = { eq: categoryIds[0] }
  } else if (categoryIds.length > 1) {
    filter.category_id = { in: categoryIds }
  }

  return filter
}

export function buildWhyRecommended(
  filters: ProductFilters,
  matchedCategoryPaths: string[] = [],
): string[] {
  const reasons: string[] = []
  const category = asString(filters.category)
  const gender = asString(filters.gender)
  const usage = asString(filters.usage)
  const fit = asString(filters.fit)
  const color = asString(filters.color)
  const brand = asString(filters.brand)
  const priceMax = asNumber(filters.price_max)
  const priceMin = asNumber(filters.price_min)

  if (matchedCategoryPaths.length > 0) {
    reasons.push(`Magento category: ${matchedCategoryPaths[0]}`)
  } else if (gender && category) {
    reasons.push(`From ${gender}'s ${category}`)
  } else if (category) {
    reasons.push(`Matches: ${category}`)
  }

  if (usage) reasons.push(`Suited for ${usage}`)
  if (fit) reasons.push(`${fit} fit preference`)
  if (color) reasons.push(`Color preference: ${color}`)
  if (brand) reasons.push(`Brand preference: ${brand}`)
  if (priceMax != null && priceMin != null) {
    reasons.push(`Within $${priceMin}–$${priceMax}`)
  } else if (priceMax != null) {
    reasons.push(`Under $${priceMax}`)
  } else if (priceMin != null) {
    reasons.push(`Above $${priceMin}`)
  }

  if (reasons.length === 0) {
    reasons.push('Matched your Magento catalog search')
  }

  return reasons.slice(0, 4)
}

function absoluteUrl(url: string | null | undefined): string {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  const base = config.magento.url || 'http://localhost'
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`
}

function productUrl(urlKey: string | null | undefined, sku: string): string {
  const base = config.magento.url || ''
  if (!base) return '#'
  if (urlKey) return `${base}/${urlKey}.html`
  return `${base}/catalogsearch/result/?q=${encodeURIComponent(sku)}`
}

export function mapMagentoProduct(
  item: MagentoProductItem,
  filters: ProductFilters,
  matchedCategoryPaths: string[] = [],
): CatalogProduct {
  const priceNode =
    item.price_range?.minimum_price?.final_price ??
    item.price_range?.minimum_price?.regular_price

  const image = item.small_image?.url || item.image?.url || ''

  return {
    id: String(item.id ?? item.uid ?? item.sku),
    sku: item.sku,
    name: item.name.trim(),
    price: priceNode?.value ?? 0,
    currency: priceNode?.currency ?? 'USD',
    imageUrl: absoluteUrl(image),
    productUrl: productUrl(item.url_key, item.sku),
    reasons: buildWhyRecommended(filters, matchedCategoryPaths),
    inStock: (item.stock_status ?? 'IN_STOCK') === 'IN_STOCK',
  }
}
