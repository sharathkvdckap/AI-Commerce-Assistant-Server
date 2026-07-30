import type { ProductFilters } from '../ai/engine.js'
import { isMagentoConfigured } from '../config/env.js'
import { MagentoApiError } from '../magento/client.js'
import { searchMagentoProducts } from '../magento/search.js'
import type { CatalogProduct, ProductSource } from '../magento/types.js'

export interface ProductSearchResult {
  products: CatalogProduct[]
  alternatives: CatalogProduct[]
  source: ProductSource
  totalCount: number
  matchType?: 'exact' | 'recommended' | 'mixed' | 'none'
  matchedCategories?: Array<{ id: string; name: string; path: string }>
  warning?: string
}

/**
 * Products always come from Magento (live catalog / Magento DB via GraphQL).
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
    const { products, alternatives, totalCount, matchedCategories, matchType } =
      await searchMagentoProducts(filters)

    let warning: string | undefined
    if (matchType === 'none' || (products.length === 0 && alternatives.length === 0)) {
      warning = 'No products found for your requirements.'
    } else if (matchType === 'recommended' || (products.length === 0 && alternatives.length > 0)) {
      warning =
        'No exact match found. Showing related Magento recommendations.'
    }

    return {
      products,
      alternatives,
      source: 'magento',
      totalCount,
      matchType,
      matchedCategories,
      warning,
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
