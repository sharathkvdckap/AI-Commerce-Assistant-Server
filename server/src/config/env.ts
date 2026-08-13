import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.resolve(__dirname, '../../.env') })

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function envInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) ? n : fallback
}

function envFloat(value: string | undefined, fallback: number): number {
  const n = Number.parseFloat(value ?? '')
  return Number.isFinite(n) ? n : fallback
}

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/ai_commerce_assistant'

const llmProviderRaw = (process.env.LLM_PROVIDER ?? 'ollama').toLowerCase()
const llmProvider =
  llmProviderRaw === 'groq' ? ('groq' as const) : ('ollama' as const)

export const config = {
  port: envInt(process.env.PORT, 3001),
  /** Chat LLM: `ollama` (local) or `groq` (cloud free-tier). Embeddings still use Ollama. */
  llm: {
    provider: llmProvider,
    ollama: {
      model: process.env.OLLAMA_MODEL ?? 'qwen2.5:3b',
      baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
    },
    groq: {
      apiKey: (process.env.GROQ_API_KEY ?? '').trim(),
      /** Free-tier default: fast Llama 3.1 8B Instant */
      model: process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant',
    },
  },
  /** @deprecated Prefer config.llm.ollama — kept for embedding callers. */
  ollama: {
    model: process.env.OLLAMA_MODEL ?? 'qwen2.5:3b',
    baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  },
  magento: {
    url: (process.env.MAGENTO_URL ?? '').replace(/\/$/, ''),
    graphqlUrl: process.env.MAGENTO_GRAPHQL_URL ?? '',
    storeCode: process.env.MAGENTO_STORE_CODE ?? 'default',
    accessToken: process.env.MAGENTO_ACCESS_TOKEN ?? '',
    useAuth: envBool(process.env.MAGENTO_GRAPHQL_USE_AUTH, false),
    pageSize: envInt(process.env.MAGENTO_PAGE_SIZE, 0),
    timeoutMs: envInt(process.env.MAGENTO_TIMEOUT_MS, 20000),
  },
  /** Product hybrid semantic search (pgvector + BGE-M3). */
  semantic: {
    enabled: envBool(process.env.SEMANTIC_ENABLED, false),
    topK: envInt(process.env.SEMANTIC_TOP_K, 12),
    minScore: envFloat(process.env.SEMANTIC_MIN_SCORE, 0.35),
    fallbackMinScore: envFloat(process.env.SEMANTIC_FALLBACK_MIN_SCORE, 0.55),
    syncConcurrency: envInt(process.env.SEMANTIC_SYNC_CONCURRENCY, 4),
  },
  /** User context memory (pgvector + BGE-M3). Shares DATABASE_URL with semantic. */
  context: {
    enabled: envBool(process.env.CONTEXT_MEMORY_ENABLED, true),
    databaseUrl,
    embeddingModel: process.env.EMBEDDING_MODEL ?? 'bge-m3',
    embeddingDims: envInt(process.env.EMBEDDING_DIMS, 1024),
    similarityThreshold: envFloat(
      process.env.CONTEXT_SIMILARITY_THRESHOLD,
      0.8,
    ),
  },
  /**
   * Merchant vertical config (domains, clarify steps, attribute maps).
   * Default: server/domain-config.json — override with DOMAIN_CONFIG_PATH.
   */
  domainConfigPath: process.env.DOMAIN_CONFIG_PATH?.trim() || '',
  /**
   * HMAC secret shared with Magento for signed customer_id redirects.
   * When set, bare customer_* userIds are rejected without a valid proof.
   */
  identity: {
    hmacSecret: (process.env.CUSTOMER_ID_HMAC_SECRET ?? '').trim(),
    /** Max token lifetime Magento may issue (seconds). */
    tokenTtlSec: envInt(process.env.CUSTOMER_ID_TOKEN_TTL_SEC, 3600),
    /** Reject exp more than this many seconds in the future. */
    maxFutureSkewSec: envInt(process.env.CUSTOMER_ID_MAX_FUTURE_SKEW_SEC, 7200),
  },
}

export function isMagentoConfigured(): boolean {
  return Boolean(config.magento.graphqlUrl || config.magento.url)
}

export function getMagentoGraphqlUrl(): string {
  if (config.magento.graphqlUrl) return config.magento.graphqlUrl
  if (config.magento.url) return `${config.magento.url}/graphql`
  return ''
}

export function isDatabaseConfigured(): boolean {
  return Boolean(config.context.databaseUrl)
}

export function isContextMemoryConfigured(): boolean {
  return config.context.enabled && isDatabaseConfigured()
}

export function isSemanticConfigured(): boolean {
  return config.semantic.enabled && isDatabaseConfigured()
}
