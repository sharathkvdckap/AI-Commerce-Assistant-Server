/**
 * Parse customer budget language into Magento price_min / price_max filters.
 * Covers: below/under/less than, above/over/more than, between, chip answers.
 */

export interface PriceBounds {
  price_min?: number
  price_max?: number
}

function parseAmount(raw: string): number | undefined {
  const n = Number(String(raw).replace(/[,$]/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * Extract price bounds from free text (query, chip answer, or LLM budget field).
 */
export function extractPriceBounds(text: string): PriceBounds {
  const lower = text.toLowerCase().replace(/,/g, '').trim()
  if (!lower) return {}

  const out: PriceBounds = {}

  // Chip / canned answers first
  if (
    /^(under|below)\s*\$?\s*50$/.test(lower) ||
    /^under\s*\$50$/.test(lower)
  ) {
    return { price_max: 50 }
  }
  if (
    /^\$?\s*50\s*[-–to]+\s*\$?\s*100$/.test(lower) ||
    /^\$50\s*[-–]\s*\$?100$/.test(lower)
  ) {
    return { price_min: 50, price_max: 100 }
  }
  if (/^(above|over|more\s+than)\s*\$?\s*100$/.test(lower)) {
    return { price_min: 100 }
  }

  // Between / range: $40-$80, 40 to 80, between 40 and 80
  const between =
    lower.match(
      /(?:between|from)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:and|to|-|–)\s*\$?\s*(\d+(?:\.\d+)?)/,
    ) ||
    lower.match(/\$\s*(\d+(?:\.\d+)?)\s*[-–]\s*\$?\s*(\d+(?:\.\d+)?)/) ||
    lower.match(
      /\b(\d+(?:\.\d+)?)\s*(?:dollars?\s+)?(?:to|-|–)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:dollars?)?\b/,
    )
  if (between) {
    const a = parseAmount(between[1])
    const b = parseAmount(between[2])
    if (a != null && b != null) {
      out.price_min = Math.min(a, b)
      out.price_max = Math.max(a, b)
      return out
    }
  }

  // Max / ceiling: below, under, less than, up to, max, cheaper than, within
  const maxMatch = lower.match(
    /(?:below|under|less\s+than|upto|up\s+to|max(?:imum)?|cheaper\s+than|within|no\s+more\s+than|at\s+most)\s*\$?\s*(\d+(?:\.\d+)?)/,
  )
  if (maxMatch) {
    const n = parseAmount(maxMatch[1])
    if (n != null) out.price_max = n
  }

  // Also: "$50 or less", "50 dollars or less", "< $50", "<=50"
  const orLess = lower.match(
    /\$?\s*(\d+(?:\.\d+)?)\s*(?:dollars?\s+)?(?:or\s+less|or\s+under|max)/,
  )
  if (orLess) {
    const n = parseAmount(orLess[1])
    if (n != null) out.price_max = out.price_max ?? n
  }
  const lt = lower.match(/<\s*=?\s*\$?\s*(\d+(?:\.\d+)?)/)
  if (lt) {
    const n = parseAmount(lt[1])
    if (n != null) out.price_max = out.price_max ?? n
  }

  // Min / floor: above, over, more than, at least, from, minimum, starting at
  const minMatch = lower.match(
    /(?:above|over|more\s+than|at\s+least|from|minimum|starting\s+at|greater\s+than)\s*\$?\s*(\d+(?:\.\d+)?)/,
  )
  if (minMatch) {
    const n = parseAmount(minMatch[1])
    if (n != null) out.price_min = n
  }
  const gt = lower.match(/>\s*=?\s*\$?\s*(\d+(?:\.\d+)?)/)
  if (gt) {
    const n = parseAmount(gt[1])
    if (n != null) out.price_min = out.price_min ?? n
  }

  // "budget of $50" / "budget $50" → treat as max unless "at least" already set
  const budgetOf = lower.match(
    /budget(?:\s+of|\s+is|\s*:)?\s*\$?\s*(\d+(?:\.\d+)?)/,
  )
  if (budgetOf && out.price_max == null && out.price_min == null) {
    const n = parseAmount(budgetOf[1])
    if (n != null) out.price_max = n
  }

  return out
}

/** Keep catalog products inside the customer's stated budget. */
export function productWithinBudget(
  price: number,
  filters: { price_min?: unknown; price_max?: unknown },
): boolean {
  const min =
    typeof filters.price_min === 'number'
      ? filters.price_min
      : typeof filters.price_min === 'string'
        ? Number(filters.price_min)
        : undefined
  const max =
    typeof filters.price_max === 'number'
      ? filters.price_max
      : typeof filters.price_max === 'string'
        ? Number(filters.price_max)
        : undefined

  if (min != null && Number.isFinite(min) && price < min) return false
  if (max != null && Number.isFinite(max) && price > max) return false
  return true
}

export function filterProductsByBudget<T extends { price: number }>(
  products: T[],
  filters: { price_min?: unknown; price_max?: unknown },
): T[] {
  const hasBudget =
    filters.price_min != null ||
    filters.price_max != null
  if (!hasBudget) return products
  return products.filter((p) => productWithinBudget(p.price, filters))
}
