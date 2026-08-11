import { getDbPool } from '../context/db.js'

export interface ProductEmbeddingRow {
  sku: string
  magento_id: string | null
  name: string
  search_text: string
  price: number | null
  currency: string
  in_stock: boolean
  image_url: string | null
  product_url: string | null
  similarity?: number
}

export async function upsertProductEmbedding(input: {
  sku: string
  magentoId?: string
  name: string
  searchText: string
  price?: number
  currency?: string
  inStock?: boolean
  imageUrl?: string
  productUrl?: string
  embeddingLiteral: string
  embeddingModel: string
}): Promise<void> {
  const pool = getDbPool()
  await pool.query(
    `INSERT INTO product_embeddings (
       sku, magento_id, name, search_text, price, currency, in_stock,
       image_url, product_url, embedding, embedding_model, synced_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10::vector, $11, NOW(), NOW()
     )
     ON CONFLICT (sku) DO UPDATE SET
       magento_id = EXCLUDED.magento_id,
       name = EXCLUDED.name,
       search_text = EXCLUDED.search_text,
       price = EXCLUDED.price,
       currency = EXCLUDED.currency,
       in_stock = EXCLUDED.in_stock,
       image_url = EXCLUDED.image_url,
       product_url = EXCLUDED.product_url,
       embedding = EXCLUDED.embedding,
       embedding_model = EXCLUDED.embedding_model,
       synced_at = NOW(),
       updated_at = NOW()`,
    [
      input.sku,
      input.magentoId ?? null,
      input.name,
      input.searchText,
      input.price ?? null,
      input.currency ?? 'USD',
      input.inStock ?? true,
      input.imageUrl ?? null,
      input.productUrl ?? null,
      input.embeddingLiteral,
      input.embeddingModel,
    ],
  )
}

export async function searchProductEmbeddings(input: {
  embeddingLiteral: string
  minScore: number
  limit: number
}): Promise<ProductEmbeddingRow[]> {
  const pool = getDbPool()
  const result = await pool.query<ProductEmbeddingRow>(
    `SELECT
       sku, magento_id, name, search_text, price, currency, in_stock,
       image_url, product_url,
       (1 - (embedding <=> $1::vector))::float8 AS similarity
     FROM product_embeddings
     WHERE embedding IS NOT NULL
       AND (1 - (embedding <=> $1::vector)) >= $2
     ORDER BY embedding <=> $1::vector ASC
     LIMIT $3`,
    [input.embeddingLiteral, input.minScore, input.limit],
  )
  return result.rows
}

/** SKUs that already have a vector, used to resume interrupted syncs. */
export async function listEmbeddedSkus(): Promise<Set<string>> {
  const pool = getDbPool()
  const result = await pool.query<{ sku: string }>(
    `SELECT sku FROM product_embeddings WHERE embedding IS NOT NULL`,
  )
  return new Set(result.rows.map((row) => row.sku))
}

export async function countProductEmbeddings(): Promise<{
  total: number
  withEmbedding: number
}> {
  const pool = getDbPool()
  const result = await pool.query<{ total: string; embedded: string }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(embedding)::text AS embedded
     FROM product_embeddings`,
  )
  return {
    total: Number(result.rows[0]?.total ?? 0),
    withEmbedding: Number(result.rows[0]?.embedded ?? 0),
  }
}
