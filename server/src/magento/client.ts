import { config, getMagentoGraphqlUrl } from '../config/env.js'

interface GraphQlResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

export class MagentoApiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message)
    this.name = 'MagentoApiError'
  }
}

export async function magentoGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const graphqlUrl = getMagentoGraphqlUrl()
  if (!graphqlUrl) {
    throw new MagentoApiError(
      'Magento GraphQL is not configured. Set MAGENTO_GRAPHQL_URL or MAGENTO_URL.',
      500,
    )
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Store: config.magento.storeCode,
  }

  if (config.magento.useAuth) {
    if (!config.magento.accessToken) {
      throw new MagentoApiError(
        'MAGENTO_GRAPHQL_USE_AUTH=true but MAGENTO_ACCESS_TOKEN is empty.',
        500,
      )
    }
    headers.Authorization = `Bearer ${config.magento.accessToken}`
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.magento.timeoutMs)

  try {
    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new MagentoApiError(
        `Magento GraphQL HTTP ${response.status}`,
        response.status,
      )
    }

    const payload = (await response.json()) as GraphQlResponse<T>
    if (payload.errors?.length) {
      throw new MagentoApiError(
        `Magento GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`,
      )
    }
    if (!payload.data) {
      throw new MagentoApiError('Magento GraphQL returned no data')
    }
    return payload.data
  } catch (error) {
    if (error instanceof MagentoApiError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MagentoApiError('Magento GraphQL request timed out')
    }
    throw new MagentoApiError(
      error instanceof Error ? error.message : 'Magento GraphQL request failed',
    )
  } finally {
    clearTimeout(timer)
  }
}
