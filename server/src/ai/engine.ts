import { ChatOllama } from '@langchain/ollama'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'
import {
  getApparelCategoryOptions,
  getGiftCategoryOptions,
  isApparelClothingIntent,
  isFitnessEquipmentIntent,
  preferredApparelCategoryNames,
} from '../magento/categoryMatch.js'
import { extractPriceBounds } from '../magento/priceFilter.js'
import {
  applyFilterHints,
  buildMerchantSystemAppendix,
  findDomainDefinition,
  filterHasValue,
  getDomainConfig,
  isClarifyStepNeeded,
} from '../config/domainConfig.js'
import { buildSystemPrompt } from './prompt.js'

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:3b'

/** Clarifying questions after the initial query (total user turns - 1). */
const MAX_CLARIFYING_QUESTIONS = 3

const filtersSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
)

const askSchema = z.object({
  action: z.literal('ask_question'),
  message: z.string().optional(),
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(6),
  filters: filtersSchema.optional(),
})

const searchSchema = z.object({
  action: z.literal('search_products'),
  message: z.string().optional(),
  filters: filtersSchema,
})

export const aiResponseSchema = z.discriminatedUnion('action', [
  askSchema,
  searchSchema,
])

export type AiResponse = z.infer<typeof aiResponseSchema>
export type ProductFilters = z.infer<typeof filtersSchema>

/** Domain id from domain-config.json (or built-in heuristics). */
export type QueryDomain = string

function extractJson(raw: string): unknown {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model response')
  }
  return JSON.parse(candidate.slice(start, end + 1)) as unknown
}

/**
 * Map model JSON into the internal ask_question / search_products shape.
 * Supports both legacy `action` and the prompt's `type` field
 * (clarification | search) plus searchCriteria → filters.
 */
function normalizeAiPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw

  const obj = { ...(raw as Record<string, unknown>) }

  // Prompt format uses `type`; legacy uses `action`
  const typeRaw =
    typeof obj.type === 'string' ? obj.type.trim().toLowerCase() : ''
  const actionRaw =
    typeof obj.action === 'string' ? obj.action.trim().toLowerCase() : ''
  const discriminator = typeRaw || actionRaw

  const askAliases = new Set([
    'ask_question',
    'ask',
    'question',
    'clarify',
    'clarification',
    'clarifying',
    'ask_questions',
    'follow_up',
    'followup',
  ])
  const searchAliases = new Set([
    'search_products',
    'search',
    'search_product',
    'products',
    'recommend',
    'recommendations',
    'show_products',
    'ready',
  ])

  if (askAliases.has(discriminator)) {
    obj.action = 'ask_question'
  } else if (searchAliases.has(discriminator)) {
    obj.action = 'search_products'
  } else {
    const hasQuestion =
      typeof obj.question === 'string' && obj.question.trim().length > 0
    const hasOptions = Array.isArray(obj.options) && obj.options.length >= 2
    const hasCriteria =
      obj.searchCriteria && typeof obj.searchCriteria === 'object'
    if (hasQuestion && (hasOptions || !hasCriteria)) {
      obj.action = 'ask_question'
    } else if (hasCriteria || (obj.filters && typeof obj.filters === 'object')) {
      obj.action = 'search_products'
    }
  }

  // Flatten searchCriteria (+ optional intent/confidence) into filters
  if (obj.searchCriteria && typeof obj.searchCriteria === 'object') {
    const criteria = flattenSearchCriteria(
      obj.searchCriteria as Record<string, unknown>,
    )
    if (typeof obj.intent === 'string' && obj.intent.trim()) {
      criteria.intent = obj.intent.trim()
    }
    if (typeof obj.confidence === 'number') {
      criteria.confidence = obj.confidence
    }
    obj.filters = mergeFilters(
      (obj.filters as ProductFilters | undefined) ?? {},
      criteria,
    )
  }

  if (obj.action === 'ask_question') {
    if (typeof obj.question !== 'string' || !obj.question.trim()) {
      if (typeof obj.message === 'string' && obj.message.trim()) {
        obj.question = obj.message
      }
    }
    const question =
      typeof obj.question === 'string' ? obj.question.trim() : ''
    const rawOptions = Array.isArray(obj.options) ? obj.options : []
    let options = rawOptions
      .map((o) => (typeof o === 'string' ? o.trim() : String(o ?? '').trim()))
      .filter(Boolean)
      .slice(0, 6)

    // Prompt clarification may omit / under-supply options — always pad to >= 2
    if (isJunkOptions(options) && question) {
      const defaults = defaultOptionsForQuestion(question)
      if (defaults) options = defaults
    }
    // If options look like apparel but the question is industrial, swap tags
    if (
      question &&
      looksLikeApparelOptions(options) &&
      /\b(motor|shaft|bearing|industrial|hydraulic|pneumatic|coupling|gearbox|seal|gasket|replacement|component|nema|servo|stepper|machine\s+part)\b/i.test(
        question,
      )
    ) {
      options =
        defaultOptionsForQuestion(question, 'industrial') ?? [
          ...INDUSTRIAL_PART_OPTIONS,
        ]
    }
    if (options.length === 1) {
      options = [...options, 'Something else', 'Not sure']
    } else if (options.length < 2) {
      options = [
        'Show matching products',
        'Narrow it down more',
        'Not sure',
      ]
    }

    obj.options = options.slice(0, 6)
    if (!obj.filters || typeof obj.filters !== 'object') {
      obj.filters = {}
    }
  }

  if (obj.action === 'search_products') {
    if (!obj.filters || typeof obj.filters !== 'object') {
      obj.filters = {}
    }
    if (typeof obj.message !== 'string' || !obj.message.trim()) {
      obj.message =
        'Thanks — searching the Magento catalog with your requirements.'
    }
  }

  return obj
}

