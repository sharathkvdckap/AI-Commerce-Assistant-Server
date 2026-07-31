import './config/env.js'

import cors from 'cors'
import express from 'express'
import { getModelInfo } from './ai/engine.js'
import {
  config,
  getMagentoGraphqlUrl,
  isContextMemoryConfigured,
  isMagentoConfigured,
} from './config/env.js'
import { pingContextDatabase } from './context/db.js'
import { magentoGraphql } from './magento/client.js'
import { assistantRouter } from './routes/assistant.js'
import { contextRouter } from './routes/context.js'

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

  res.json({
    ok: true,
    ...getModelInfo(),
    magento: {
      ...magento,
      storeCode: config.magento.storeCode,
    },
    contextMemory: {
      enabled: isContextMemoryConfigured(),
      similarityThreshold: config.context.similarityThreshold,
      ...contextMemory,
    },
  })
})

app.use('/api/assistant', assistantRouter)
app.use('/api/context', contextRouter)

app.listen(config.port, () => {
  const info = getModelInfo()
  console.log(`AI Commerce Assistant API on http://localhost:${config.port}`)
  console.log(`Ollama model: ${info.model} @ ${info.baseUrl}`)
  console.log(
    `Magento GraphQL: ${getMagentoGraphqlUrl() || '(not configured)'}`,
  )
  console.log(
    `Context memory: ${isContextMemoryConfigured() ? 'enabled' : 'disabled'}`,
  )
})
