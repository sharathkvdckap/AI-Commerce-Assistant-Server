import { randomUUID } from 'node:crypto'
import type { ProductFilters } from '../ai/engine.js'

export interface SessionMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantSession {
  id: string
  userId?: string
  createdAt: number
  updatedAt: number
  messages: SessionMessage[]
  filters: ProductFilters
  status: 'collecting' | 'ready_to_search' | 'completed'
  /** True when user explicitly continued a previous shopping context. */
  reusedContext?: boolean
}

const sessions = new Map<string, AssistantSession>()

export function createSession(options?: {
  userId?: string
  filters?: ProductFilters
  reusedContext?: boolean
}): AssistantSession {
  const session: AssistantSession = {
    id: randomUUID(),
    userId: options?.userId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    filters: options?.filters ?? {},
    status: 'collecting',
    reusedContext: options?.reusedContext ?? false,
  }
  sessions.set(session.id, session)
  return session
}

export function getSession(sessionId: string): AssistantSession | undefined {
  return sessions.get(sessionId)
}

export function saveSession(session: AssistantSession): void {
  session.updatedAt = Date.now()
  sessions.set(session.id, session)
}