/** Convert prompt searchCriteria object into flat ProductFilters. */
function flattenSearchCriteria(
  criteria: Record<string, unknown>,
): ProductFilters {
  const filters: ProductFilters = {}

  for (const [key, value] of Object.entries(criteria)) {
    if (value === null || value === undefined || value === '') continue

    if (key === 'keywords' && Array.isArray(value)) {
      const keywords = value
        .map((v) => String(v ?? '').trim())
        .filter(Boolean)
      if (keywords.length) filters.keywords = keywords.join(' ')
      continue
    }

    if (key === 'features' && Array.isArray(value)) {
      const features = value
        .map((v) => String(v ?? '').trim())
        .filter(Boolean)
      if (features.length) filters.features = features.join(', ')
      continue
    }

    if (key === 'dimensions' && typeof value === 'object' && value) {
      for (const [dimKey, dimVal] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (dimVal === null || dimVal === undefined || dimVal === '') continue
        filters[`dimension_${dimKey}`] = dimVal as string | number | boolean
      }
      continue
    }

    if (key === 'compatibility' && typeof value === 'object' && value) {
      for (const [compKey, compVal] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (compVal === null || compVal === undefined || compVal === '') continue
        filters[`compatibility_${compKey}`] = compVal as
          | string
          | number
          | boolean
      }
      continue
    }

    if (key === 'budget') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        filters.price_max = value
        continue
      }
      if (typeof value === 'string' && value.trim()) {
        const bounds = extractPriceBounds(value)
        if (bounds.price_min != null) filters.price_min = bounds.price_min
        if (bounds.price_max != null) filters.price_max = bounds.price_max
        else {
          const n = Number(value.replace(/[^0-9.]/g, ''))
          if (Number.isFinite(n)) filters.price_max = n
        }
        continue
      }
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      filters[key] = value
    }
  }

  return filters
}

const JUNK_OPTION_LABELS = new Set([
  'yes',
  'no',
  'no / not sure',
  'not sure',
  'maybe',
  'ok',
  'okay',
])

function isJunkOptions(options: string[]): boolean {
  if (options.length < 2) return true
  const meaningful = options.filter(
    (o) => !JUNK_OPTION_LABELS.has(o.toLowerCase()),
  )
  return meaningful.length < 2
}

const INDUSTRIAL_PART_OPTIONS = [
  'Shaft / shaft collar',
  'Bearing',
  'Motor assembly',
  'Coupling / seal',
] as const

const INDUSTRIAL_MOTOR_OPTIONS = [
  'AC induction motor',
  'Servo / stepper',
  'Gear motor',
  'Not sure',
] as const

const INDUSTRIAL_NEED_OPTIONS = [
  'Exact replacement part',
  'Compatible alternative',
  'Full motor unit',
  'Related accessories',
] as const

const APPAREL_OPTION_LABELS = new Set([
  'pants',
  'jackets',
  'tees',
  'shorts',
  'hoodies & sweatshirts',
  'hoodies',
  'bags',
  'watches',
  'fitness equipment',
  'yoga',
  'training',
  'running',
  'casual',
  'everyday',
  'analog',
  'digital',
  'smartwatch',
  'pullover',
  'zip-up',
  'bomber',
  'puffer',
  'joggers',
  'chinos',
  'jeans',
  'messenger',
  'backpack',
  'tote',
  'duffel',
  'crossbody',
])

