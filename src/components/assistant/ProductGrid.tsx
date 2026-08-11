import { useEffect, useRef } from 'react'
import { ProductCard } from '@/components/assistant/ProductCard'
import { trackImpressions } from '@/api/analytics'
import type { ProductRecommendation } from '@/types/assistant'

interface ProductGridProps {
  products: ProductRecommendation[]
  alternatives?: ProductRecommendation[]
  source?: 'magento' | 'semantic' | 'hybrid' | null
  matchType?: 'exact' | 'recommended' | 'mixed' | 'none' | null
  sessionId?: string | null
  searchId?: string | null
}

export function ProductGrid({
  products,
  alternatives = [],
  source,
  matchType,
  sessionId,
  searchId,
}: ProductGridProps) {
  const hasMatches = products.length > 0
  const hasAlternatives = alternatives.length > 0
  const impressedKey = useRef<string | null>(null)

  useEffect(() => {
    if (!hasMatches && !hasAlternatives) return
    const key = `${searchId ?? sessionId ?? 'none'}:${products.map((p) => p.sku).join(',')}:${alternatives.map((p) => p.sku).join(',')}`
    if (impressedKey.current === key) return
    impressedKey.current = key
    trackImpressions({
      sessionId,
      searchId,
      source,
      products,
      alternatives,
    })
  }, [
    alternatives,
    hasAlternatives,
    hasMatches,
    products,
    searchId,
    sessionId,
    source,
  ])

  const matchTitle =
    matchType === 'recommended' && !hasMatches
      ? 'Recommended Products'
      : 'Matching Products'

  const matchSourceLabel =
    matchType === 'recommended' && !hasMatches
      ? source === 'semantic'
        ? 'Semantic (pgvector) recommendations — Magento had no keyword match'
        : 'Related Magento recommendations (no exact match)'
      : source === 'hybrid'
        ? 'Hybrid: Magento GraphQL + pgvector semantic search'
        : source === 'semantic'
          ? 'Semantic matches from indexed Magento catalog (pgvector)'
          : source === 'magento'
            ? 'Live Magento catalog (from Magento database via GraphQL)'
            : 'Product catalog'

  return (
    <div className="space-y-8">
      {hasMatches && (
        <section className="animate-fade-up ml-0 space-y-4 sm:ml-11">
          <div>
            <h2 className="font-display text-2xl text-ink">{matchTitle}</h2>
            <p className="mt-1 text-sm text-ink-muted">{matchSourceLabel}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product, position) => (
              <ProductCard
                key={product.id}
                product={product}
                listType="primary"
                position={position}
                sessionId={sessionId}
                searchId={searchId}
                source={source}
              />
            ))}
          </div>
        </section>
      )}

      {hasAlternatives && (
        <section className="animate-fade-up ml-0 space-y-4 sm:ml-11">
          <div>
            <h2 className="font-display text-2xl text-ink">
              {hasMatches ? 'Alternative Recommendations' : 'Recommended Products'}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {hasMatches
                ? 'Related products from the Magento catalog'
                : 'Related Magento recommendations (no exact match)'}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {alternatives.map((product, position) => (
              <ProductCard
                key={`alt-${product.id}`}
                product={product}
                listType="alternative"
                position={position}
                sessionId={sessionId}
                searchId={searchId}
                source={source}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
