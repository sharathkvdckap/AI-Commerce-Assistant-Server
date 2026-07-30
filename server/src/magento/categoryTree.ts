import { magentoGraphql } from './client.js'

export interface MagentoCategoryNode {
  id: number | string
  name: string
  product_count?: number | null
  children?: MagentoCategoryNode[] | null
}

export interface FlatCategory {
  id: string
  name: string
  nameLower: string
  /** Ancestor names + self, e.g. ["Men", "Tops", "Jackets"] */
  path: string[]
  pathLower: string[]
  productCount: number
  hasChildren: boolean
}

interface CategoryListData {
  categoryList: MagentoCategoryNode[]
}

const CATEGORY_QUERY = `
  query CategoryTree {
    categoryList(filters: {}) {
      id
      name
      product_count
      children {
        id
        name
        product_count
        children {
          id
          name
          product_count
          children {
            id
            name
            product_count
            children {
              id
              name
              product_count
            }
          }
        }
      }
    }
  }
`

let cache: { at: number; categories: FlatCategory[] } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

function flatten(
  nodes: MagentoCategoryNode[] | null | undefined,
  ancestors: string[] = [],
  out: FlatCategory[] = [],
): FlatCategory[] {
  for (const node of nodes ?? []) {
    const id = String(node.id)
    const name = (node.name ?? '').trim()
    if (!name) continue

    const path = [...ancestors, name]
    const children = node.children ?? []
    out.push({
      id,
      name,
      nameLower: name.toLowerCase(),
      path,
      pathLower: path.map((p) => p.toLowerCase()),
      productCount: Number(node.product_count ?? 0),
      hasChildren: children.length > 0,
    })
    flatten(children, path, out)
  }
  return out
}

export async function getMagentoCategories(
  forceRefresh = false,
): Promise<FlatCategory[]> {
  if (!forceRefresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.categories
  }

  const data = await magentoGraphql<CategoryListData>(CATEGORY_QUERY)
  const categories = flatten(data.categoryList ?? [])
  cache = { at: Date.now(), categories }
  return categories
}

export function clearCategoryCache(): void {
  cache = null
}

/** Leaf-or-product categories under a matched parent (parent often has 0 products). */
export function expandToProductCategories(
  matched: FlatCategory[],
  all: FlatCategory[],
): FlatCategory[] {
  const byId = new Map(all.map((c) => [c.id, c]))
  const result = new Map<string, FlatCategory>()

  for (const cat of matched) {
    if (cat.productCount > 0 && !cat.hasChildren) {
      result.set(cat.id, cat)
      continue
    }

    if (cat.productCount > 0) {
      result.set(cat.id, cat)
    }

    // Descendants whose path starts with this category's path
    for (const candidate of all) {
      if (candidate.id === cat.id) continue
      const isDescendant =
        candidate.pathLower.length > cat.pathLower.length &&
        cat.pathLower.every((part, i) => candidate.pathLower[i] === part)

      if (isDescendant && candidate.productCount > 0) {
        // Prefer deeper leaves
        if (!candidate.hasChildren || candidate.productCount > 0) {
          result.set(candidate.id, candidate)
        }
      }
    }

    // If parent matched but no descendants found via path, keep parent if it has products
    if (result.size === 0 && byId.get(cat.id)?.productCount) {
      result.set(cat.id, cat)
    }
  }

  // If we collected both parents and children, drop parents that only exist as path prefixes
  const ids = [...result.keys()]
  for (const id of ids) {
    const cat = result.get(id)!
    const hasChildInResult = [...result.values()].some(
      (other) =>
        other.id !== id &&
        other.pathLower.length > cat.pathLower.length &&
        cat.pathLower.every((part, i) => other.pathLower[i] === part),
    )
    if (hasChildInResult && cat.hasChildren) {
      result.delete(id)
    }
  }

  return [...result.values()]
}
