import type { ProductFilters } from '../ai/engine.js'
import { magentoGraphql } from './client.js'

interface AttributeOption {
  value: string
  label: string
}

interface AttributeMeta {
  attribute_code: string
  attribute_type?: string | null
  input_type?: string | null
  attribute_options?: AttributeOption[] | null
}

interface FilterableAttribute {
  code: string
  inputType: string
  options: AttributeOption[]
}

interface ResolvedAttributeHit {
  code: string
  optionIds: string[]
  matchedLabel: string
  source: string
}

/** Reserved Magento filter fields — not product EAV option attributes. */
const RESERVED_FILTER_FIELDS = new Set([
  'category_id',
  'category_uid',
  'category_url_path',
  'sku',
  'url_key',
  'name',
  'description',
  'short_description',
  'price',
])

/**
 * Soft ProductFilters keys → preferred Magento attribute codes (in priority order).
 * Unknown Magento attributes are skipped at resolve time.
 */
const FILTER_FIELD_TO_ATTRIBUTES: Record<string, string[]> = {
  color: ['color'],
  size: ['size'],
  material: ['material'],
  gender: ['gender'],
  climate: ['climate'],
  pattern: ['pattern'],
  usage: ['activity'],
  style: ['style_bottom', 'style_general', 'style_bags', 'format'],
  fit: ['style_bottom', 'style_general'],
  activity: ['activity'],
  sleeve: ['sleeve'],
  collar: ['collar'],
  strap: ['strap_bags'],
  features: ['features_bags'],
  category_gear: ['category_gear'],
}

/** Soft label aliases → Magento option labels (lowercase). */
const LABEL_ALIASES: Record<string, string[]> = {
  grey: ['gray'],
  gray: ['grey'],
  navy: ['blue'],
  women: ['woman', 'ladies', 'female'],
  woman: ['women', 'ladies', 'female'],
  men: ['man', 'male', 'mens'],
  man: ['men', 'male', 'mens'],
  training: ['gym', 'crosstraining', 'athletic', 'sports'],
  running: ['run'],
  run: ['running'],
  legging: ['leggings'],
}

/** Boolean Magento attrs — only apply on explicit intent phrases. */
const BOOLEAN_ATTR_PHRASES: Record<string, RegExp> = {
  sale: /\b(on\s+sale|sale|discounted)\b/i,
  new: /\b(new\s+arrivals?|new\s+in|just\s+arrived)\b/i,
  erin_recommends: /\b(erin\s+recommends?|erin'?s?\s+picks?)\b/i,
  eco_collection: /\b(eco|sustainable|organic)\b/i,
  performance_fabric: /\b(performance\s+fabric|performance)\b/i,
}

const INTROSPECTION_QUERY = `
  query ProductFilterFields {
    __type(name: "ProductAttributeFilterInput") {
      inputFields {
        name
        type {
          name
          kind
        }
      }
    }
  }
`

const METADATA_QUERY = `
  query AttributeOptions($attributes: [AttributeInput!]!) {
    customAttributeMetadata(attributes: $attributes) {
      items {
        attribute_code
        attribute_type
        input_type
        attribute_options {
          value
          label
        }
      }
    }
  }
`

let cache: {
  attributes: FilterableAttribute[]
  /** normalized label → attribute option hits */
  labelIndex: Map<string, Array<{ code: string; value: string; label: string }>>
  loadedAt: number
} | null = null

const CACHE_TTL_MS = 10 * 60 * 1000

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function candidateLabels(raw: string): string[] {
  const needle = normalizeLabel(raw)
  if (!needle) return []
  return [...new Set([needle, ...(LABEL_ALIASES[needle] ?? []).map(normalizeLabel)])]
}

async function loadAllFilterableAttributes(): Promise<{
  attributes: FilterableAttribute[]
  labelIndex: Map<string, Array<{ code: string; value: string; label: string }>>
}> {
  const now = Date.now()
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache
  }

  const introspected = await magentoGraphql<{
    __type?: {
      inputFields?: Array<{
        name: string
        type?: { name?: string | null } | null
      }> | null
    } | null
  }>(INTROSPECTION_QUERY)

  const equalTypeCodes = (introspected.__type?.inputFields ?? [])
    .filter((field) => {
      if (!field.name || RESERVED_FILTER_FIELDS.has(field.name)) return false
      // Only option/equal filters — skip match/range types
      return field.type?.name === 'FilterEqualTypeInput'
    })
    .map((field) => field.name)

  if (equalTypeCodes.length === 0) {
    console.warn('[magento/attributes] No FilterEqualTypeInput fields found')
    cache = { attributes: [], labelIndex: new Map(), loadedAt: now }
    return cache
  }

  const data = await magentoGraphql<{
    customAttributeMetadata?: {
      items?: Array<AttributeMeta | null> | null
    } | null
  }>(METADATA_QUERY, {
    attributes: equalTypeCodes.map((attribute_code) => ({
      attribute_code,
      entity_type: 'catalog_product',
    })),
  })

  const attributes: FilterableAttribute[] = []
  const labelIndex = new Map<
    string,
    Array<{ code: string; value: string; label: string }>
  >()

  for (const item of data.customAttributeMetadata?.items ?? []) {
    if (!item?.attribute_code) continue
    const options = (item.attribute_options ?? []).filter(
      (opt): opt is AttributeOption =>
        Boolean(opt?.value) && Boolean(opt?.label),
    )
    if (options.length === 0) continue

    attributes.push({
      code: item.attribute_code,
      inputType: item.input_type ?? 'select',
      options,
    })

    for (const opt of options) {
      const key = normalizeLabel(opt.label)
      if (!key) continue
      const list = labelIndex.get(key) ?? []
      list.push({
        code: item.attribute_code,
        value: opt.value,
        label: opt.label,
      })
      labelIndex.set(key, list)
    }
  }

  cache = { attributes, labelIndex, loadedAt: now }
  console.log(
    `[magento/attributes] Loaded ${attributes.length} filterable attributes (${labelIndex.size} option labels)`,
  )
  return cache
}

