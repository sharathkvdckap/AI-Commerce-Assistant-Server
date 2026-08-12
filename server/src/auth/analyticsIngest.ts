import { timingSafeEqual } from 'node:crypto'
import type { Request } from 'express'
import { config, isAnalyticsIngestConfigured } from '../config/env.js'

const INGEST_HEADER = 'x-analytics-ingest-token'

function safeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length || left.length === 0) return false
  return timingSafeEqual(left, right)
}

/** Magento conversion posts send this header. */
export function ingestTokenFromRequest(req: Request): string {
  const header = req.header(INGEST_HEADER) ?? ''
  const auth = req.header('authorization') ?? ''
  const bearer = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : ''
  return header.trim() || bearer
}

export function verifyAnalyticsIngestToken(req: Request): boolean {
  if (!isAnalyticsIngestConfigured()) return false
  const provided = ingestTokenFromRequest(req)
  if (!provided) return false
  return safeEqualString(provided, config.analyticsIngestSecret)
}

export { isAnalyticsIngestConfigured }
