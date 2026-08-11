import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchAnalyticsSearches,
  fetchAnalyticsSummary,
  type AnalyticsSearchRow,
  type AnalyticsSummary,
} from '@/api/analytics'
import { AssistantHeader } from '@/components/assistant/AssistantHeader'
import { Button } from '@/components/ui/button'

function pct(n: number) {
  return `${(n * 100).toFixed(0)}%`
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface-elevated p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </p>
      <p className="mt-2 font-display text-3xl text-ink">{value}</p>
      {hint ? <p className="mt-1 text-sm text-ink-muted">{hint}</p> : null}
    </div>
  )
}

/** One product: “shown → opened” in plain language. */
function ProductFunnelCard({
  rank,
  name,
  sku,
  impressions,
  clicks,
  ctr,
}: {
  rank: number
  name: string | null
  sku: string
  impressions: number
  clicks: number
  ctr: number
}) {
  const shown = Math.max(impressions, clicks)
  const fill = shown > 0 ? Math.min(100, (clicks / shown) * 100) : 0

  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{name || sku}</p>
          {name ? (
            <p className="truncate font-mono text-[11px] text-ink-faint">{sku}</p>
          ) : null}
          <p className="mt-2 text-sm text-ink-muted">
            Shown <strong className="text-ink">{impressions}</strong> times
            <span className="mx-1.5 text-ink-faint">→</span>
            Opened <strong className="text-ink">{clicks}</strong> times
            <span className="ml-2 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">
              {pct(ctr)} opened
            </span>
          </p>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-border"
            title={`${clicks} of ${shown} opened`}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${fill}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function SearchesPager({
  page,
  totalPages,
  total,
  loading,
  onPage,
}: {
  page: number
  totalPages: number
  total: number
  loading: boolean
  onPage: (page: number) => void
}) {
  if (total <= SEARCHES_PAGE_SIZE) return null
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={page <= 1 || loading}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </Button>
      <span className="text-sm text-ink-muted">
        Page {page} of {totalPages}
      </span>
      <Button
        type="button"
        variant="outline"
        disabled={page >= totalPages || loading}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </div>
  )
}

const SEARCHES_PAGE_SIZE = 10

