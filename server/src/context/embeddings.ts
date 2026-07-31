import { config } from '../config/env.js'

/**
 * Embed text via Ollama (BGE-M3 → 1024 dims) for user search-history similarity.
 */
export async function embedText(text: string): Promise<number[]> {
  const prompt = text.trim()
  if (!prompt) {
    throw new Error('Cannot embed empty text')
  }

  const url = `${config.ollama.baseUrl.replace(/\/$/, '')}/api/embeddings`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.context.embeddingModel,
      prompt,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `Ollama embeddings failed (${res.status}): ${body.slice(0, 200)}`,
    )
  }

  const data = (await res.json()) as { embedding?: number[] }
  const embedding = data.embedding
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Ollama returned empty embedding')
  }

  if (
    config.context.embeddingDims > 0 &&
    embedding.length !== config.context.embeddingDims
  ) {
    throw new Error(
      `Embedding dim mismatch: got ${embedding.length}, expected ${config.context.embeddingDims}`,
    )
  }

  return embedding
}

export function toPgVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}