function looksLikeApparelOptions(options: string[]): boolean {
  if (options.length < 2) return false
  const apparelHits = options.filter((o) =>
    APPAREL_OPTION_LABELS.has(o.trim().toLowerCase()),
  ).length
  return apparelHits >= Math.ceil(options.length / 2)
}

/** Sensible chip options when the model asks a known question without choices. */
function defaultOptionsForQuestion(
  question: string,
  domain?: string,
): string[] | null {
  const q = question.toLowerCase()

  // Industrial first — never fall through to apparel/gear chips
  if (domain === 'industrial') {
    if (/\b(motor|equipment|nema|servo|stepper)\b/.test(q)) {
      return [...INDUSTRIAL_MOTOR_OPTIONS]
    }
    if (
      /\b(component|replacement|part|shaft|bearing|coupling|seal|collar)\b/.test(
        q,
      ) ||
      /\b(type of product|looking for|kind of|what do you need|what kind)\b/.test(
        q,
      )
    ) {
      return [...INDUSTRIAL_PART_OPTIONS]
    }
    if (/\b(describes|need|exact|compatible|alternative)\b/.test(q)) {
      return [...INDUSTRIAL_NEED_OPTIONS]
    }
    if (/\bbudget|price|spend|cost/.test(q)) {
      return ['Under $50', '$50-$100', 'Above $100']
    }
    return [...INDUSTRIAL_PART_OPTIONS]
  }

  if (/\bwatch/.test(q)) {
    return ['Analog', 'Digital', 'Smartwatch', 'Luxury / dress', 'Sport']
  }
  if (/\b(bag|backpack|messenger|tote|duffel)\b/.test(q)) {
    return ['Messenger', 'Backpack', 'Tote', 'Duffel', 'Crossbody']
  }
  if (/\b(hoodie|sweatshirt)\b/.test(q)) {
    return ['Pullover', 'Zip-up', 'Lightweight', 'Fleece']
  }
  if (/\bjacket\b/.test(q)) {
    return ['Bomber', 'Puffer', 'Rain jacket', 'Denim', 'Softshell']
  }
  if (/\b(pant|trouser|jogger)\b/.test(q)) {
    return ['Joggers', 'Chinos', 'Track pants', 'Jeans']
  }
  if (/\bcolor|colour/.test(q)) {
    return ['Black', 'Blue', 'Gray', 'Any color']
  }
  if (/\bbudget|price|spend|cost/.test(q)) {
    return ['Under $50', '$50-$100', 'Above $100']
  }
  if (/\bfit\b/.test(q)) {
    return ['Slim', 'Regular', 'Relaxed']
  }
  if (/\b(use|usage|mainly for|activity)\b/.test(q)) {
    return ['Training', 'Running', 'Casual', 'Everyday']
  }
  // Industrial keywords in the question (domain not yet passed)
  if (/\b(motor|equipment|nema|servo|stepper)\b/.test(q)) {
    return [...INDUSTRIAL_MOTOR_OPTIONS]
  }
  if (/\b(component|replacement|part|shaft|bearing|coupling|seal)\b/.test(q)) {
    return [...INDUSTRIAL_PART_OPTIONS]
  }
  if (/\b(gift|type of product|looking for|considering)\b/.test(q)) {
    return ['Fitness Equipment', 'Bags', 'Watches', 'Pants', 'Jackets']
  }
  if (/\b(brand|make|manufacturer)\b/.test(q)) {
    return ['No preference', 'A specific brand', 'Not sure']
  }
  if (/\b(size|sizing)\b/.test(q)) {
    return ['Small', 'Medium', 'Large', 'Not sure']
  }
  if (/\b(type|kind|category|style)\b/.test(q)) {
    return ['Show matching products', 'Narrow it down more', 'Not sure']
  }

  return null
}

function mergeFilters(
  ...parts: Array<ProductFilters | undefined>
): ProductFilters {
  const result: ProductFilters = {}
  for (const part of parts) {
    if (!part) continue
    for (const [key, value] of Object.entries(part)) {
      // Don't let empty / nullish LLM values wipe known filters
      if (value === null || value === undefined || value === '') continue
      result[key] = value
    }
  }
  return result
}

