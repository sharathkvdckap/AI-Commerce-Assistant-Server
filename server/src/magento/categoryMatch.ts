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
  'activewear',
  'athleisure',
])

/** Clothing product nouns — when present, prefer apparel aisles over fitness equipment. */
const APPAREL_PRODUCT_WORDS = new Set([
  'suit',
  'suits',
  'tracksuit',
  'tracksuits',
  'pant',
  'pants',
  'trouser',
  'trousers',
  'jogger',
  'joggers',
  'short',
  'shorts',
  'legging',
  'leggings',
  'hoodie',
  'hoodies',
  'sweatshirt',
  'sweatshirts',
  'jacket',
  'jackets',
  'tee',
  'tees',
  'shirt',
  'shirts',
  'tank',
  'tanks',
  'top',
  'tops',
  'bottom',
  'bottoms',
  'dress',
  'dresses',
  'skirt',
  'skirts',
  'shoe',
  'shoes',
  'sneaker',
  'sneakers',
])

const EQUIPMENT_WORDS = new Set([
  'equipment',
  'dumbbell',
  'dumbbells',
  'kettlebell',
  'kettlebells',
  'barbell',
  'barbells',
  'treadmill',
  'bike',
  'cycle',
  'elliptical',
  'machine',
  'strength',
  'weightlifting',
  'powerlifting',
  'cardio',
  'weights',
  'weight',
  'resistance',
  'yoga',
])

/**
 * True when the customer wants fitness / workout *equipment* (not gym clothes).
 * Examples: "strength training", "dumbbells", "home gym equipment".
 */
export function isFitnessEquipmentIntent(text: string): boolean {
  const lower = text.toLowerCase()
  if (isApparelClothingIntent(lower)) return false

  return (
    /\b(strength(\s+training)?|weight\s*lifting|weightlifting|weight\s*training|resistance\s*training|powerlifting|bodybuilding)\b/.test(
      lower,
    ) ||
    /\b(dumbbells?|kettlebells?|barbells?|treadmills?|ellipticals?|rowing\s*machines?|exercise\s*bikes?|spin\s*bikes?)\b/.test(
      lower,
    ) ||
    /\b(fitness|gym|workout|exercise|cardio|training)\s+equipment\b/.test(
      lower,
    ) ||
    /\bequipment\s+for\s+(strength|weight|gym|workout|training|cardio|fitness)\b/.test(
      lower,
    ) ||
    /\b(home\s*gym|gym\s*machine|weight\s*bench|foam\s*roller|resistance\s*bands?|yoga\s*mats?|jump\s*ropes?)\b/.test(
      lower,
    ) ||
    /\b(something|gear|kit|accessories)\s+for\s+(strength|weightlifting|weight\s*training|powerlifting)\b/.test(
      lower,
    ) ||
    /\bfor\s+strength(\s+training)?\b/.test(lower) ||
    (/\bfitness\b/.test(lower) &&
      !/\b(clothes|clothing|wear|outfit|tee|shirt|pant|short|hoodie)\b/.test(
        lower,
      ))
  )
}

