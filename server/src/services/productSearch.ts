import type { ProductFilters } from '../ai/engine.js'
import {
  config,
  isMagentoConfigured,
  isSemanticConfigured,
} from '../config/env.js'
import { MagentoApiError } from '../magento/client.js'
import {
  findDirectSkuOrNameMatch as findMagentoDirectMatch,
  searchMagentoProducts,
} from '../magento/search.js'
import type { CatalogProduct, ProductSource } from '../magento/types.js'
import {
  hydrateSemanticHits,
  mergeAndRerank,
  searchSemanticProducts,
} from '../semantic/index.js'

export interface ProductSearchResult {
  products: CatalogProduct[]
  alternatives: CatalogProduct[]
  source: ProductSource
  totalCount: number
  matchType?: 'exact' | 'recommended' | 'mixed' | 'none'
  matchedCategories?: Array<{ id: string; name: string; path: string }>
  matchedAttributes?: Array<{
    code: string
    label: string
    optionIds: string[]
  }>
  warning?: string
}

function buildWarning(
  source: ProductSource,
  matchType: string | undefined,
  productsLen: number,
  alternativesLen: number,
  attributeRelaxed: boolean | undefined,
  color: string,
): string | undefined {
  if (matchType === 'none' || (productsLen === 0 && alternativesLen === 0)) {
    return 'No products found for your requirements.'
  }
  if (attributeRelaxed) {
    return color && color !== 'any'
      ? `No exact ${color} matches in that category. Showing closely related products and alternatives.`
      : 'No exact attribute match. Showing closely related products and alternatives.'
  }
  if (matchType === 'recommended' || (productsLen === 0 && alternativesLen > 0)) {
    if (source === 'hybrid' || source === 'semantic') {
      return 'No exact Magento keyword match. Showing semantic + related recommendations.'
    }
    return 'No exact match found. Showing related Magento recommendations.'
  }
  return undefined
}

async function enrichWithSemantic(
  filters: ProductFilters,
  magento: Awaited<ReturnType<typeof searchMagentoProducts>>,
): Promise<{
  products: CatalogProduct[]
  alternatives: CatalogProduct[]
  source: ProductSource
  totalCount: number
  matchType: typeof magento.matchType
}> {
  if (!isSemanticConfigured()) {
    return {
      products: magento.products,
      alternatives: magento.alternatives,
      source: 'magento',
      totalCount: magento.totalCount,
      matchType: magento.matchType,
    }
  }

  const weakMagento =
    magento.matchType === 'none' ||
    magento.matchType === 'recommended' ||
    (magento.products.length === 0 && magento.alternatives.length === 0)

  // When Magento is weak, cast a wider semantic net (minScore).
  // When Magento already has hits, only merge high-confidence semantic (fallbackMinScore).
  const minScore = weakMagento
    ? config.semantic.minScore
    : Math.max(config.semantic.minScore, config.semantic.fallbackMinScore)

  let semanticProducts: CatalogProduct[] = []
  const semanticScores = new Map<string, number>()

  try {
    const hits = await searchSemanticProducts(filters, {
      minScore,
      limit: config.semantic.topK,
    })
    for (const hit of hits) {
      semanticScores.set(hit.sku, hit.similarity)
    }
    semanticProducts = await hydrateSemanticHits(hits, filters)
  } catch (error) {
    console.error(
      '[productSearch] semantic enrich failed:',
      error instanceof Error ? error.message : error,
    )
    return {
      products: magento.products,
      alternatives: magento.alternatives,
      source: 'magento',
      totalCount: magento.totalCount,
      matchType: magento.matchType,
    }
  }

  if (semanticProducts.length === 0) {
    return {
      products: magento.products,
      alternatives: magento.alternatives,
      source: 'magento',
      totalCount: magento.totalCount,
      matchType: magento.matchType,
    }
  }

  const merged = mergeAndRerank({
    magentoProducts: magento.products,
    magentoAlternatives: magento.alternatives,
    semanticProducts,
    semanticScores,
    filters,
  })

  let matchType = magento.matchType
  if (merged.products.length > 0) {
    if (magento.matchType === 'none' || magento.matchType === 'recommended') {
      matchType = merged.source === 'semantic' ? 'recommended' : 'mixed'
    } else if (merged.source === 'hybrid') {
      matchType = 'mixed'
    }
  } else if (merged.alternatives.length > 0) {
    matchType = 'recommended'
  } else {
    matchType = 'none'
  }

  return {
    products: merged.products,
    alternatives: merged.alternatives,
    source: merged.source,
    totalCount: Math.max(
      magento.totalCount,
      merged.products.length + merged.alternatives.length,
    ),
    matchType,
  }
}

/**
 * Products always originate from Magento. When SEMANTIC_ENABLED, results are
 * enriched with pgvector recall and re-ranked (hybrid).
 */
export async function searchProducts(
  filters: ProductFilters,
): Promise<ProductSearchResult> {
  if (!isMagentoConfigured()) {
    throw new MagentoApiError(
      'Magento is not configured. Set MAGENTO_URL or MAGENTO_GRAPHQL_URL in server/.env',
      500,
    )
  }

  try {
    const magento = await searchMagentoProducts(filters)
    const enriched = await enrichWithSemantic(filters, magento)

    const color = typeof filters.color === 'string' ? filters.color : ''

    return {
      products: enriched.products,
      alternatives: enriched.alternatives,
      source: enriched.source,
      totalCount: enriched.totalCount,
      matchType: enriched.matchType,
      matchedCategories: magento.matchedCategories,
      matchedAttributes: magento.matchedAttributes,
      warning: buildWarning(
        enriched.source,
        enriched.matchType,
        enriched.products.length,
        enriched.alternatives.length,
        magento.attributeRelaxed,
        color,
      ),
    }
  } catch (error) {
    const message =
      error instanceof MagentoApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unknown Magento error'

    console.error('[productSearch] Magento failed:', message)
    throw error instanceof MagentoApiError
      ? error
      : new MagentoApiError(message)
  }
}

/**
 * Direct SKU / name short-circuit used by the assistant start flow.
 */
export async function findDirectSkuOrNameMatch(query: string) {
  return findMagentoDirectMatch(query)
}
