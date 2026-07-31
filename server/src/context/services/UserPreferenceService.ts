import {
  getUserPreferences,
  softDeletePreferencesForUser,
  upsertUserPreferences,
} from '../repositories/userPreferenceRepository.js'
import type { JsonObject, UserPreferencesRow } from '../types.js'

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return undefined
}

/**
 * Derives preference fields from session filters and merges into user_preferences.
 */
export class UserPreferenceService {
  async getPreferences(userId: string): Promise<UserPreferencesRow | null> {
    return getUserPreferences(userId)
  }

  async updateFromFilters(
    userId: string,
    filters: JsonObject,
    actor?: string,
  ): Promise<UserPreferencesRow> {
    const brand = asString(filters.brand)
    const size = asString(filters.size)
    const colour = asString(filters.color) ?? asString(filters.colour)
    const category =
      asString(filters.category) ?? asString(filters.keywords as unknown)
    const material = asString(filters.material)
    const gender = asString(filters.gender)
    const shoppingStyle =
      asString(filters.fit) ?? asString(filters.usage) ?? asString(filters.style)
    const budgetValue =
      asString(filters.budget) ??
      asString(filters.price_max) ??
      asString(filters.price_min)

    return upsertUserPreferences({
      userId,
      preferredBrands: brand ? [brand] : undefined,
      sizes: size ? [size] : undefined,
      colours: colour ? [colour] : undefined,
      categories: category ? [category] : undefined,
      material: material ? [material] : undefined,
      gender: gender ?? null,
      shoppingStyle: shoppingStyle ?? null,
      budget: budgetValue
        ? {
            label: budgetValue,
            price_min: filters.price_min ?? null,
            price_max: filters.price_max ?? null,
          }
        : undefined,
      frequentlyPurchasedCats: category ? [category] : undefined,
      actor: actor ?? userId,
    })
  }

  async clear(userId: string): Promise<void> {
    await softDeletePreferencesForUser(userId)
  }
}

export const userPreferenceService = new UserPreferenceService()
