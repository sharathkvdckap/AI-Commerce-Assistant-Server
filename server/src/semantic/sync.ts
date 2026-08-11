import type { ProductFilters } from '../ai/engine.js'
import { config } from '../config/env.js'
import { embedText, toPgVectorLiteral } from '../context/embeddings.js'
import { buildSearchQuery, mapMagentoProduct } from '../magento/mapper.js'
import {
  fetchProductsBySku,
  iterateMagentoCatalogForSync,
  type MagentoCatalogSyncItem,
} from '../magento/search.js'
import type { CatalogProduct } from '../magento/types.js'
import {
  countProductEmbeddings,
  listEmbeddedSkus,
  searchProductEmbeddings,
  upsertProductEmbedding,
  type ProductEmbeddingRow,
} from './repository.js'

function stripHtml(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildSearchText(item: MagentoCatalogSyncItem): string {
  const short = stripHtml(item.short_description?.html)
  const long = stripHtml(item.description?.html)
  const parts = [item.sku, item.name, short, long.slice(0, 1200)].filter(Boolean)
  return parts.join(' · ')
}

function catalogCardFields(item: MagentoCatalogSyncItem): {
  price?: number
  currency: string
  inStock: boolean
  imageUrl: string
  productUrl: string
} {
  const mapped = mapMagentoProduct(item, {}, [])
  return {
    price: mapped.price,
    currency: mapped.currency,
    inStock: mapped.inStock,
    imageUrl: mapped.imageUrl,
    productUrl: mapped.productUrl,
  }
}

export interface SyncEmbeddingsResult {
  scanned: number
  upserted: number
  skipped: number
  failed: number
  totalCount: number
  errors: string[]
}

async function embedAndUpsert(item: MagentoCatalogSyncItem): Promise<void> {
  const searchText = buildSearchText(item)
  const embedding = await embedText(searchText)
  const fields = catalogCardFields(item)
  await upsertProductEmbedding({
    sku: item.sku,
    magentoId: item.id != null ? String(item.id) : undefined,
    name: item.name.trim(),
    searchText,
    price: fields.price,
    currency: fields.currency,
    inStock: fields.inStock,
    imageUrl: fields.imageUrl,
    productUrl: fields.productUrl,
    embeddingLiteral: toPgVectorLiteral(embedding),
    embeddingModel: config.context.embeddingModel,
  })
}

/**
 * Magento catalog → Ollama BGE-M3 → Postgres product_embeddings.
 *
 * Embedding is the bottleneck (CPU inference), so items are embedded in
 * parallel batches. Already-indexed SKUs are skipped unless `force` is set,
 * which makes an interrupted run resumable.
 */
export async function syncProductEmbeddings(options?: {
  concurrency?: number
  force?: boolean
  onProgress?: (info: {
    page: number
    scanned: number
    upserted: number
    skipped: number
    totalCount: number
  }) => void
}): Promise<SyncEmbeddingsResult> {
  const concurrency = Math.max(1, options?.concurrency ?? config.semantic.syncConcurrency)
  const force = options?.force ?? false

  let scanned = 0
  let upserted = 0
  let skipped = 0
  let failed = 0
  let totalCount = 0
  const errors: string[] = []

  const alreadyIndexed = force ? new Set<string>() : await listEmbeddedSkus()

  for await (const page of iterateMagentoCatalogForSync()) {
    totalCount = page.totalCount

    const pending = page.items.filter((item) => {
      if (!item.sku || !item.name) return false
      scanned += 1
      if (alreadyIndexed.has(item.sku)) {
        skipped += 1
        return false
      }
      return true
    })

    for (let i = 0; i < pending.length; i += concurrency) {
      const batch = pending.slice(i, i + concurrency)
      await Promise.all(
        batch.map(async (item) => {
          try {
            await embedAndUpsert(item)
            upserted += 1
          } catch (error) {
            failed += 1
            const msg =
              error instanceof Error ? error.message : 'unknown embedding error'
            if (errors.length < 10) {
              errors.push(`${item.sku}: ${msg}`)
            }
            console.error(`[semantic:sync] ${item.sku}:`, msg)
          }
        }),
      )
    }

    options?.onProgress?.({
      page: page.page,
      scanned,
      upserted,
      skipped,
      totalCount,
    })
  }

  return { scanned, upserted, skipped, failed, totalCount, errors }
}

export function buildSemanticQueryText(filters: ProductFilters): string {
  const precise = buildSearchQuery(filters, { mode: 'precise' })
  const broad = buildSearchQuery(filters, { mode: 'broad' })
  const query = String(filters.query ?? '').trim()
  return [query, precise, broad]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface SemanticHit {
  sku: string
  similarity: number
  row: ProductEmbeddingRow
}

/**
 * Vector search over indexed products. Returns SKUs + similarity only;
 * callers rehydrate live Magento cards via fetchProductsBySku.
 */
export async function searchSemanticProducts(
  filters: ProductFilters,
  options?: { minScore?: number; limit?: number },
): Promise<SemanticHit[]> {
  const text = buildSemanticQueryText(filters)
  if (!text) return []

  const embedding = await embedText(text)
  const rows = await searchProductEmbeddings({
    embeddingLiteral: toPgVectorLiteral(embedding),
    minScore: options?.minScore ?? config.semantic.minScore,
    limit: options?.limit ?? config.semantic.topK,
  })

  return rows.map((row) => ({
    sku: row.sku,
    similarity: Number(row.similarity ?? 0),
    row,
  }))
}

/**
 * Turn semantic hits into live Magento CatalogProduct cards.
 * Snapshot rows are only used when Magento no longer returns the SKU.
 */
export async function hydrateSemanticHits(
  hits: SemanticHit[],
  filters: ProductFilters,
): Promise<CatalogProduct[]> {
  if (hits.length === 0) return []

  const live = await fetchProductsBySku(hits.map((h) => h.sku))
  const products: CatalogProduct[] = []

  for (const hit of hits) {
    const item = live.get(hit.sku)
    if (item) {
      const card = mapMagentoProduct(item, filters, [])
      const pct = Math.round(hit.similarity * 100)
      card.reasons = [
        `Semantic match ~${pct}%`,
        ...card.reasons.filter((r) => !r.startsWith('Matched your Magento')),
      ].slice(0, 4)
      products.push(card)
      continue
    }

    // Fallback to indexed snapshot so sync'd SKUs still appear if Magento blips
    const row = hit.row
    const pct = Math.round(hit.similarity * 100)
    products.push({
      id: row.magento_id ?? row.sku,
      sku: row.sku,
      name: row.name,
      price: Number(row.price ?? 0) || 0,
      currency: row.currency || 'USD',
      imageUrl: row.image_url ?? '',
      productUrl: row.product_url || '#',
      reasons: [`Semantic match ~${pct}%`, 'From product embedding index'],
      inStock: row.in_stock,
    })
  }

  return products
}

export async function getSemanticIndexStatus() {
  return countProductEmbeddings()
}
