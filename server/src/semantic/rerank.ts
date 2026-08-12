import type { ProductFilters } from '../ai/engine.js'
import type { CatalogProduct } from '../magento/types.js'

export interface RankedProduct extends CatalogProduct {
  /** Internal score used for sorting; stripped before API response. */
  _score: number
  _fromMagento: boolean
  _fromSemantic: boolean
  _semanticScore: number
  _magentoRank: number
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2),
  )
}

/**
 * Score a product for hybrid ranking.
 * Higher is better. Magento exact hits stay preferred; semantic similarity
 * and stock/budget fit break ties and lift meaning-based matches.
 */
export function scoreProduct(
  product: CatalogProduct,
  filters: ProductFilters,
  meta: {
    fromMagento: boolean
    fromSemantic: boolean
    semanticScore: number
    magentoRank: number
  },
): number {
  let score = 0

  if (meta.fromMagento) {
    // Earlier Magento position = stronger keyword/filter relevance
    score += Math.max(0, 40 - meta.magentoRank * 1.5)
    score += 12
  }

  if (meta.fromSemantic) {
    score += meta.semanticScore * 45
  }

  // Appearing in both channels is a strong signal
  if (meta.fromMagento && meta.fromSemantic) {
    score += 8 + meta.semanticScore * 10
  }

  if (product.inStock) score += 6
  else score -= 8

  const priceMax = asNumber(filters.price_max)
  const priceMin = asNumber(filters.price_min)
  if (priceMax != null && product.price > 0 && product.price <= priceMax) {
    score += 5
  } else if (priceMax != null && product.price > priceMax) {
    score -= 10
  }
  if (priceMin != null && product.price >= priceMin) {
    score += 2
  }

  const query = asString(filters.query)?.toLowerCase() ?? ''
  const name = product.name.toLowerCase()
  const sku = product.sku.toLowerCase()
  if (query && (sku === query || name === query)) {
    score += 50
  } else if (query && !/\s/.test(query) && (sku.includes(query) || query.includes(sku))) {
    score += 35
  }

  const hintTokens = tokenSet(
    [
      asString(filters.color),
      asString(filters.material),
      asString(filters.size),
      asString(filters.brand),
      asString(filters.part_type),
      asString(filters.category),
      asString(filters.usage),
    ]
      .filter(Boolean)
      .join(' '),
  )
  if (hintTokens.size > 0) {
    const nameTokens = tokenSet(product.name)
    let hits = 0
    for (const t of hintTokens) {
      if (nameTokens.has(t) || name.includes(t)) hits += 1
    }
    score += hits * 3
  }

  return score
}

export function mergeAndRerank(input: {
  magentoProducts: CatalogProduct[]
  magentoAlternatives: CatalogProduct[]
  semanticProducts: CatalogProduct[]
  semanticScores: Map<string, number>
  filters: ProductFilters
  primaryLimit?: number
  alternativeLimit?: number
}): {
  products: CatalogProduct[]
  alternatives: CatalogProduct[]
  source: 'magento' | 'semantic' | 'hybrid'
} {
  const primaryLimit = input.primaryLimit ?? 12
  const alternativeLimit = input.alternativeLimit ?? 12

  const bySku = new Map<string, RankedProduct>()

  const upsert = (
    product: CatalogProduct,
    meta: {
      fromMagento: boolean
      fromSemantic: boolean
      magentoRank: number
    },
  ) => {
    const sku = product.sku
    const existing = bySku.get(sku)
    const semanticScore = input.semanticScores.get(sku) ?? 0
    const fromMagento = Boolean(existing?._fromMagento || meta.fromMagento)
    const fromSemantic = Boolean(existing?._fromSemantic || meta.fromSemantic)
    const magentoRank =
      existing && existing._fromMagento
        ? existing._magentoRank
        : meta.fromMagento
          ? meta.magentoRank
          : 99

    const merged: CatalogProduct = existing
      ? {
          ...existing,
          ...product,
          reasons: [
            ...new Set([...(product.reasons ?? []), ...(existing.reasons ?? [])]),
          ].slice(0, 4),
          // Prefer live Magento fields when present
          imageUrl: product.imageUrl || existing.imageUrl,
          productUrl:
            product.productUrl && product.productUrl !== '#'
              ? product.productUrl
              : existing.productUrl,
          price: product.price || existing.price,
        }
      : product

    const scored: RankedProduct = {
      ...merged,
      _fromMagento: fromMagento,
      _fromSemantic: fromSemantic,
      _semanticScore: Math.max(existing?._semanticScore ?? 0, semanticScore),
      _magentoRank: magentoRank,
      _score: 0,
    }
    scored._score = scoreProduct(scored, input.filters, {
      fromMagento: scored._fromMagento,
      fromSemantic: scored._fromSemantic,
      semanticScore: scored._semanticScore,
      magentoRank: scored._magentoRank,
    })
    bySku.set(sku, scored)
  }

  input.magentoProducts.forEach((p, i) =>
    upsert(p, { fromMagento: true, fromSemantic: false, magentoRank: i }),
  )
  input.magentoAlternatives.forEach((p, i) =>
    upsert(p, {
      fromMagento: true,
      fromSemantic: false,
      magentoRank: input.magentoProducts.length + i,
    }),
  )
  input.semanticProducts.forEach((p) =>
    upsert(p, { fromMagento: false, fromSemantic: true, magentoRank: 99 }),
  )

  const ranked = [...bySku.values()].sort((a, b) => b._score - a._score)

  /**
   * Hybrid/mixed: semantic % first, then Magento reasons.
   * Magento-only (no semantic score): Magento reasons only.
   */
  const strip = (p: RankedProduct): CatalogProduct => {
    const {
      _score: _s,
      _fromMagento: _m,
      _fromSemantic: _sem,
      _semanticScore: _ss,
      _magentoRank: _r,
      ...card
    } = p

    const rawReasons = Array.isArray(card.reasons) ? card.reasons : []
    const semanticReasons = rawReasons.filter((r) =>
      /^Semantic match/i.test(r),
    )
    const magentoReasons = rawReasons.filter(
      (r) => !/^Semantic match/i.test(r),
    )

    if (p._fromSemantic && p._semanticScore > 0) {
      const pct = Math.round(p._semanticScore * 100)
      const semanticLine = semanticReasons[0] ?? `Semantic match ~${pct}%`
      card.reasons = [semanticLine, ...magentoReasons].slice(0, 4)
    } else {
      // Magento-only hits must not keep a stale semantic percentage.
      card.reasons = (
        magentoReasons.length > 0 ? magentoReasons : rawReasons
      ).slice(0, 4)
    }

    return card
  }

  const products = ranked.slice(0, primaryLimit).map(strip)
  const primarySkus = new Set(products.map((p) => p.sku))
  const alternatives = ranked
    .filter((p) => !primarySkus.has(p.sku))
    .slice(0, alternativeLimit)
    .map(strip)

  const anyMagento = ranked.some((p) => p._fromMagento)
  const anySemantic = ranked.some((p) => p._fromSemantic)
  const source: 'magento' | 'semantic' | 'hybrid' =
    anyMagento && anySemantic
      ? 'hybrid'
      : anySemantic
        ? 'semantic'
        : 'magento'

  return { products, alternatives, source }
}
