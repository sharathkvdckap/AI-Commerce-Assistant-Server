import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { PendingContextReuse } from '@/types/context'

interface ContextReuseCardProps {
  pending: PendingContextReuse
  disabled?: boolean
  onContinue: () => void
  onStartNew: () => void
}

function pickDisplayValue(
  filters: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = filters[key]
    if (value != null && String(value).trim()) return String(value)
  }
  return null
}

export function ContextReuseCard({
  pending,
  disabled = false,
  onContinue,
  onStartNew,
}: ContextReuseCardProps) {
  const filters = pending.match.filters ?? {}
  const rows: Array<{ label: string; value: string }> = []

  const budget = pickDisplayValue(filters, ['budget', 'price_max', 'price_min'])
  const brand = pickDisplayValue(filters, ['brand'])
  const size = pickDisplayValue(filters, ['size'])
  const colour = pickDisplayValue(filters, ['color', 'colour'])
  const gender = pickDisplayValue(filters, ['gender'])
  const category = pickDisplayValue(filters, ['category', 'usage'])

  if (budget) rows.push({ label: 'Budget', value: budget })
  if (brand) rows.push({ label: 'Brand', value: brand })
  if (size) rows.push({ label: 'Size', value: size })
  if (colour) rows.push({ label: 'Colour', value: colour })
  if (gender) rows.push({ label: 'Gender', value: gender })
  if (category) rows.push({ label: 'Category', value: category })

  if (
    pending.preferences?.budget &&
    typeof pending.preferences.budget === 'object' &&
    !budget
  ) {
    const label = (pending.preferences.budget as { label?: string }).label
    if (label) rows.push({ label: 'Budget', value: label })
  }

  return (
    <Card className="animate-fade-up ml-0 border-accent/25 bg-accent-soft/30 shadow-none sm:ml-11">
      <CardContent className="space-y-4 pt-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Previous Shopping Session
          </p>
          <p className="mt-1 font-display text-xl text-ink">
            {pending.match.originalQuery}
          </p>
          {pending.match.summary && (
            <p className="mt-2 text-sm text-ink-muted">{pending.match.summary}</p>
          )}
          <p className="mt-2 text-xs text-ink-faint">
            Similarity {(pending.similarity * 100).toFixed(0)}% · choose before
            we continue
          </p>
        </div>

        {rows.length > 0 && (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="flex gap-2">
                <dt className="text-ink-muted">{row.label}:</dt>
                <dd className="font-medium text-ink">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            disabled={disabled}
            onClick={onContinue}
            className="sm:flex-1"
          >
            Continue Previous Search
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={onStartNew}
            className="sm:flex-1"
          >
            Start New Search
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