export function detectDomain(text: string, filters: ProductFilters = {}): QueryDomain {
  if (filters.domain) return String(filters.domain) as QueryDomain

  const fromConfig = findDomainDefinition(text)
  if (fromConfig) return fromConfig.id

  const lower = text.toLowerCase()

  if (
    /\b(motor|shaft|bearing|grinding|industrial|hydraulic|pneumatic|coupling|gearbox|seal|gasket|replacement\s+component|machine\s+part|nema|servo|stepper)\b/.test(
      lower,
    )
  ) {
    return 'industrial'
  }
  if (/\bgift\b|\bpresent\b|\bbirthday\b|\banniversary\b|\bfor my (husband|wife|dad|mom)\b/.test(lower)) {
    return 'gift'
  }

  // Fitness *equipment* intent (strength training, dumbbells, etc.) before apparel
  if (isFitnessEquipmentIntent(lower)) {
    return 'gear'
  }

  // Clothing nouns win over gym/fitness *activity* context (e.g. "suits for the gym")
  if (isApparelClothingIntent(lower)) {
    return 'apparel'
  }

  // Gear accessories / fitness when no clothing noun
  if (
    /\b(bags?|watches?|watch|fitness\s+equipment|yoga\s+mat|backpack|duffel|treadmill|dumbbell|kettlebell|exercise\s+bike|cycle\s+equipment)\b/.test(
      lower,
    )
  ) {
    return 'gear'
  }
  if (/\b(fitness|yoga)\b/.test(lower) && !/\b(clothes|clothing|wear|suit|pant|hoodie|shirt)\b/.test(lower)) {
    return 'gear'
  }
  return 'general'
}

