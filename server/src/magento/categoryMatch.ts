import type { ProductFilters } from '../ai/engine.js'
import {
  expandToProductCategories,
  getMagentoCategories,
  type FlatCategory,
} from './categoryTree.js'

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'for',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'with',
  'my',
  'me',
  'i',
  'im',
  'i\'m',
  'need',
  'want',
  'looking',
  'find',
  'show',
  'get',
  'please',
  'some',
  'any',
  'perfect',
  'comfortable',
  'am',
])

/** Broad words that mean "browse this department", not a leaf name. */
const BROAD_APPAREL = new Set([
  'clothing',
  'clothes',
  'apparel',
  'outfit',
  'outfits',
  'wear',
])

const GIFT_WORDS = new Set([
  'gift',
  'gifts',
  'present',
  'presents',
  'birthday',
  'anniversary',
])

const INDUSTRIAL_WORDS = new Set([
  'motor',
  'shaft',
  'bearing',
  'grinding',
  'industrial',
  'hydraulic',
  'pneumatic',
  'coupling',
  'gearbox',
  'seal',
  'gasket',
  'collar',
  'clamp',
  'servo',
  'stepper',
  'nema',
  'replacement',
  'component',
  'machine',
  'mechanical',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9&\s'-]/g, ' ')
    .split(/[\s'-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
}

function normalizeToken(token: string): string[] {
  const variants = new Set<string>([token])
  if (token.endsWith('s') && token.length > 3) variants.add(token.slice(0, -1))

  // Recipient / gender synonyms → Magento department tokens
  if (
    ['men', 'mens', "men's", 'male', 'husband', 'boyfriend', 'dad', 'father', 'son', 'brother', 'him', 'his'].includes(
      token,
    )
  ) {
    variants.add('men')
    variants.add('mens')
  }
  if (
    [
      'women',
      'womens',
      "women's",
      'woman',
      'female',
      'wife',
      'girlfriend',
      'mom',
      'mother',
      'daughter',
      'sister',
      'her',
      'hers',
      'ladies',
    ].includes(token)
  ) {
    variants.add('women')
    variants.add('womens')
    variants.add('woman')
  }

  if (token === 'pant') variants.add('pants')
  if (token === 'pants') variants.add('pant')
  if (token === 'shoe') variants.add('shoes')
  if (token === 'shoes') variants.add('shoe')
  if (token === 'bag') variants.add('bags')
  if (token === 'bags') variants.add('bag')
  if (token === 'watch') variants.add('watches')
  if (token === 'watches') variants.add('watch')
  if (token === 'jacket') variants.add('jackets')
  if (token === 'jackets') variants.add('jacket')
  return [...variants]
}

function buildSearchTokens(
  filters: ProductFilters,
  rawQuery?: string,
): string[] {
  const chunks = [
    rawQuery,
    filters.query,
    filters.category,
    filters.gender,
    filters.usage,
    filters.fit,
    filters.color,
    filters.brand,
    filters.recipient,
  ]
    .filter((v) => v != null && String(v).trim() !== '')
    .map(String)

  const tokens = new Set<string>()
  for (const chunk of chunks) {
    for (const t of tokenize(chunk)) {
      for (const v of normalizeToken(t)) tokens.add(v)
    }
  }

  // Explicit gender filter always contributes department token
  if (filters.gender === 'men') {
    tokens.add('men')
    tokens.add('mens')
  }
  if (filters.gender === 'women') {
    tokens.add('women')
    tokens.add('womens')
  }

  return [...tokens]
}

function hasProductTypeToken(tokens: string[]): boolean {
  const productish = tokens.filter(
    (t) =>
      !GIFT_WORDS.has(t) &&
      t !== 'men' &&
      t !== 'mens' &&
      t !== 'women' &&
      t !== 'womens' &&
      t !== 'woman' &&
      !BROAD_APPAREL.has(t),
  )
  return productish.length > 0
}

function scoreCategory(cat: FlatCategory, tokens: string[]): number {
  if (tokens.length === 0) return 0

  let score = 0
  const pathText = cat.pathLower.join(' ')
  const genderTokens = tokens.filter((t) =>
    ['men', 'mens', 'women', 'womens', 'woman'].includes(t),
  )
  const industrialTokens = tokens.filter((t) => INDUSTRIAL_WORDS.has(t))
  const otherTokens = tokens.filter(
    (t) =>
      !['men', 'mens', 'women', 'womens', 'woman'].includes(t) &&
      !GIFT_WORDS.has(t),
  )

  // Industrial queries prefer Industrial Products / related categories
  if (industrialTokens.length > 0) {
    if (
      cat.nameLower.includes('industrial') ||
      pathText.includes('industrial')
    ) {
      score += 15
    }
    // Avoid dumping apparel for industrial problems
    if (
      pathText.includes('men') ||
      pathText.includes('women') ||
      cat.nameLower === 'tees' ||
      cat.nameLower === 'bras & tanks'
    ) {
      return 0
    }
  }

  // Hard gender constraint: men's gifts must stay under Men (or gender-neutral Gear)
  if (genderTokens.includes('men') || genderTokens.includes('mens')) {
    const underMen = pathText.includes('men')
    const underWomen = pathText.includes('women')
    const gearNeutral =
      pathText.includes('gear') ||
      cat.nameLower === 'bags' ||
      cat.nameLower === 'watches' ||
      cat.nameLower === 'fitness equipment'
    if (underWomen) return 0
    if (!underMen && !gearNeutral) return 0
    if (underMen) score += 8
    if (gearNeutral) score += 5
  }

  if (
    genderTokens.includes('women') ||
    genderTokens.includes('womens') ||
    genderTokens.includes('woman')
  ) {
    const underWomen = pathText.includes('women')
    const underMen = /\bmen\b/.test(pathText) && !pathText.includes('women')
    const gearNeutral =
      pathText.includes('gear') ||
      cat.nameLower === 'bags' ||
      cat.nameLower === 'watches'
    if (underMen) return 0
    if (!underWomen && !gearNeutral) return 0
    if (underWomen) score += 8
    if (gearNeutral) score += 5
  }

  for (const token of otherTokens) {
    if (BROAD_APPAREL.has(token)) {
      if (cat.nameLower === 'men' || cat.nameLower === 'women') score += 4
      else if (cat.hasChildren) score += 2
      continue
    }

    if (INDUSTRIAL_WORDS.has(token)) {
      if (
        cat.nameLower.includes(token) ||
        pathText.includes(token) ||
        cat.nameLower.includes('industrial')
      ) {
        score += 10
      }
      continue
    }

    if (cat.nameLower === token) score += 12
    else if (cat.nameLower.includes(token)) score += 7
    else if (pathText.includes(token)) score += 5
  }

  // Only boost categories that already matched tokens
  if (score > 0 && cat.productCount > 0) score += 2
  if (score > 0 && cat.hasChildren && cat.productCount === 0) score += 1

  return score
}

export interface CategoryMatchResult {
  categoryIds: string[]
  matched: Array<{ id: string; name: string; path: string; score: number }>
}

/**
 * Resolve Magento category IDs dynamically from the customer search / filters.
 */
export async function matchCategoriesFromSearch(
  filters: ProductFilters,
  rawQuery?: string,
): Promise<CategoryMatchResult> {
  const all = await getMagentoCategories()
  const tokens = buildSearchTokens(filters, rawQuery)

  // Gift with recipient but no product type → don't guess random apparel
  const isGift =
    filters.occasion === 'gift' ||
    tokens.some((t) => GIFT_WORDS.has(t))
  if (isGift && !hasProductTypeToken(tokens) && !filters.category) {
    return { categoryIds: [], matched: [] }
  }

  if (tokens.length === 0) {
    return { categoryIds: [], matched: [] }
  }

  const scored = all
    .map((cat) => ({ cat, score: scoreCategory(cat, tokens) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    return { categoryIds: [], matched: [] }
  }

  const topScore = scored[0].score
  const candidates = scored
    .filter((row) => row.score >= Math.max(topScore - 4, topScore * 0.6))
    .map((row) => row.cat)

  const expanded = expandToProductCategories(candidates, all)
  const limited = expanded.slice(0, 8)

  return {
    categoryIds: limited.map((c) => c.id),
    matched: limited.map((c) => {
      const score = scored.find((s) => s.cat.id === c.id)?.score ?? 0
      return {
        id: c.id,
        name: c.name,
        path: c.path.join(' > '),
        score,
      }
    }),
  }
}

/**
 * Build gift-type options from Magento categories for a recipient gender.
 */
export async function getGiftCategoryOptions(
  gender?: string,
): Promise<string[]> {
  const all = await getMagentoCategories()
  const genderKey = String(gender ?? '').toLowerCase()

  const preferredNames = [
    'Watches',
    'Bags',
    'Hoodies & Sweatshirts',
    'Jackets',
    'Fitness Equipment',
    'Tees',
    'Pants',
  ]

  const scored: Array<{ name: string; score: number }> = []

  for (const cat of all) {
    if (cat.productCount <= 0) continue
    const path = cat.pathLower.join(' ')

    if (genderKey === 'men' || genderKey === 'male') {
      const ok =
        path.includes('men') ||
        cat.nameLower === 'bags' ||
        cat.nameLower === 'watches' ||
        cat.nameLower === 'fitness equipment'
      if (!ok) continue
      if (path.includes('women')) continue
    }
    if (genderKey === 'women' || genderKey === 'female') {
      const ok =
        path.includes('women') ||
        cat.nameLower === 'bags' ||
        cat.nameLower === 'watches'
      if (!ok) continue
      if (/\bmen\b/.test(path) && !path.includes('women')) continue
    }

    const pref = preferredNames.findIndex(
      (n) => n.toLowerCase() === cat.nameLower,
    )
    scored.push({
      name: cat.name,
      score: pref === -1 ? 0 : 20 - pref,
    })
  }

  const unique = new Map<string, number>()
  for (const row of scored) {
    unique.set(row.name, Math.max(unique.get(row.name) ?? 0, row.score))
  }

  return [...unique.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, 5)
}