function matchOptionsForValue(
  labelIndex: Map<string, Array<{ code: string; value: string; label: string }>>,
  attributes: FilterableAttribute[],
  rawValue: string,
  preferredCodes?: string[],
  allowPartial = false,
): ResolvedAttributeHit[] {
  const candidates = candidateLabels(rawValue)
  if (candidates.length === 0) return []

  const preferred = new Set(preferredCodes ?? [])
  const hits: ResolvedAttributeHit[] = []

  for (const candidate of candidates) {
    const exact = labelIndex.get(candidate) ?? []
    for (const hit of exact) {
      if (preferred.size > 0 && !preferred.has(hit.code)) continue
      hits.push({
        code: hit.code,
        optionIds: [hit.value],
        matchedLabel: hit.label,
        source: rawValue,
      })
    }
  }

  if (hits.length > 0) {
    return mergeHits(hits)
  }

  // Partial match only when explicitly resolving a known filter field
  // (e.g. color "navy" → Blue). Free-text scan stays exact to avoid
  // "pants" matching "Track Pants" / "Workout Pants".
  if (!allowPartial) return []
  if (normalizeLabel(rawValue).length < 3) return []

  const scope =
    preferred.size > 0
      ? attributes.filter((a) => preferred.has(a.code))
      : attributes

  for (const attr of scope) {
    if (attr.inputType === 'boolean') continue

    for (const opt of attr.options) {
      const label = normalizeLabel(opt.label)
      if (label.length < 3) continue
      const matched = candidates.some(
        (c) =>
          c.length >= 3 &&
          (label === c ||
            (c.length >= 4 && label.includes(c)) ||
            (label.length >= 4 && c.includes(label))),
      )
      if (matched) {
        hits.push({
          code: attr.code,
          optionIds: [opt.value],
          matchedLabel: opt.label,
          source: rawValue,
        })
      }
    }
  }

  return mergeHits(hits)
}

function mergeHits(hits: ResolvedAttributeHit[]): ResolvedAttributeHit[] {
  const byCode = new Map<string, ResolvedAttributeHit>()
  for (const hit of hits) {
    const existing = byCode.get(hit.code)
    if (!existing) {
      byCode.set(hit.code, { ...hit, optionIds: [...hit.optionIds] })
      continue
    }
    existing.optionIds = [...new Set([...existing.optionIds, ...hit.optionIds])]
    if (!existing.matchedLabel.includes(hit.matchedLabel)) {
      existing.matchedLabel = `${existing.matchedLabel}, ${hit.matchedLabel}`
    }
  }
  return [...byCode.values()]
}

function extractQueryPhrases(text: string): string[] {
  const normalized = normalizeLabel(text)
  if (!normalized) return []

  const tokens = normalized.split(' ').filter(Boolean)
  const phrases = new Set<string>()

  for (const token of tokens) {
    if (token.length >= 2) phrases.add(token)
  }
  // Bigrams help "track pants", "full zip", etc.
  for (let i = 0; i < tokens.length - 1; i++) {
    phrases.add(`${tokens[i]} ${tokens[i + 1]}`)
  }

  return [...phrases]
}

function hitsToFilter(
  hits: ResolvedAttributeHit[],
): Record<string, { eq: string } | { in: string[] }> {
  const out: Record<string, { eq: string } | { in: string[] }> = {}
  for (const hit of hits) {
    if (hit.optionIds.length === 1) {
      out[hit.code] = { eq: hit.optionIds[0] }
    } else if (hit.optionIds.length > 1) {
      out[hit.code] = { in: hit.optionIds }
    }
  }
  return out
}

/**
 * Resolve Magento GraphQL attribute filters from ProductFilters + free text,
 * using every FilterEqualTypeInput attribute discovered from Magento.
 */
