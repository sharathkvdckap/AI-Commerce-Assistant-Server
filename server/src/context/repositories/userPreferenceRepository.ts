import { getContextPool } from '../db.js'
import type { JsonObject, UserPreferencesRow } from '../types.js'

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function mapPreferenceRow(row: Record<string, unknown>): UserPreferencesRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    preferred_brands: asStringArray(row.preferred_brands),
    budget: (row.budget as JsonObject) ?? {},
    sizes: asStringArray(row.sizes),
    colours: asStringArray(row.colours),
    categories: asStringArray(row.categories),
    material: asStringArray(row.material),
    gender: (row.gender as string | null) ?? null,
    shopping_style: (row.shopping_style as string | null) ?? null,
    favourite_products: Array.isArray(row.favourite_products)
      ? row.favourite_products
      : [],
    frequently_purchased_cats: asStringArray(row.frequently_purchased_cats),
    extra: (row.extra as JsonObject) ?? {},
    created_at: row.created_at as Date,
    updated_at: row.updated_at as Date,
  }
}

export async function getUserPreferences(
  userId: string,
): Promise<UserPreferencesRow | null> {
  const pool = getContextPool()
  const result = await pool.query(
    `SELECT * FROM user_preferences
     WHERE user_id = $1 AND is_deleted = FALSE`,
    [userId],
  )
  if (!result.rows[0]) return null
  return mapPreferenceRow(result.rows[0] as Record<string, unknown>)
}

export async function upsertUserPreferences(input: {
  userId: string
  preferredBrands?: string[]
  budget?: JsonObject
  sizes?: string[]
  colours?: string[]
  categories?: string[]
  material?: string[]
  gender?: string | null
  shoppingStyle?: string | null
  favouriteProducts?: unknown[]
  frequentlyPurchasedCats?: string[]
  extra?: JsonObject
  actor?: string
}): Promise<UserPreferencesRow> {
  const pool = getContextPool()
  const existing = await getUserPreferences(input.userId)

  const mergeUnique = (prev: string[], next?: string[]) => {
    if (!next?.length) return prev
    return [...new Set([...prev, ...next].map((s) => s.trim()).filter(Boolean))]
  }

  const preferredBrands = mergeUnique(
    existing?.preferred_brands ?? [],
    input.preferredBrands,
  )
  const sizes = mergeUnique(existing?.sizes ?? [], input.sizes)
  const colours = mergeUnique(existing?.colours ?? [], input.colours)
  const categories = mergeUnique(existing?.categories ?? [], input.categories)
  const material = mergeUnique(existing?.material ?? [], input.material)
  const frequentlyPurchasedCats = mergeUnique(
    existing?.frequently_purchased_cats ?? [],
    input.frequentlyPurchasedCats,
  )
  const budget = {
    ...(existing?.budget ?? {}),
    ...(input.budget ?? {}),
  }
  const favouriteProducts = [
    ...(existing?.favourite_products ?? []),
    ...(input.favouriteProducts ?? []),
  ]
  const extra = {
    ...(existing?.extra ?? {}),
    ...(input.extra ?? {}),
  }

  const result = await pool.query(
    `INSERT INTO user_preferences (
       user_id, preferred_brands, budget, sizes, colours, categories, material,
       gender, shopping_style, favourite_products, frequently_purchased_cats,
       extra, created_by, updated_by
     ) VALUES (
       $1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb,
       $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $13
     )
     ON CONFLICT (user_id) DO UPDATE SET
       preferred_brands = EXCLUDED.preferred_brands,
       budget = EXCLUDED.budget,
       sizes = EXCLUDED.sizes,
       colours = EXCLUDED.colours,
       categories = EXCLUDED.categories,
       material = EXCLUDED.material,
       gender = COALESCE(EXCLUDED.gender, user_preferences.gender),
       shopping_style = COALESCE(EXCLUDED.shopping_style, user_preferences.shopping_style),
       favourite_products = EXCLUDED.favourite_products,
       frequently_purchased_cats = EXCLUDED.frequently_purchased_cats,
       extra = EXCLUDED.extra,
       is_deleted = FALSE,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [
      input.userId,
      JSON.stringify(preferredBrands),
      JSON.stringify(budget),
      JSON.stringify(sizes),
      JSON.stringify(colours),
      JSON.stringify(categories),
      JSON.stringify(material),
      input.gender ?? existing?.gender ?? null,
      input.shoppingStyle ?? existing?.shopping_style ?? null,
      JSON.stringify(favouriteProducts),
      JSON.stringify(frequentlyPurchasedCats),
      JSON.stringify(extra),
      input.actor ?? input.userId,
    ],
  )

  return mapPreferenceRow(result.rows[0] as Record<string, unknown>)
}

export async function softDeletePreferencesForUser(
  userId: string,
): Promise<number> {
  const pool = getContextPool()
  const result = await pool.query(
    `UPDATE user_preferences
     SET is_deleted = TRUE, updated_at = NOW(), updated_by = $1
     WHERE user_id = $1 AND is_deleted = FALSE`,
    [userId],
  )
  return result.rowCount ?? 0
}