/** Soft attribute hints — Magento categories resolved dynamically at search time. */
export function extractHintsFromText(text: string): ProductFilters {
  const lower = text.toLowerCase().trim()
  const filters: ProductFilters = {}
  const tokenCount = text.trim().split(/\s+/).filter(Boolean).length

  // Longer phrases become the search query. Short SKU-like codes also count.
  // Chip answers (color/budget) must not replace the original query.
  const looksLikeSku =
    /^[A-Za-z0-9][A-Za-z0-9._-]{1,48}$/.test(text.trim()) && /\d/.test(text)
  if (tokenCount >= 3 || looksLikeSku) {
    filters.query = text.trim()
  }

  const domain = detectDomain(text)
  // Don't overwrite an established domain with "general" from short answers
  // like "Any color" / "Black" / "Under $50"
  if (domain !== 'general') {
    filters.domain = domain
  }

  // Merchant domain-config.json hints (global + matched domain)
  const cfg = getDomainConfig()
  applyFilterHints(text, cfg.globalFilterHints, filters)
  const domainDef =
    findDomainDefinition(text, typeof filters.domain === 'string' ? filters.domain : undefined) ??
    findDomainDefinition(text)
  applyFilterHints(text, domainDef?.filterHints, filters)

  if (domain === 'industrial') {
    if (/\bgrinding\b/.test(lower)) filters.symptom = 'grinding noise'
    if (/\bshaft\b/.test(lower)) filters.part_family = 'shaft'
    if (/\bmotor\b/.test(lower)) filters.equipment = 'motor'
    if (/\bbearing\b/.test(lower)) filters.part_type = 'bearing'
    if (/\bseal\b/.test(lower)) filters.part_type = 'seal'
    if (/\bcoupling\b/.test(lower)) filters.part_type = 'coupling'
    if (/\bshaft collar\b|\bcollar clamp\b/.test(lower)) {
      filters.part_type = 'shaft collar'
    }
    if (/nema\s*23|stepper/.test(lower)) filters.motor_type = 'stepper'
    if (/servo/.test(lower)) filters.motor_type = 'servo'
    if (/induction|ac motor|1\s*hp/.test(lower)) filters.motor_type = 'ac induction'
    if (/gear\s*motor|12v/.test(lower)) filters.motor_type = 'gear motor'
  }

  if (/\bgift\b|\bpresent\b|\bbirthday\b|\banniversary\b/.test(lower)) {
    filters.occasion = 'gift'
  }

  if (
    /\b(husband|boyfriend|dad|father|son|brother|him|his|male)\b/.test(lower) ||
    /\bmen'?s?\b/.test(lower)
  ) {
    filters.gender = 'men'
    if (/\bhusband\b/.test(lower)) filters.recipient = 'husband'
  } else if (
    /\b(wife|girlfriend|mom|mother|daughter|sister|hers|female|ladies|woman)\b/.test(
      lower,
    ) ||
    /\bwomen'?s?\b/.test(lower) ||
    /\bher\b/.test(lower)
  ) {
    filters.gender = 'women'
    if (/\bwife\b/.test(lower)) filters.recipient = 'wife'
  }

  // Short answers / option clicks — store as latest_answer for search keywords
  if (text.trim().split(/\s+/).length <= 6) {
    filters.latest_answer = text.trim()
  }

  if (
    /^(watches|bags|jackets|tees|pants|shorts|hoodies|fitness equipment|hoodies & sweatshirts|yoga)$/i.test(
      text.trim(),
    )
  ) {
    filters.category = text.trim()
  } else if (isFitnessEquipmentIntent(lower)) {
    filters.category = filters.category ?? 'Fitness Equipment'
  } else if (domain === 'apparel' || domain === 'gear' || domain === 'gift') {
    if (/\b(watches?|watch)\b/.test(lower)) filters.category = 'Watches'
    else if (/\b(bags?|backpack|duffel)\b/.test(lower)) filters.category = 'Bags'
    else if (/\b(jackets?|coat)\b/.test(lower)) filters.category = 'Jackets'
    else if (/\b(pants?|trousers?|joggers?|track\s*pants?|tracksuits?|suits?)\b/.test(lower)) {
      // Tracksuits / gym suits → apparel bottoms (not Fitness Equipment)
      filters.category = 'Pants'
    } else if (/\b(hoodie|sweatshirt)s?\b/.test(lower)) {
      filters.category = 'Hoodies & Sweatshirts'
    } else if (/\b(shorts?)\b/.test(lower)) {
      filters.category = 'Shorts'
    } else if (/\b(tees?|t-?shirts?)\b/.test(lower)) {
      filters.category = 'Tees'
    } else if (/\b(fitness\s*equipment|yoga\s*mat)\b/.test(lower)) {
      filters.category = 'Fitness Equipment'
    }
  }

  // Gym *clothes* activity → usage=training (do not override equipment intent)
  if (
    isApparelClothingIntent(lower) &&
    /\b(gym|workout|training|athletic|sports?)\b/.test(lower)
  ) {
    filters.usage = filters.usage ?? 'training'
  }

  // Industrial option clicks
  if (/shaft\s*collar|collar\s*clamp/i.test(text)) filters.part_type = 'shaft collar'
  else if (/^bearing$/i.test(text.trim())) filters.part_type = 'bearing'
  else if (/motor assembly/i.test(text)) filters.part_type = 'motor assembly'
  else if (/coupling|seal/i.test(text.trim()) && domain === 'industrial') {
    filters.part_type = text.trim().toLowerCase()
  }

  if (/relax(ed)?/.test(lower)) filters.fit = 'relaxed'
  else if (/slim/.test(lower)) filters.fit = 'slim'
  else if (/regular\s*fit/.test(lower)) filters.fit = 'regular'

  // Bare "Training" chip / running / casual — apparel usage only when not equipment
  if (!isFitnessEquipmentIntent(lower)) {
    if (/^(training|train)$/.test(lower) || (/\btraining\b/.test(lower) && isApparelClothingIntent(lower))) {
      filters.usage = 'training'
    } else if (/^(running|run)$/.test(lower) || /\brunning\b/.test(lower)) {
      filters.usage = 'running'
    } else if (/^casual$/.test(lower) || /\bcasual\b/.test(lower)) {
      filters.usage = 'casual'
    } else if (/^(sporty|everyday|formal|travel)$/i.test(text.trim())) {
      filters.style = text.trim().toLowerCase()
    }
  } else if (/^(yoga|weights|cardio accessories|not sure)$/i.test(text.trim())) {
    filters.style = text.trim().toLowerCase()
    filters.category = filters.category ?? 'Fitness Equipment'
  }

  // Watch type option clicks
  if (
    /^(analog|digital|smartwatch|sport|luxury\s*\/\s*dress|luxury|dress)$/i.test(
      text.trim(),
    )
  ) {
    filters.style = text.trim().toLowerCase().replace(/\s*\/\s*/g, ' ')
    filters.category = filters.category ?? 'Watches'
  }

  // Bag type option clicks
  if (
    /^(messenger|backpack|tote|duffel|crossbody)$/i.test(text.trim())
  ) {
    filters.style = text.trim().toLowerCase()
    filters.category = filters.category ?? 'Bags'
  }

  // Budget language: below/under/above/over/between/$X-$Y (any amount)
  const priceBounds = extractPriceBounds(text)
  if (priceBounds.price_min != null) filters.price_min = priceBounds.price_min
  if (priceBounds.price_max != null) filters.price_max = priceBounds.price_max

  if (domain === 'apparel' || domain === 'gift' || domain === 'gear') {
    const colors = [
      'red',
      'blue',
      'black',
      'white',
      'green',
      'gray',
      'grey',
      'navy',
      'brown',
      'orange',
      'purple',
      'yellow',
      'lavender',
    ]
    for (const color of colors) {
      if (new RegExp(`\\b${color}\\b`).test(lower)) {
        filters.color = color === 'grey' ? 'gray' : color
        break
      }
    }
  }

  if (/^any color$/i.test(text.trim()) || /^any$/i.test(text.trim())) {
    filters.color = 'any'
  }

  return filters
}

