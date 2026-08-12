import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config/env.js'

/** Magento + Node share this payload format for HMAC. */
export function customerIdentityPayload(
  customerId: string,
  expUnix: number,
): string {
  return `v1|${customerId}|${expUnix}`
}

export function signCustomerIdentity(
  customerId: string,
  expUnix: number,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(customerIdentityPayload(customerId, expUnix))
    .digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex')
    const bb = Buffer.from(b, 'hex')
    if (ba.length !== bb.length || ba.length === 0) return false
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

export type CustomerIdentityProof = {
  customerId: string
  exp: number
  sig: string
}

export type ResolveIdentityResult =
  | { ok: true; userId: string; kind: 'guest' | 'customer' }
  | { ok: false; error: string }

/**
 * Trust rules:
 * - Guest: userId must look like guest_* (or legacy uuid) — accepted as-is.
 * - Customer: when CUSTOMER_ID_HMAC_SECRET is set, require valid HMAC proof.
 * - Customer without secret (dev): allow customer_* but log a warning once.
 */
let warnedDevCustomer = false

export function resolveTrustedUserId(input: {
  userId?: string | null
  identity?: CustomerIdentityProof | null
}): ResolveIdentityResult {
  const secret = config.identity.hmacSecret
  const proof = input.identity
  const claimed = (input.userId ?? '').trim()

  // Prefer cryptographic proof when present
  if (proof?.customerId && proof.sig && proof.exp) {
    const customerId = String(proof.customerId).trim()
    if (!/^\d+$/.test(customerId) || customerId === '0') {
      return { ok: false, error: 'invalid_customer_id' }
    }
    if (!secret) {
      if (!warnedDevCustomer) {
        console.warn(
          '[identity] CUSTOMER_ID_HMAC_SECRET is empty — accepting unsigned customer proof (dev only)',
        )
        warnedDevCustomer = true
      }
      return { ok: true, userId: `customer_${customerId}`, kind: 'customer' }
    }
    const now = Math.floor(Date.now() / 1000)
    if (proof.exp < now) {
      return { ok: false, error: 'customer_identity_expired' }
    }
    if (proof.exp > now + config.identity.maxFutureSkewSec) {
      return { ok: false, error: 'customer_identity_exp_too_far' }
    }
    const expected = signCustomerIdentity(customerId, proof.exp, secret)
    const sigLower = proof.sig.trim().toLowerCase()
    if (!safeEqualHex(expected.toLowerCase(), sigLower)) {
      return { ok: false, error: 'customer_identity_invalid_signature' }
    }
    return { ok: true, userId: `customer_${customerId}`, kind: 'customer' }
  }

  if (!claimed) {
    return { ok: true, userId: 'anonymous', kind: 'guest' }
  }

  if (claimed.startsWith('customer_')) {
    if (secret) {
      return {
        ok: false,
        error: 'customer_identity_signature_required',
      }
    }
    if (!warnedDevCustomer) {
      console.warn(
        '[identity] CUSTOMER_ID_HMAC_SECRET is empty — accepting bare customer_userId (dev only)',
      )
      warnedDevCustomer = true
    }
    const id = claimed.replace(/^customer_/, '')
    if (!/^\d+$/.test(id) || id === '0') {
      return { ok: false, error: 'invalid_customer_id' }
    }
    return { ok: true, userId: `customer_${id}`, kind: 'customer' }
  }

  // Guests: guest_* or legacy uuid-like
  if (
    claimed.startsWith('guest_') ||
    claimed.startsWith('guest-') ||
    /^[0-9a-f-]{36}$/i.test(claimed)
  ) {
    return { ok: true, userId: claimed.startsWith('guest') ? claimed : `guest_${claimed}`, kind: 'guest' }
  }

  // Unknown format — treat as opaque guest label (capped by zod elsewhere)
  return { ok: true, userId: claimed, kind: 'guest' }
}

export function isCustomerIdentityConfigured(): boolean {
  return Boolean(config.identity.hmacSecret)
}