/** True when the customer clearly wants wearable apparel (including gym clothes). */
export function isApparelClothingIntent(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    /\b(pants?|trousers?|jackets?|hoodies?|sweatshirts?|shirts?|tees?|shoes?|sneakers?|clothing|clothes|apparel|outfit|outfits|wear|capri|leggings?|shorts?|suits?|tracksuits?|activewear|athleisure|joggers?|tanks?|tops?|bottoms?|dress|dresses|skirt|skirts)\b/.test(
      lower,
    ) ||
    /\b(gym|workout|training|fitness)\s+(clothes|clothing|wear|outfit|suits?|pants?|shorts?|tees?|hoodies?)\b/.test(
      lower,
    ) ||
    /\b(clothes|clothing|wear|outfit|suits?|pants?|shorts?|tees?)\s+(for\s+)?(the\s+)?(gym|workout|training|fitness)\b/.test(
      lower,
    )
  )
}


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

  // Gym suits / tracksuits → Magento apparel leaves (Pants, Hoodies), not equipment
  if (['suit', 'suits', 'tracksuit', 'tracksuits'].includes(token)) {
    variants.add('pants')
    variants.add('pant')
    variants.add('hoodie')
    variants.add('hoodies')
    variants.add('sweatshirt')
    variants.add('clothing')
    variants.add('apparel')
  }

  // Strength / equipment vocabulary → Fitness Equipment aisle
  if (
    [
      'strength',
      'weightlifting',
      'powerlifting',
      'dumbbell',
      'dumbbells',
      'kettlebell',
      'kettlebells',
      'barbell',
      'cardio',
      'weights',
      'equipment',
    ].includes(token)
  ) {
    variants.add('fitness')
    variants.add('equipment')
    variants.add('strength')
  }

  // Gym / workout / training as activity — apparel only when clothing nouns exist
  if (['gym', 'workout', 'training', 'athletic'].includes(token)) {
    variants.add('training')
  }

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
  const apparelTokens = tokens.filter((t) => APPAREL_PRODUCT_WORDS.has(t) || BROAD_APPAREL.has(t))
  const equipmentTokens = tokens.filter((t) => EQUIPMENT_WORDS.has(t))
  const otherTokens = tokens.filter(
    (t) =>
      !['men', 'mens', 'women', 'womens', 'woman'].includes(t) &&
      !GIFT_WORDS.has(t),
  )

  const isFitnessEquipment =
    cat.nameLower.includes('fitness equipment') ||
    (pathText.includes('gear') && cat.nameLower.includes('equipment'))

  // Clothing intent must not land in Fitness Equipment / gear machines
  if (apparelTokens.length > 0 && equipmentTokens.length === 0 && isFitnessEquipment) {
    return 0
  }

  // Strength / equipment vocabulary strongly prefers Fitness Equipment
  if (equipmentTokens.length > 0 && isFitnessEquipment && apparelTokens.length === 0) {
    score += 22
  }
  // Soft-penalize apparel leaves when the query is equipment-only
  if (
    equipmentTokens.length > 0 &&
    apparelTokens.length === 0 &&
    !isFitnessEquipment &&
    (pathText.includes('men') ||
      pathText.includes('women') ||
      ['tees', 'pants', 'shorts', 'hoodies & sweatshirts', 'jackets', 'tanks'].includes(
        cat.nameLower,
      ))
  ) {
    score -= 6
  }

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
    // Apparel clothing + gender → stay in Men/Women apparel, not Gear equipment
    if (apparelTokens.length > 0 && equipmentTokens.length === 0) {
      if (underWomen) return 0
      if (!underMen) return 0
      if (underMen) score += 8
    } else {
      if (underWomen) return 0
      if (!underMen && !gearNeutral) return 0
      if (underMen) score += 8
      if (gearNeutral) score += 5
    }
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
    if (apparelTokens.length > 0 && equipmentTokens.length === 0) {
      if (underMen) return 0
      if (!underWomen) return 0
      if (underWomen) score += 8
    } else {
      if (underMen) return 0
      if (!underWomen && !gearNeutral) return 0
      if (underWomen) score += 8
      if (gearNeutral) score += 5
    }
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

    // Gym/training soft boost:
    // - with clothing nouns → apparel leaves
    // - with equipment / strength intent → Fitness Equipment
    if (['gym', 'workout', 'training', 'athletic'].includes(token)) {
      if (isFitnessEquipment && apparelTokens.length > 0 && equipmentTokens.length === 0) {
        continue
      }
      if (isFitnessEquipment && equipmentTokens.length > 0) {
        score += 18
        continue
      }
      if (
        apparelTokens.length > 0 &&
        (pathText.includes('men') ||
          pathText.includes('women') ||
          ['pants', 'shorts', 'hoodies & sweatshirts', 'tees', 'jackets'].includes(
            cat.nameLower,
          ))
      ) {
        score += 3
      }
      continue
    }

    if (
      ['strength', 'weightlifting', 'powerlifting', 'weights', 'cardio', 'yoga'].includes(
        token,
      )
    ) {
      if (isFitnessEquipment) score += 20
      else if (apparelTokens.length === 0) score -= 4
      continue
    }

    if (cat.nameLower === token) score += 12
    else if (cat.nameLower.includes(token)) score += 7
    else if (pathText.includes(token)) score += 5
  }

  // Apparel product nouns strongly prefer matching Magento apparel leaves
  if (apparelTokens.length > 0 && !isFitnessEquipment) {
    if (
      ['pants', 'shorts', 'hoodies & sweatshirts', 'tees', 'jackets', 'tanks'].some(
        (n) => cat.nameLower === n || cat.nameLower.includes(n),
      )
    ) {
      score += 6
    }
    if (pathText.includes('men') || pathText.includes('women')) {
      score += 2
    }
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
 * Preferred Magento category / style chip names, biased by customer query.
 * Broad clothes → apparel leaves; specific product → related subtypes.
 */
export function preferredApparelCategoryNames(query: string): string[] {
  const lower = query.toLowerCase()

  // Equipment / strength intent → Magento Fitness Equipment first (not clothes)
  if (isFitnessEquipmentIntent(lower)) {
    return [
      'Fitness Equipment',
      'Yoga',
      'Bags',
      'Watches',
      'Tees',
    ]
  }

  if (/\b(watches?|watch)\b/.test(lower)) {
    return ['Analog', 'Digital', 'Smartwatch', 'Sport', 'Luxury / dress']
  }
  if (/\b(bags?|backpack|duffel|tote|messenger|crossbody)\b/.test(lower)) {
    return ['Messenger', 'Backpack', 'Tote', 'Duffel', 'Crossbody']
  }
  if (/\b(hoodie|sweatshirt)s?\b/.test(lower)) {
    return ['Pullover', 'Zip-up', 'Lightweight', 'Fleece']
  }
  if (/\b(jackets?|coat)\b/.test(lower)) {
    return ['Bomber', 'Puffer', 'Rain jacket', 'Denim', 'Softshell']
  }
  if (/\b(pants?|trousers?|joggers?)\b/.test(lower)) {
    return ['Joggers', 'Chinos', 'Track pants', 'Jeans']
  }
  if (/\b(shorts?)\b/.test(lower)) {
    return ['Shorts', 'Pants', 'Tees']
  }
  if (/\b(tees?|t-?shirts?|shirts?)\b/.test(lower)) {
    return ['Tees', 'Hoodies & Sweatshirts', 'Shorts']
  }
  if (/\b(yoga|fitness\s*equipment|dumbbell|kettlebell|mat)\b/.test(lower)) {
    return ['Fitness Equipment', 'Tees', 'Shorts', 'Pants', 'Hoodies & Sweatshirts']
  }
  if (/\b(shoes?|sneakers?|footwear)\b/.test(lower)) {
    return ['Training', 'Running', 'Casual', 'Everyday']
  }
  // Gym *clothes* / apparel browse — clothes first; equipment is optional last
  if (isApparelClothingIntent(lower)) {
    return [
      'Tees',
      'Shorts',
      'Pants',
      'Hoodies & Sweatshirts',
      'Jackets',
      'Fitness Equipment',
    ]
  }
  // Gym/fitness activity without clothing nouns → equipment first
  // (Bare "Training" / "Athletic" chips are apparel usage — do not flip those.)
  if (
    /\b(gym|fitness|workout)\b/.test(lower) &&
    !isApparelClothingIntent(lower) &&
    !/^(training|train|athletic|running|run|casual)$/i.test(lower.trim())
  ) {
    return [
      'Fitness Equipment',
      'Tees',
      'Shorts',
      'Pants',
      'Hoodies & Sweatshirts',
    ]
  }

  // Generic apparel/gear browse — clothes-first, not accessory-heavy
  return [
    'Tees',
    'Pants',
    'Shorts',
    'Hoodies & Sweatshirts',
    'Jackets',
    'Bags',
    'Watches',
  ]
}

/** Style / subtype chips once a Magento category (or clear product type) is known. */
export function styleOptionsForCategory(category: string): string[] | null {
  const c = category.toLowerCase()
  if (/\bwatch/.test(c)) {
    return ['Analog', 'Digital', 'Smartwatch', 'Sport', 'Luxury / dress']
  }
  if (/\bbag/.test(c)) {
    return ['Messenger', 'Backpack', 'Tote', 'Duffel', 'Crossbody']
  }
  if (/\bhoodie|sweatshirt/.test(c)) {
    return ['Pullover', 'Zip-up', 'Lightweight', 'Fleece']
  }
  if (/\bjacket/.test(c)) {
    return ['Bomber', 'Puffer', 'Rain jacket', 'Denim', 'Softshell']
  }
  if (/\bpant|trouser/.test(c)) {
    return ['Joggers', 'Chinos', 'Track pants', 'Jeans']
  }
  if (/\btee|shirt/.test(c)) {
    return ['Crew neck', 'V-neck', 'Tank', 'Long sleeve']
  }
  if (/\bshort/.test(c)) {
    return ['Training shorts', 'Running shorts', 'Casual shorts']
  }
  if (/\bfitness/.test(c)) {
    return ['Yoga', 'Weights', 'Cardio accessories', 'Not sure']
  }
  return null
}

function rankCategoryOptionsByPreference(
  all: FlatCategory[],
  preferredNames: string[],
  gender?: string,
): string[] {
  const genderKey = String(gender ?? '').toLowerCase()
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
        cat.nameLower === 'watches' ||
        cat.nameLower === 'fitness equipment'
      if (!ok) continue
      if (/\bmen\b/.test(path) && !path.includes('women')) continue
    }

    const pref = preferredNames.findIndex(
      (n) => n.toLowerCase() === cat.nameLower,
    )
    if (pref === -1) continue
    scored.push({
      name: cat.name,
      score: preferredNames.length - pref,
    })
  }

  const unique = new Map<string, number>()
  for (const row of scored) {
    unique.set(row.name, Math.max(unique.get(row.name) ?? 0, row.score))
  }

  const ranked = [...unique.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)

  // Always return preferred labels even if Magento tree is empty / mismatched
  if (ranked.length < 2) {
    return preferredNames.slice(0, 5)
  }
  return ranked.slice(0, 5)
}

/**
 * Build gift-type options from Magento categories for a recipient gender.
 */
export async function getGiftCategoryOptions(
  gender?: string,
): Promise<string[]> {
  const all = await getMagentoCategories()
  const preferredNames = [
    'Watches',
    'Bags',
    'Hoodies & Sweatshirts',
    'Jackets',
    'Fitness Equipment',
    'Tees',
    'Pants',
  ]
  return rankCategoryOptionsByPreference(all, preferredNames, gender)
}

/**
 * Build product-type chips for apparel/gear from Magento, biased by the query.
 */
export async function getApparelCategoryOptions(
  query: string,
  gender?: string,
): Promise<string[]> {
  const preferredNames = preferredApparelCategoryNames(query)
  try {
    const all = await getMagentoCategories()
    return rankCategoryOptionsByPreference(all, preferredNames, gender)
  } catch {
    return preferredNames.slice(0, 5)
  }
}