export function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [searches, setSearches] = useState<AnalyticsSearchRow[]>([])
  const [searchesPage, setSearchesPage] = useState(1)
  const [searchesTotal, setSearchesTotal] = useState(0)
  const [searchesTotalPages, setSearchesTotalPages] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchesLoading, setSearchesLoading] = useState(false)

  const loadSummary = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const s = await fetchAnalyticsSummary(days)
      if (!s) {
        setError(
          'Analytics unavailable. Set DATABASE_URL and run: cd server && npm run db:migrate:analytics',
        )
        setSummary(null)
      } else {
        setSummary(s)
      }
    } catch {
      setError('Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [days])

  const loadSearches = useCallback(async (page: number) => {
    setSearchesLoading(true)
    try {
      const result = await fetchAnalyticsSearches(page, SEARCHES_PAGE_SIZE)
      setSearches(result.searches)
      setSearchesPage(result.page)
      setSearchesTotal(result.total)
      setSearchesTotalPages(result.totalPages)
    } catch {
      setSearches([])
    } finally {
      setSearchesLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSummary()
    setSearchesPage(1)
    void loadSearches(1)
  }, [loadSummary, loadSearches])

  const refreshAll = () => {
    void loadSummary()
    void loadSearches(searchesPage)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AssistantHeader />
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-6xl space-y-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm text-ink-muted">
                <Link to="/ai-assistant" className="text-accent hover:underline">
                  ← Assistant
                </Link>
              </p>
              <h1 className="font-display text-4xl text-ink">
                Search analytics
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-ink-muted">
                What shoppers searched, Magento vs hybrid lift, zero-result rate,
                and product CTR — data marketing needs for ROI.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {[7, 30, 90].map((d) => (
                <Button
                  key={d}
                  type="button"
                  variant={days === d ? 'default' : 'outline'}
                  onClick={() => setDays(d)}
                >
                  {d}d
                </Button>
              ))}
              <Button type="button" variant="outline" onClick={refreshAll}>
                Refresh
              </Button>
            </div>
          </div>

          {loading && (
            <p className="text-sm text-ink-muted">Loading metrics…</p>
          )}
          {error && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {error}
            </div>
          )}

          {summary && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  label="Searches"
                  value={String(summary.totalSearches)}
                  hint={`${summary.uniqueUsers} unique user ids`}
                />
                <MetricCard
                  label="Zero-result rate"
                  value={pct(summary.zeroResultRate)}
                  hint={`${summary.zeroResultCount} empty searches`}
                />
                <MetricCard
                  label="Hybrid / semantic share"
                  value={pct(summary.hybridLiftShare)}
                  hint={`${summary.hybridOrSemanticCount} hybrid+semantic · ${summary.magentoOnlyCount} Magento-only`}
                />
                <MetricCard
                  label="CTR"
                  value={pct(summary.ctr)}
                  hint={`${summary.clicks} clicks / ${summary.impressions} impressions`}
                />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-2xl border border-border bg-surface-elevated p-5">
                  <h2 className="font-display text-2xl text-ink">
                    What people searched
                  </h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    Top 5 queries (most common first)
                  </p>
                  <ul className="mt-4 space-y-2">
                    {summary.topQueries.slice(0, 5).map((row, i) => (
                      <li
                        key={row.query}
                        className="flex items-center gap-3 rounded-xl border border-border/70 bg-surface px-3 py-2.5"
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-border/80 text-xs font-semibold text-ink-muted">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">
                            {row.query}
                          </p>
                          <p className="text-xs text-ink-muted">
                            {row.count} search{row.count === 1 ? '' : 'es'}
                            {row.zeroResults > 0
                              ? ` · ${row.zeroResults} empty`
                              : ''}
                          </p>
                        </div>
                      </li>
                    ))}
                    {summary.topQueries.length === 0 && (
                      <li className="py-6 text-center text-sm text-ink-muted">
                        No searches yet — run a few assistant queries.
                      </li>
                    )}
                  </ul>
                </section>

                <section className="rounded-2xl border border-border bg-surface-elevated p-5">
                  <h2 className="font-display text-2xl text-ink">
                    Products people opened
                  </h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    Top 5 — how often a card was shown vs opened (View Product)
                  </p>
                  <div className="mt-4 space-y-3">
                    {summary.topClickedSkus.map((row, i) => (
                      <ProductFunnelCard
                        key={row.sku}
                        rank={i + 1}
                        name={row.name}
                        sku={row.sku}
                        impressions={row.impressions}
                        clicks={row.clicks}
                        ctr={row.ctr}
                      />
                    ))}
                    {summary.topClickedSkus.length === 0 && (
                      <p className="py-6 text-center text-sm text-ink-muted">
                        No product opens yet — run a search and click View
                        Product.
                      </p>
                    )}
                  </div>
                </section>
              </div>

              <section className="rounded-2xl border border-border bg-surface-elevated p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="font-display text-2xl text-ink">
                      Latest searches
                    </h2>
                    <p className="mt-1 text-sm text-ink-muted">
                      {searchesTotal === 0
                        ? 'No searches yet'
                        : `${searchesTotal} total · ${SEARCHES_PAGE_SIZE} per page`}
                      {' — '}
                      query, source, match type, product counts, full user id
                    </p>
                  </div>
                  <SearchesPager
                    page={searchesPage}
                    totalPages={searchesTotalPages}
                    total={searchesTotal}
                    loading={searchesLoading}
                    onPage={(p) => void loadSearches(p)}
                  />
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[800px] text-left text-sm">
                    <thead className="text-xs uppercase text-ink-faint">
                      <tr>
                        <th className="pb-2 pr-3 font-medium">When</th>
                        <th className="pb-2 pr-3 font-medium">Query</th>
                        <th className="pb-2 pr-3 font-medium">Source</th>
                        <th className="pb-2 pr-3 font-medium">Match type</th>
                        <th className="pb-2 pr-3 font-medium">Products</th>
                        <th className="pb-2 pr-3 font-medium">Alternatives</th>
                        <th className="pb-2 font-medium">User id</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchesLoading && searches.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="py-6 text-center text-ink-muted"
                          >
                            Loading…
                          </td>
                        </tr>
                      ) : null}
                      {searches.map((row) => (
                        <tr
                          key={row.id}
                          className="border-t border-border/70 align-top"
                        >
                          <td className="py-2.5 pr-3 whitespace-nowrap text-xs text-ink-muted">
                            {new Date(row.createdAt).toLocaleString()}
                          </td>
                          <td className="py-2.5 pr-3 font-medium text-ink">
                            {row.query}
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">
                              {row.source ?? '—'}
                              {row.fromMemory ? ' · memory' : ''}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 text-ink-muted">
                            {row.matchType ?? '—'}
                          </td>
                          <td className="py-2.5 pr-3">
                            {row.isZeroResult && row.productCount === 0
                              ? '0'
                              : row.productCount}
                          </td>
                          <td className="py-2.5 pr-3">{row.alternativeCount}</td>
                          <td className="py-2.5 font-mono text-[11px] break-all text-ink-muted">
                            {row.userId}
                          </td>
                        </tr>
                      ))}
                      {!searchesLoading && searches.length === 0 && (
                        <tr>
                          <td
                            colSpan={7}
                            className="py-6 text-center text-ink-muted"
                          >
                            No rows yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex justify-end">
                  <SearchesPager
                    page={searchesPage}
                    totalPages={searchesTotalPages}
                    total={searchesTotal}
                    loading={searchesLoading}
                    onPage={(p) => void loadSearches(p)}
                  />
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
