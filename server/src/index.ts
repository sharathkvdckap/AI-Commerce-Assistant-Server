import './config/env.js'

import cors from 'cors'
import express from 'express'
import { getModelInfo } from './ai/engine.js'
import {
  config,
  getMagentoGraphqlUrl,
  isContextMemoryConfigured,
  isMagentoConfigured,
  isSemanticConfigured,
} from './config/env.js'
import { isCustomerIdentityConfigured } from './auth/customerIdentity.js'
import {
  getDomainConfig,
  getDomainConfigPath,
} from './config/domainConfig.js'
import { pingContextDatabase, pingSemanticDatabase } from './context/db.js'
import { listMagentoFilterableAttributes } from './magento/attributes.js'
import { magentoGraphql } from './magento/client.js'
import { assistantRouter } from './routes/assistant.js'
import { analyticsRouter } from './routes/analytics.js'
import { contextRouter } from './routes/context.js'
import { semanticRouter } from './routes/semantic.js'
import { isAnalyticsConfigured } from './analytics/index.js'

const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/health', async (_req, res) => {
  const magento: {
    configured: boolean
    graphqlUrl: string
    reachable?: boolean
    error?: string
  } = {
    configured: isMagentoConfigured(),
    graphqlUrl: getMagentoGraphqlUrl(),
  }

  if (magento.configured) {
    try {
      await magentoGraphql<{ storeConfig?: { store_code?: string } }>(
        `{ storeConfig { store_code } }`,
      )
      magento.reachable = true
    } catch (error) {
      magento.reachable = false
      magento.error = error instanceof Error ? error.message : 'unreachable'
    }
  }

  const contextMemory = isContextMemoryConfigured()
    ? await pingContextDatabase()
    : { ok: false, error: 'not_configured' }

  const semantic = isSemanticConfigured()
    ? await pingSemanticDatabase()
    : { ok: false, error: 'not_configured' }

  let magentoAttributes:
    | Array<{ code: string; optionCount: number; sampleLabels: string[] }>
    | { error: string }
    | undefined
  if (magento.configured && magento.reachable) {
    try {
      magentoAttributes = await listMagentoFilterableAttributes()
    } catch (error) {
      magentoAttributes = {
        error: error instanceof Error ? error.message : 'failed_to_load',
      }
    }
  }

  res.json({
    ok: true,
    ...getModelInfo(),
    magento: {
      ...magento,
      storeCode: config.magento.storeCode,
      filterableAttributes: magentoAttributes,
    },
    contextMemory: {
      enabled: isContextMemoryConfigured(),
      similarityThreshold: config.context.similarityThreshold,
      ...contextMemory,
    },
    semantic: {
      enabled: isSemanticConfigured(),
      embeddingModel: config.context.embeddingModel,
      topK: config.semantic.topK,
      minScore: config.semantic.minScore,
      fallbackMinScore: config.semantic.fallbackMinScore,
      ...semantic,
    },
    analytics: {
      enabled: isAnalyticsConfigured(),
      note: 'Zero-result, hybrid lift, CTR — requires DATABASE_URL + db:migrate:analytics',
    },
    customerIdentity: {
      hmacRequired: isCustomerIdentityConfigured(),
      note: 'When hmacRequired, Magento must send cid_exp + cid_sig with customer_id',
    },
    domainConfig: (() => {
      const domain = getDomainConfig()
      return {
        path: getDomainConfigPath(),
        merchantName: domain.merchantName ?? null,
        domains: domain.domains.map((d) => d.id),
        intentRulesEnabled: domain.intentRules?.enabled !== false,
      }
    })(),
  })
})

app.get('/api/magento/attributes', async (_req, res) => {
  if (!isMagentoConfigured()) {
    res.status(503).json({ ok: false, error: 'magento_not_configured' })
    return
  }
  try {
    const attributes = await listMagentoFilterableAttributes()
    res.json({ ok: true, count: attributes.length, attributes })
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'failed_to_load',
    })
  }
})

app.use('/api/assistant', assistantRouter)
app.use('/api/context', contextRouter)
app.use('/api/semantic', semanticRouter)
app.use('/api/analytics', analyticsRouter)

app.listen(config.port, () => {
  const info = getModelInfo()
  const domain = getDomainConfig()
  console.log(`AI Commerce Assistant API on http://localhost:${config.port}`)
  console.log(`Ollama model: ${info.model} @ ${info.baseUrl}`)
  console.log(
    `Magento GraphQL: ${getMagentoGraphqlUrl() || '(not configured)'}`,
  )
  console.log(
    `Domain config: ${domain.merchantName ?? 'default'} (${getDomainConfigPath()})`,
  )
  console.log(
    `Context memory: ${isContextMemoryConfigured() ? 'enabled' : 'disabled'}`,
  )
  console.log(
    `Semantic search: ${isSemanticConfigured() ? 'enabled' : 'disabled'}`,
  )
  console.log(
    `Analytics: ${isAnalyticsConfigured() ? 'enabled' : 'disabled'}`,
  )
  console.log(
    `Customer identity HMAC: ${isCustomerIdentityConfigured() ? 'enabled' : 'off (dev unsigned OK)'}`,
  )
})
