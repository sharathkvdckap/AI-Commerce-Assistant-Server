import { z } from 'zod'
import {
  resolveTrustedUserId,
  type CustomerIdentityProof,
} from './customerIdentity.js'

export const identityProofSchema = z
  .object({
    customerId: z.string().trim().min(1).max(32),
    exp: z.number().int().positive(),
    sig: z.string().trim().min(16).max(128),
  })
  .optional()

/** Resolve API userId from body fields; returns error string if invalid. */
export function trustedUserIdFromBody(body: {
  userId?: string | null
  identity?: CustomerIdentityProof | null
}): { userId: string } | { error: string } {
  const resolved = resolveTrustedUserId({
    userId: body.userId,
    identity: body.identity ?? null,
  })
  if (!resolved.ok) return { error: resolved.error }
  return { userId: resolved.userId }
}