export async function resolveMagentoAttributeFilters(
  filters: ProductFilters,
  options?: {
    /** When true (default), skip gender attribute — category paths handle Men/Women. */
    skipGenderAttribute?: boolean
    /** Max distinct attribute codes to apply (avoids over-constraining). */
    maxAttributes?: number
  },
): Promise<{
  filter: Record<string, { eq: string } | { in: string[] }>
  matched: ResolvedAttributeHit[]
  availableAttributeCount: number
}> {
  const skipGender = options?.skipGenderAttribute !== false
  const maxAttributes = options?.maxAttributes ?? 6

  let attributes: FilterableAttribute[] = []
  let labelIndex = new Map<
    string,
    Array<{ code: string; value: string; label: string }>
  >()

  try {
    const loaded = await loadAllFilterableAttributes()
    attributes = loaded.attributes
    labelIndex = loaded.labelIndex
  } catch (error) {
    console.warn(
      '[magento/attributes] Failed to load Magento attributes:',
      error instanceof Error ? error.message : error,
    )
    return { filter: {}, matched: [], availableAttributeCount: 0 }
  }

  const matched: ResolvedAttributeHit[] = []
  const usedCodes = new Set<string>()

  const pushHits = (hits: ResolvedAttributeHit[]) => {
    for (const hit of hits) {
      if (skipGender && hit.code === 'gender') continue
      if (usedCodes.has(hit.code)) {
        // Merge extra option IDs into existing hit
        const existing = matched.find((m) => m.code === hit.code)
        if (existing) {
          existing.optionIds = [
            ...new Set([...existing.optionIds, ...hit.optionIds]),
          ]
        }
        continue
      }
      if (usedCodes.size >= maxAttributes) break
      usedCodes.add(hit.code)
      matched.push(hit)
    }
  }

  // 1) Explicit ProductFilters fields → preferred Magento attributes
  for (const [filterKey, attrCodes] of Object.entries(FILTER_FIELD_TO_ATTRIBUTES)) {
    const raw = filters[filterKey]
    if (raw == null || raw === '' || String(raw).toLowerCase() === 'any') continue
    pushHits(
      matchOptionsForValue(
        labelIndex,
        attributes,
        String(raw),
        attrCodes,
        true,
      ),
    )
  }

  // 2) Boolean attributes from explicit phrases in the query
  const queryText = String(filters.query ?? filters.latest_answer ?? '')
  for (const [code, pattern] of Object.entries(BOOLEAN_ATTR_PHRASES)) {
    if (!pattern.test(queryText)) continue
    const attr = attributes.find((a) => a.code === code)
    if (!attr) continue
    const yes = attr.options.find(
      (o) => normalizeLabel(o.label) === 'yes' || o.value === '1',
    )
    if (!yes || usedCodes.has(code)) continue
    pushHits([
      {
        code,
        optionIds: [yes.value],
        matchedLabel: yes.label,
        source: queryText,
      },
    ])
  }

  // 3) Scan query tokens/phrases against ALL Magento option labels
  const scanText = [
    queryText,
    String(filters.category ?? ''),
    String(filters.usage ?? ''),
    String(filters.style ?? ''),
    String(filters.fit ?? ''),
    String(filters.color ?? ''),
    String(filters.material ?? ''),
    String(filters.size ?? ''),
  ]
    .filter(Boolean)
    .join(' ')

  // Prefer longer phrases first so "track pants" wins over "pants"
  const phrases = extractQueryPhrases(scanText).sort(
    (a, b) => b.length - a.length || a.localeCompare(b),
  )

  for (const phrase of phrases) {
    if (usedCodes.size >= maxAttributes) break
    // Skip ultra-generic tokens that explode matches
    if (
      ['the', 'and', 'for', 'with', 'any', 'product', 'products', 'item'].includes(
        phrase,
      )
    ) {
      continue
    }
    pushHits(matchOptionsForValue(labelIndex, attributes, phrase, undefined, false))
  }

  const filter = hitsToFilter(matched)
  if (matched.length > 0) {
    console.log(
      '[magento/attributes] Applied filters:',
      matched.map((m) => `${m.code}=${m.matchedLabel}`).join(', '),
    )
  }

  return {
    filter,
    matched,
    availableAttributeCount: attributes.length,
  }
}

/** @deprecated Prefer resolveMagentoAttributeFilters */
export async function resolveApparelAttributeFilters(filters: {
  color?: unknown
  gender?: unknown
  size?: unknown
  material?: unknown
  [key: string]: unknown
}): Promise<Record<string, { eq: string } | { in: string[] }>> {
  const { filter } = await resolveMagentoAttributeFilters(
    filters as ProductFilters,
  )
  return filter
}

/** Expose loaded Magento attributes for debugging / health. */
export async function listMagentoFilterableAttributes(): Promise<
  Array<{ code: string; optionCount: number; sampleLabels: string[] }>
> {
  const { attributes } = await loadAllFilterableAttributes()
  return attributes.map((attr) => ({
    code: attr.code,
    optionCount: attr.options.length,
    sampleLabels: attr.options.slice(0, 8).map((o) => o.label),
  }))
}
