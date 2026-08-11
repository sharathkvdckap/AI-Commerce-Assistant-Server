import type { ProductFilters } from '../ai/engine.js'
import type { CatalogProduct } from './types.js'
import { isIntentRulesEnabled } from '../config/domainConfig.js'

/**
 * Hard post-filters so PLP only shows products that match stated intent
 * (gender, apparel vs gear, category noun). Complements Magento GraphQL filters.
 */

const WOMEN_SKU = /^(wsh|ws|wb|wt|wj|wp|wd)/i
const MEN_SKU = /^(msh|ms|mb|mt|mj|mp|mh)/i

const WOMEN_NAME =
  /\b(women|woman|womens|ladies|female|girl)\b|^(fiona|maxima|bess|echo|erika|electra|gwen|gwyn|mona|layla|nora|aeon|angel|emma|olivia|julia|diana|deirdre)/i

const MEN_NAME =
  /\b(men|mens|male|man)\b|^(pierce|hawkeye|arcadio|troy|cronus|orion|apollo|zeppelin|logan|chaz|bruno|caesar|marco|mars|tiberius|hector)/i

const GEAR_OR_EQUIPMENT =
  /\b(yoga\s+strap|jump\s*rope|skipping|dumbbell|kettlebell|mat\b|foam\s+roller|resistance\s+band|treadmill|equipment)\b/i

const APPAREL_CATEGORY = new Set([
  'shorts',
  'pants',
  'jackets',
  'tees',
  'hoodies',
  'hoodies & sweatshirts',
  'tanks',
  'bras & tanks',
  'suits',
])

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}

function looksFemale(product: CatalogProduct): boolean {
  if (WOMEN_SKU.test(product.sku)) return true
  if (MEN_SKU.test(product.sku)) return false
  const name = product.name
  if (WOMEN_NAME.test(name)) return true
  if (MEN_NAME.test(name)) return false
  return false
}

function looksMale(product: CatalogProduct): boolean {
  if (MEN_SKU.test(product.sku)) return true
  if (WOMEN_SKU.test(product.sku)) return false
  const name = product.name
  if (MEN_NAME.test(name)) return true
  if (WOMEN_NAME.test(name)) return false
  return false
}

function matchesCategoryNoun(
  product: CatalogProduct,
  category: string | undefined,
): boolean {
  if (!category) return true
  const cat = category.toLowerCase().trim()
  if (!APPAREL_CATEGORY.has(cat) && !APPAREL_CATEGORY.has(cat.replace(/s$/, ''))) {
    return true
  }

  const name = product.name.toLowerCase()
  const sku = product.sku.toLowerCase()

  // Gear / accessories must not appear in apparel category results
  if (GEAR_OR_EQUIPMENT.test(name) || GEAR_OR_EQUIPMENT.test(sku)) {
    return false
  }

  const stem = cat.replace(/s$/, '')
  // Shorts / pants / jackets etc. — name should contain the product type
  if (stem === 'short' || cat === 'shorts') {
    return /\bshorts?\b/.test(name) || /^[mw]sh/i.test(product.sku)
  }
  if (stem === 'pant' || cat === 'pants') {
    return /\b(pants?|trousers?|joggers?)\b/.test(name) || /^[mw]p/i.test(product.sku)
  }
  if (stem === 'jacket' || cat === 'jackets') {
    return /\bjackets?\b/.test(name) || /^[mw]j/i.test(product.sku)
  }
  if (stem === 'tee' || cat === 'tees') {
    return /\b(tee|t-?shirt)\b/.test(name) || /^[mw]s\d/i.test(product.sku)
  }
  if (cat.includes('hoodie') || cat.includes('sweatshirt')) {
    return /\b(hoodie|sweatshirt)\b/.test(name) || /^[mw]h/i.test(product.sku)
  }

  return true
}

/**
 * Keep only products that match gender + category intent from the query.
 */
export function filterProductsByIntent(
  products: CatalogProduct[],
  filters: ProductFilters,
): CatalogProduct[] {
  if (!isIntentRulesEnabled()) return products

  const gender = asString(filters.gender)?.toLowerCase()
  const category = asString(filters.category)

  return products.filter((product) => {
    if (gender === 'men' || gender === 'male') {
      if (looksFemale(product)) return false
      // Prefer clear men's SKUs/names when gender is explicit; allow unknown
      // only if category noun matches and not women's
    }
    if (gender === 'women' || gender === 'female') {
      if (looksMale(product)) return false
    }

    if (!matchesCategoryNoun(product, category)) return false

    // Apparel domain + gender: drop gear even if category unset
    const domain = asString(filters.domain)
    if (
      (domain === 'apparel' || category) &&
      GEAR_OR_EQUIPMENT.test(product.name)
    ) {
      return false
    }

    return true
  })
}

/**
 * When we already have strong exact matches, do not pad with cross-gender
 * or off-category alternatives — return only intent-true products.
 */
export function refinePrimaryAndAlternatives(
  products: CatalogProduct[],
  alternatives: CatalogProduct[],
  filters: ProductFilters,
): { products: CatalogProduct[]; alternatives: CatalogProduct[] } {
  const primary = filterProductsByIntent(products, filters)
  const alts = filterProductsByIntent(alternatives, filters).filter(
    (a) => !primary.some((p) => p.sku === a.sku || p.id === a.id),
  )

  // User wants accuracy: if exact primary hits exist, keep alts only when
  // same gender/category intent (already filtered). Cap noise.
  if (primary.length > 0) {
    return {
      products: primary,
      alternatives: alts.slice(0, 6),
    }
  }

  return {
    products: [],
    alternatives: alts,
  }
}