function clarifyingCount(userTurnCount: number): number {
  return Math.max(0, userTurnCount - 1)
}

export function isReadyToSearch(
  filters: ProductFilters,
  userTurnCount: number,
): boolean {
  // After 3 clarifying answers, always search
  if (clarifyingCount(userTurnCount) >= MAX_CLARIFYING_QUESTIONS) return true

  const domain = detectDomain(String(filters.query ?? ''), filters)
  const clarifying = clarifyingCount(userTurnCount)
  const domainDef = findDomainDefinition(
    String(filters.query ?? ''),
    domain,
  )

  if (domainDef?.enoughToSearch) {
    const rule = domainDef.enoughToSearch
    if (rule.immediateIfAny?.length) {
      for (const group of rule.immediateIfAny) {
        if (group.every((k) => filterHasValue(filters, k))) return true
      }
    }
    const min = rule.minClarifying ?? 0
    if (clarifying >= min) {
      if (rule.requireAll?.length) {
        if (rule.requireAll.every((k) => filterHasValue(filters, k))) return true
      } else if (rule.requireAny?.length) {
        if (rule.requireAny.some((k) => filterHasValue(filters, k))) return true
      } else if (min > 0) {
        return true
      }
    }
    // Config domain present but not ready yet — skip built-in apparel heuristics
    // unless this is a legacy id without enough clarity from config alone.
    if (domainDef.clarify?.length) return false
  }

  if (domain === 'industrial') {
    // Need at least part_type (or similar) after some clarification
    return (
      clarifying >= 2 &&
      Boolean(filters.part_type || filters.motor_type || filters.category)
    )
  }

  if (domain === 'gift') {
    return clarifying >= 2 && Boolean(filters.category)
  }

  if (domain === 'apparel' || domain === 'gear') {
    // Attribute-rich first queries (e.g. "green pants women") can search immediately.
    const hasCategory = Boolean(filters.category)
    const hasColor =
      Boolean(filters.color) && String(filters.color).toLowerCase() !== 'any'
    const hasGender = Boolean(filters.gender)
    if (
      hasCategory &&
      (hasColor || hasGender) &&
      clarifying === 0
    ) {
      return true
    }
    if (hasCategory && hasColor && hasGender) {
      return true
    }
    return (
      clarifying >= 2 &&
      Boolean(filters.category || filters.usage || filters.style)
    )
  }

  return clarifying >= MAX_CLARIFYING_QUESTIONS
}

async function fallbackQuestion(
  filters: ProductFilters,
  userTurnCount: number,
): Promise<AiResponse> {
  const domain = detectDomain(String(filters.query ?? ''), filters)
  const step = clarifyingCount(userTurnCount)
  const cfg = getDomainConfig()
  const domainDef =
    findDomainDefinition(String(filters.query ?? ''), domain) ??
    cfg.domains.find((d) => d.id === domain)

  const clarifySteps = domainDef?.clarify?.length
    ? domainDef.clarify
    : cfg.defaultClarify

  if (clarifySteps?.length && step < MAX_CLARIFYING_QUESTIONS) {
    for (const clarify of clarifySteps) {
      if (!isClarifyStepNeeded(clarify, filters)) continue
      return {
        action: 'ask_question',
        message: clarify.message ?? 'I can help narrow that down.',
        question: clarify.question,
        options: clarify.options,
        filters: { ...filters, domain },
      }
    }
    // Domain config defined steps and none remain → search
    if (domainDef?.clarify?.length) return forceSearch(filters)
  }

  // Legacy gift path: prefer live Magento category chips when config did not ask yet
  if (domain === 'gift' && !filters.category) {
    const who =
      filters.recipient === 'husband'
        ? 'your husband'
        : filters.recipient === 'wife'
          ? 'your wife'
          : 'them'
    let options = await getGiftCategoryOptions(String(filters.gender ?? ''))
    if (options.length < 2) {
      options = ['Watches', 'Bags', 'Jackets', 'Hoodies & Sweatshirts']
    }
    return {
      action: 'ask_question',
      message: `I’d love to help you pick a gift for ${who}.`,
      question: 'What type of gift are you considering?',
      options,
      filters: { ...filters, domain: 'gift' },
    }
  }

  if ((domain === 'apparel' || domain === 'gear') && !filters.category) {
    const queryHint = String(filters.query ?? '')
    let options = await getApparelCategoryOptions(
      queryHint,
      typeof filters.gender === 'string' ? filters.gender : undefined,
    )
    if (options.length < 2) {
      options =
        domain === 'gear'
          ? ['Fitness Equipment', 'Bags', 'Watches', 'Yoga']
          : ['Pants', 'Jackets', 'Bags', 'Watches', 'Hoodies & Sweatshirts']
    }
    return {
      action: 'ask_question',
      message: 'I can help narrow that down.',
      question: 'What type of product are you looking for?',
      options,
      filters: { ...filters, domain },
    }
  }

  if (domain === 'apparel' && !filters.usage && !filters.style) {
    return {
      action: 'ask_question',
      message: 'Great choice.',
      question: 'What will you mainly use it for?',
      options: ['Training', 'Running', 'Casual', 'Everyday'],
      filters,
    }
  }

  if (
    (domain === 'apparel' || domain === 'gift' || domain === 'gear') &&
    !filters.color &&
    step < MAX_CLARIFYING_QUESTIONS
  ) {
    return {
      action: 'ask_question',
      message: 'Got it.',
      question: 'Do you have a color preference?',
      options: ['Black', 'Blue', 'Gray', 'Any color'],
      filters,
    }
  }

  if (
    (domain === 'apparel' || domain === 'gift' || domain === 'gear') &&
    filters.price_min == null &&
    filters.price_max == null &&
    step < MAX_CLARIFYING_QUESTIONS
  ) {
    return {
      action: 'ask_question',
      message: 'Almost there.',
      question: 'What is your budget?',
      options: ['Under $50', '$50-$100', 'Above $100'],
      filters,
    }
  }

  return forceSearch(filters)
}

