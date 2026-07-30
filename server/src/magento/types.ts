export interface MagentoMoney {
  value: number
  currency: string
}

export interface MagentoProductItem {
  id?: number | string
  uid?: string
  sku: string
  name: string
  url_key?: string | null
  stock_status?: string | null
  small_image?: { url?: string | null; label?: string | null } | null
  image?: { url?: string | null; label?: string | null } | null
  price_range?: {
    minimum_price?: {
      final_price?: MagentoMoney | null
      regular_price?: MagentoMoney | null
    } | null
  } | null
}

export interface MagentoProductsResponse {
  products: {
    total_count: number
    items: MagentoProductItem[]
  }
}

export interface CatalogProduct {
  id: string
  sku: string
  name: string
  price: number
  currency: string
  imageUrl: string
  productUrl: string
  reasons: string[]
  inStock: boolean
}

export type ProductSource = 'magento'
