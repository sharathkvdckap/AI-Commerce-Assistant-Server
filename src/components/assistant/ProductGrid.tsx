import { ProductCard } from '@/components/assistant/ProductCard'
import type { ProductRecommendation } from '@/types/assistant'

interface ProductGridProps {
  products: ProductRecommendation[]
  alternatives?: ProductRecommendation[]
  source?: 'magento' | 'semantic' | 'hybrid' | null
  matchType?: 'exact' | 'recommended' | 'mixed' | 'none' | null
}

export function ProductGrid({
  products,
  alternatives = [],
  source,
  matchType,
}: ProductGridProps) {
  const hasMatches = products.length > 0
  const hasAlternatives = alternatives.length > 0

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
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
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
            {alternatives.map((product) => (
              <ProductCard key={`alt-${product.id}`} product={product} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