function forceSearch(filters: ProductFilters): AiResponse {
  return {
    action: 'search_products',
    message: 'Thanks — searching the Magento catalog with your requirements.',
    filters,
  }
}

function buildUserPrompt(input: {
  query: string
  history: Array<{ role: string; content: string }>
  knownFilters: ProductFilters
  userTurnCount: number
  domain: QueryDomain
}): string {
  const clarifying = clarifyingCount(input.userTurnCount)
  return [
    `Customer latest input: ${input.query}`,
    `Conversation context domain hint (do not force this domain): ${input.domain}`,
    `Known filters so far: ${JSON.stringify(input.knownFilters)}`,
    `Clarifying questions already answered: ${clarifying} / ${MAX_CLARIFYING_QUESTIONS}`,
    `Recent conversation:`,
    ...input.history.slice(-10).map((m) => `${m.role}: ${m.content}`),
    ``,
    `Think from the customer's words only. Do not bias toward any product domain.`,
    `Decide: clarification (one missing detail) OR search (enough info).`,
    `If the customer gave a SKU or a specific product name, return search immediately (no clarification).`,
    `If clarifying questions answered >= ${MAX_CLARIFYING_QUESTIONS}, return search.`,
    `Do not ask about details already present in known filters or conversation.`,
    `Return JSON only using ONE of these shapes:`,
    `clarification: {"type":"clarification","question":"<one dynamic question>","options":["A","B","C"]}`,
    `search: {"type":"search","intent":"...","confidence":0.9,"searchCriteria":{"keywords":[],"application":"","equipment":"","industry":"","features":[],"dimensions":{},"compatibility":{},"quantity":null,"budget":null}}`,
    `For clarification, options must fit this request (never Yes/No, never unrelated domain choices).`,
    input.domain === 'industrial'
      ? `This request is industrial/parts. Options must be part or motor choices (e.g. Shaft / shaft collar, Bearing, Motor assembly, Coupling / seal, AC induction motor) — never apparel, color fashion, or fitness chips.`
      : '',
    `Never invent product SKUs or Magento catalog data.`,
  ]
    .filter(Boolean)
    .join('\n')
}

function isApparelQuestion(question: string): boolean {
  const q = question.toLowerCase()
  return (
    q.includes('color') ||
    q.includes('colour') ||
    q.includes('style do you prefer') ||
    q.includes('fit do you prefer') ||
    q.includes('budget') ||
    /\b(gender|men'?s|women'?s|size|sizing|hoodie|jacket|pants?|tee|shirt|shorts?|apparel|clothing|outfit)\b/.test(
      q,
    )
  )
}

/** Prefer industrial clarify chips over apparel/gear tags. */
function ensureDomainOptions(
  question: string,
  options: string[],
  domain: string,
): string[] {
  if (domain !== 'industrial') return options
  if (isJunkOptions(options) || looksLikeApparelOptions(options)) {
    return (
      defaultOptionsForQuestion(question, 'industrial') ?? [
        ...INDUSTRIAL_PART_OPTIONS,
      ]
    )
  }
  return options
}

