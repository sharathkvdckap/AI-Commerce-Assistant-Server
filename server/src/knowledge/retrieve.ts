import { config, isSheetRagConfigured } from '../config/env.js'
import { embedText, toPgVectorLiteral } from '../context/embeddings.js'
import {
  listSheetChunksBySku,
  searchSheetChunks,
  type SheetChunkRow,
} from './repository.js'

const MAX_SHOPPER_BULLETS = 3
const MAX_BULLET_CHARS = 280
const MAX_PROMPT_CHARS = 1800

export interface KnowledgeHit {
  id: string
  topic: string
  sku: string
  content: string
  similarity: number
}

function toHit(row: SheetChunkRow): KnowledgeHit {
  return {
    id: row.id,
    topic: (row.topic ?? '').trim(),
    sku: (row.sku ?? '').trim(),
    content: row.content,
    similarity: Number(row.similarity ?? 0),
  }
}

function mergeHits(rows: SheetChunkRow[]): KnowledgeHit[] {
  const byId = new Map<string, KnowledgeHit>()
  for (const row of rows) {
    const hit = toHit(row)
    const existing = byId.get(hit.id)
    if (!existing || hit.similarity > existing.similarity) {
      byId.set(hit.id, hit)
    }
  }
  return [...byId.values()].sort((a, b) => b.similarity - a.similarity)
}

export async function retrieveSheetChunks(
  query: string,
  options?: { skus?: string[]; limit?: number; minScore?: number },
): Promise<KnowledgeHit[]> {
  if (!isSheetRagConfigured()) return []
  const text = query.trim()
  const skus = options?.skus ?? []
  if (!text && skus.length === 0) return []

  const limit = options?.limit ?? config.sheetRag.topK
  const minScore = options?.minScore ?? config.sheetRag.minScore
  const rows: SheetChunkRow[] = []

  if (skus.length > 0) {
    rows.push(...(await listSheetChunksBySku(skus)))
  }

  if (text) {
    const embedding = await embedText(text)
    rows.push(
      ...(await searchSheetChunks({
        embeddingLiteral: toPgVectorLiteral(embedding),
        minScore,
        limit,
      })),
    )
  }

  return mergeHits(rows).slice(0, limit)
}

/** Never throw into the chat path — knowledge is optional. */
export async function retrieveSheetChunksSafe(
  query: string,
  options?: { skus?: string[] },
): Promise<KnowledgeHit[]> {
  try {
    return await retrieveSheetChunks(query, options)
  } catch (error) {
    console.warn(
      '[knowledge] retrieve failed',
      error instanceof Error ? error.message : error,
    )
    return []
  }
}

export function formatKnowledgePrompt(hits: KnowledgeHit[]): string {
  if (hits.length === 0) return ''
  let body = hits
    .map((hit, i) => {
      const pct = Math.round(hit.similarity * 100)
      return `${i + 1}. ${hit.content} (~${pct}%)`
    })
    .join('\n')
  if (body.length > MAX_PROMPT_CHARS) {
    body = `${body.slice(0, MAX_PROMPT_CHARS).trim()}…`
  }
  return `

==============================
MERCHANT KNOWLEDGE (from the store sheet)
==============================

Use only these snippets as extra facts (policies, sizing, compatibility, FAQs).
They are not Magento catalog data. Never invent SKUs, prices, or stock from them.
If a snippet answers the customer, put that answer in "message".
If the question is purely informational, you may clarify with options such as
"Show related products" and "That's all, thanks" instead of searching blindly.
If they want products, still search Magento. You may copy a SKU from a snippet
into search keywords only when it appears below.

${body}
`
}

export function formatKnowledgeForShopper(hits: KnowledgeHit[]): string {
  if (hits.length === 0) return ''
  const bullets = hits.slice(0, MAX_SHOPPER_BULLETS).map((hit) => {
    const label = hit.topic || 'Guide'
    const sku = hit.sku ? ` (${hit.sku})` : ''
    const text = hit.content.length > MAX_BULLET_CHARS
      ? `${hit.content.slice(0, MAX_BULLET_CHARS).trim()}…`
      : hit.content
    return `• ${label}${sku}: ${text}`
  })
  return `From the store guide:\n${bullets.join('\n')}`
}

export function attachKnowledgeMessage(
  message: string | undefined,
  hits: KnowledgeHit[],
): string {
  const note = formatKnowledgeForShopper(hits)
  const base = message?.trim() ?? ''
  if (!note) return base
  if (
    base.includes(note) ||
    base.toLowerCase().includes('from the store guide:')
  ) {
    return base || note
  }
  return base ? `${note}\n\n${base}` : note
}
