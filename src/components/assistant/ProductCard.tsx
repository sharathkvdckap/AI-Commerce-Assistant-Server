import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { trackProductClick, withAssistantAttribution } from '@/api/analytics'
import type { ProductRecommendation } from '@/types/assistant'

interface ProductCardProps {
  product: ProductRecommendation
  listType?: 'primary' | 'alternative'
  position?: number
  sessionId?: string | null
  searchId?: string | null
  source?: string | null
}

function formatPrice(price: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(price)
}

export function ProductCard({
  product,
  listType = 'primary',
  position,
  sessionId,
  searchId,
  source,
}: ProductCardProps) {
  const inStock = product.inStock !== false

  const openProduct = () => {
    trackProductClick({
      sessionId,
      searchId,
      source,
      product,
      listType,
      position,
    })
    if (product.productUrl !== '#') {
      window.open(
        withAssistantAttribution(product.productUrl, {
          sku: product.sku,
          searchId,
          sessionId,
          source,
        }),
        '_blank',
        'noopener,noreferrer',
      )
    }
  }

  return (
    <Card
      className={`animate-fade-up overflow-hidden transition-shadow hover:shadow-md ${
        inStock ? '' : 'opacity-90'
      }`}
    >
      <div className="aspect-[4/5] overflow-hidden bg-border/40">
        <img
          src={product.imageUrl}
          alt={product.name}
          className={`size-full object-cover transition-transform duration-500 hover:scale-105 ${
            inStock ? '' : 'grayscale-[35%]'
          }`}
          loading="lazy"
        />
      </div>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-ink-faint">{product.sku}</p>
            <h3
              className={`mt-0.5 text-[15px] font-semibold leading-snug ${
                inStock ? 'text-ink' : 'text-red-700'
              }`}
            >
              {product.name}
            </h3>
          </div>
          {inStock ? (
            <Badge>In stock</Badge>
          ) : (
            <Badge className="border-red-200 bg-red-50 text-red-700">
              Out of Stock
            </Badge>
          )}
        </div>

        {inStock ? (
          <p className="text-lg font-semibold text-accent">
            {formatPrice(product.price, product.currency)}
          </p>
        ) : (
          <p className="text-sm font-semibold uppercase tracking-wide text-red-700">
            Out of Stock
          </p>
        )}

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">
            Why recommended
          </p>
          <ul className="space-y-1">
            {product.reasons.map((reason) => (
              <li
                key={reason}
                className="flex items-start gap-2 text-sm text-ink-muted"
              >
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" />
                {reason}
              </li>
            ))}
          </ul>
        </div>

        <Button className="mt-1 w-full" onClick={openProduct}>
          View Product
          <ExternalLink className="size-3.5 opacity-80" />
        </Button>
      </CardContent>
    </Card>
  )
}
