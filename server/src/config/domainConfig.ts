import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const clarifyStepSchema = z.object({
  /** Ask when any of these filter keys are missing. */
  whenMissing: z.array(z.string()).optional(),
  /** Ask when all of these filter keys are missing. */
  whenMissingAll: z.array(z.string()).optional(),
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(6),
  message: z.string().optional(),
})

const filterHintSchema = z.object({
  /** Case-insensitive regex (string). Matched against customer text. */
  match: z.string().min(1),
  set: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
})

const enoughToSearchSchema = z.object({
  minClarifying: z.number().int().min(0).optional(),
  requireAny: z.array(z.string()).optional(),
  requireAll: z.array(z.string()).optional(),
  /** Each inner array is an AND group; search immediately if any group is fully present. */
  immediateIfAny: z.array(z.array(z.string())).optional(),
})

const domainSchema = z.object({
  id: z.string().min(1),
  /** Regex patterns (case-insensitive). First matching domain by priority wins. */
  match: z.array(z.string()).default([]),
  priority: z.number().optional(),
  filterHints: z.array(filterHintSchema).optional(),
  enoughToSearch: enoughToSearchSchema.optional(),
  clarify: z.array(clarifyStepSchema).optional(),
})

export const domainConfigSchema = z.object({
  merchantName: z.string().optional(),
  /** Injected into the LLM system prompt so the model knows the catalog vertical. */
  systemHint: z.string().optional(),
  intentRules: z
    .object({
      /** Soft apparel-style post-filters (gender SKU / category nouns). */
      enabled: z.boolean().default(true),
    })
    .optional(),
  /** ProductFilters key → Magento attribute codes (merged over built-in defaults). */
  filterAttributes: z.record(z.string(), z.array(z.string())).optional(),
  /** Soft label aliases for Magento option matching. */
  labelAliases: z.record(z.string(), z.array(z.string())).optional(),
  /** Applied for every query regardless of domain. */
  globalFilterHints: z.array(filterHintSchema).optional(),
  domains: z.array(domainSchema).default([]),
  /** Used when domain is general / has no clarify steps. */
  defaultClarify: z.array(clarifyStepSchema).optional(),
})

export type DomainConfig = z.infer<typeof domainConfigSchema>
export type DomainDefinition = z.infer<typeof domainSchema>
export type ClarifyStep = z.infer<typeof clarifyStepSchema>

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_PATH = path.resolve(__dirname, '../../domain-config.json')

let cached: DomainConfig | null = null
let cachedPath: string | null = null

function resolveConfigPath(): string {
  const fromEnv = process.env.DOMAIN_CONFIG_PATH?.trim()
  if (fromEnv) {
    return path.isAbsolute(fromEnv)
      ? fromEnv
      : path.resolve(process.cwd(), fromEnv)
  }
  return DEFAULT_PATH
}

function emptyConfig(): DomainConfig {
  return domainConfigSchema.parse({
    merchantName: 'Magento Store',
    systemHint: '',
    intentRules: { enabled: true },
    domains: [],
  })
}

/**
 * Load merchant domain config (JSON). Cached after first successful read.
 * Falls back to empty/safe defaults if the file is missing or invalid.
 */
export function getDomainConfig(forceReload = false): DomainConfig {
  const configPath = resolveConfigPath()
  if (!forceReload && cached && cachedPath === configPath) return cached

  try {
    if (!fs.existsSync(configPath)) {
      console.warn(
        `[domain-config] File not found at ${configPath}; using built-in heuristics only.`,
      )
      cached = emptyConfig()
      cachedPath = configPath
      return cached
    }
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown
    cached = domainConfigSchema.parse(raw)
    cachedPath = configPath
    console.log(
      `[domain-config] Loaded ${cached.merchantName ?? 'store'} from ${configPath} (${cached.domains.length} domains)`,
    )
    return cached
  } catch (error) {
    console.warn('[domain-config] Failed to load; using defaults:', error)
    cached = emptyConfig()
    cachedPath = configPath
    return cached
  }
}

export function getDomainConfigPath(): string {
  return resolveConfigPath()
}

export function isIntentRulesEnabled(): boolean {
  const cfg = getDomainConfig()
  return cfg.intentRules?.enabled !== false
}

/** Compile match pattern; treat plain words as word-boundary regexes. */
export function compileMatchPattern(pattern: string): RegExp | null {
  const trimmed = pattern.trim()
  if (!trimmed) return null
  try {
    if (trimmed.startsWith('re:')) {
      return new RegExp(trimmed.slice(3), 'i')
    }
    // Already looks like a regex with word boundaries / escapes
    if (/[\\(.*+?[{|^$]/.test(trimmed)) {
      return new RegExp(trimmed, 'i')
    }
    return new RegExp(`\\b${trimmed.replace(/\s+/g, '\\s+')}\\b`, 'i')
  } catch {
    return null
  }
}

export function textMatchesAny(text: string, patterns: string[]): boolean {
  return patterns.some((p) => compileMatchPattern(p)?.test(text))
}

export function findDomainDefinition(
  text: string,
  preferredId?: string,
): DomainDefinition | undefined {
  const cfg = getDomainConfig()
  if (preferredId) {
    const byId = cfg.domains.find((d) => d.id === preferredId)
    if (byId) return byId
  }
  const ordered = [...cfg.domains].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  )
  for (const domain of ordered) {
    if (domain.match.length === 0) continue
    if (textMatchesAny(text, domain.match)) return domain
  }
  return undefined
}

export function applyFilterHints(
  text: string,
  hints: Array<{ match: string; set: Record<string, string | number | boolean> }> | undefined,
  target: Record<string, string | number | boolean>,
): void {
  if (!hints?.length) return
  for (const hint of hints) {
    const re = compileMatchPattern(hint.match)
    if (!re?.test(text)) continue
    for (const [key, value] of Object.entries(hint.set)) {
      if (target[key] == null || target[key] === '') {
        target[key] = value
      }
    }
  }
}

export function filterHasValue(
  filters: Record<string, unknown>,
  key: string,
): boolean {
  const v = filters[key]
  if (v == null || v === '') return false
  if (typeof v === 'string' && v.toLowerCase() === 'any') return false
  return true
}

export function isClarifyStepNeeded(
  step: ClarifyStep,
  filters: Record<string, unknown>,
): boolean {
  if (step.whenMissingAll?.length) {
    return step.whenMissingAll.every((k) => !filterHasValue(filters, k))
  }
  if (step.whenMissing?.length) {
    return step.whenMissing.some((k) => !filterHasValue(filters, k))
  }
  return true
}

export function buildMerchantSystemAppendix(cfg = getDomainConfig()): string {
  const parts: string[] = []
  if (cfg.merchantName?.trim()) {
    parts.push(`Merchant / store: ${cfg.merchantName.trim()}`)
  }
  if (cfg.systemHint?.trim()) {
    parts.push(cfg.systemHint.trim())
  }
  if (cfg.domains.length > 0) {
    parts.push(
      `Configured shopping domains for this catalog: ${cfg.domains.map((d) => d.id).join(', ')}. Prefer questions and filters that fit these domains.`,
    )
  }
  if (parts.length === 0) return ''
  return `\n\n==============================\nMERCHANT CATALOG CONTEXT\n==============================\n\n${parts.join('\n\n')}\n`
}