export async function runAssistantTurn(input: {
  query: string
  history: Array<{ role: string; content: string }>
  knownFilters: ProductFilters
}): Promise<AiResponse> {
  const userTurnCount = input.history.filter((m) => m.role === 'user').length
  const hints = extractHintsFromText(input.query)
  const seededFilters = mergeFilters(input.knownFilters, hints)

  if (input.knownFilters.query) {
    seededFilters.query = input.knownFilters.query
  } else if (!seededFilters.query && input.history[0]?.content) {
    seededFilters.query = input.history[0].content
  }

  const domain = detectDomain(
    String(seededFilters.query ?? input.query),
    seededFilters,
  )
  seededFilters.domain = domain

  if (isReadyToSearch(seededFilters, userTurnCount)) {
    return forceSearch(seededFilters)
  }

  const llm = new ChatOllama({
    baseUrl: OLLAMA_BASE_URL,
    model: OLLAMA_MODEL,
    temperature: 0.2,
    format: 'json',
  })

  try {
    const result = await llm.invoke([
      new SystemMessage(
        buildSystemPrompt(buildMerchantSystemAppendix(getDomainConfig())),
      ),
      new HumanMessage(
        buildUserPrompt({
          ...input,
          knownFilters: seededFilters,
          userTurnCount,
          domain,
        }),
      ),
    ])

    const text =
      typeof result.content === 'string'
        ? result.content
        : JSON.stringify(result.content)

    const parsed = normalizeAiPayload(extractJson(text))
    const parsedResult = aiResponseSchema.safeParse(parsed)
    if (!parsedResult.success) {
      console.warn(
        '[ai] Model JSON failed schema validation:',
        parsedResult.error.issues,
      )
      return fallbackQuestion(seededFilters, userTurnCount)
    }
    const validated = parsedResult.data
    const mergedFilters = mergeFilters(
      seededFilters,
      validated.filters,
      extractHintsFromText(input.query),
    )
    mergedFilters.domain = domain
    if (seededFilters.query) mergedFilters.query = seededFilters.query

    if (isReadyToSearch(mergedFilters, userTurnCount)) {
      return forceSearch(mergedFilters)
    }

    if (validated.action === 'search_products') {
      // Allow early search when AI (or rich first query) already has useful filters
      if (
        clarifyingCount(userTurnCount) >= 1 &&
        (mergedFilters.part_type ||
          mergedFilters.category ||
          mergedFilters.motor_type)
      ) {
        return { ...validated, filters: mergedFilters }
      }
      if (
        mergedFilters.category &&
        (mergedFilters.color || mergedFilters.gender)
      ) {
        return forceSearch(mergedFilters)
      }
      return fallbackQuestion(mergedFilters, userTurnCount)
    }

    // Block irrelevant apparel questions for industrial domain
    if (
      domain === 'industrial' &&
      isApparelQuestion(validated.question)
    ) {
      return fallbackQuestion(mergedFilters, userTurnCount)
    }

    // Don't repeat a question the assistant already asked — search instead
    const lastAssistant = [...input.history]
      .reverse()
      .find((m) => m.role === 'assistant')
    const q = validated.question.trim().toLowerCase()
    if (
      lastAssistant &&
      (lastAssistant.content.toLowerCase().includes(q) ||
        lastAssistant.content.trim().toLowerCase() ===
          (validated.message ?? '').trim().toLowerCase())
    ) {
      return forceSearch(mergedFilters)
    }

    // If color was already answered, never re-ask about color
    if (
      mergedFilters.color &&
      (q.includes('color') || q.includes('colour'))
    ) {
      return fallbackQuestion(mergedFilters, userTurnCount)
    }

    // Replace empty/junk or wrong-domain options with domain-aware chips
    const safeOptions = ensureDomainOptions(
      validated.question,
      validated.options,
      domain,
    )
    if (isJunkOptions(safeOptions) || safeOptions !== validated.options) {
      const defaults =
        safeOptions.length >= 2 && !isJunkOptions(safeOptions)
          ? safeOptions
          : defaultOptionsForQuestion(validated.question, domain) ?? [
              'Show matching products',
              'Narrow it down more',
              'Not sure',
            ]
      return {
        ...validated,
        options: defaults,
        filters: mergedFilters,
      }
    }

    return { ...validated, filters: mergedFilters }
  } catch (error) {
    console.warn('[ai] Falling back to domain heuristic:', error)
    return fallbackQuestion(seededFilters, userTurnCount)
  }
}

export function getModelInfo() {
  return { model: OLLAMA_MODEL, baseUrl: OLLAMA_BASE_URL }
}