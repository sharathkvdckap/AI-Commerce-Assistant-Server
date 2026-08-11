import {
  insertProductEvents,
  insertSearchAnalytics,
  isAnalyticsConfigured,
  type ProductEventInput,
  type SearchAnalyticsInput,
} from './repository.js'

/**
 * Fire-and-forget search analytics. Never throws to callers.
 */
export async function trackSearchAnalytics(
  input: SearchAnalyticsInput,
): Promise<string | null> {
  if (!isAnalyticsConfigured()) return null
  try {
    return await insertSearchAnalytics(input)
  } catch (error) {
    console.warn(
      '[analytics] search log failed',
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

export async function trackProductEvents(
  events: ProductEventInput[],
): Promise<number> {
  if (!isAnalyticsConfigured() || events.length === 0) return 0
  try {
    return await insertProductEvents(events)
  } catch (error) {
    console.warn(
      '[analytics] product events failed',
      error instanceof Error ? error.message : error,
    )
    return 0
  }
}

export {
  getAnalyticsSummary,
  isAnalyticsConfigured,
  listRecentSearches,
  type ProductEventInput,
  type SearchAnalyticsInput,
} from './repository.js'
