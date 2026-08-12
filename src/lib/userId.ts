const GUEST_STORAGE_KEY = 'ai-commerce-assistant-user-id'
const CUSTOMER_STORAGE_KEY = 'ai-commerce-assistant-customer-id'
const CUSTOMER_PROOF_KEY = 'ai-commerce-assistant-customer-proof'

export type CustomerIdentityProof = {
  customerId: string
  exp: number
  sig: string
}

export type UserIdentity = {
  /** Value sent to API / context memory / analytics */
  userId: string
  /** guest = browser UUID; customer = Magento customer id */
  kind: 'guest' | 'customer'
  /** Magento customer entity id when kind === 'customer' */
  magentoCustomerId?: string
  /** HMAC proof from Magento redirect (required when Node has CUSTOMER_ID_HMAC_SECRET) */
  identity?: CustomerIdentityProof
}

function guestId(): string {
  try {
    const existing = localStorage.getItem(GUEST_STORAGE_KEY)?.trim()
    if (existing) {
      if (existing.startsWith('guest_') || existing.startsWith('customer_')) {
        return existing
      }
      const migrated = `guest_${existing}`
      localStorage.setItem(GUEST_STORAGE_KEY, migrated)
      return migrated
    }
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? `guest_${crypto.randomUUID()}`
        : `guest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem(GUEST_STORAGE_KEY, id)
    return id
  } catch {
    return `guest-session-${Date.now()}`
  }
}

function normalizeCustomerId(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^customer_\d+$/i.test(trimmed)) {
    return `customer_${trimmed.replace(/^customer_/i, '')}`
  }
  if (/^\d+$/.test(trimmed) && trimmed !== '0') {
    return `customer_${trimmed}`
  }
  return null
}

function persistCustomer(
  customerUserId: string | null,
  proof: CustomerIdentityProof | null,
): void {
  try {
    if (customerUserId && proof) {
      localStorage.setItem(CUSTOMER_STORAGE_KEY, customerUserId)
      localStorage.setItem(CUSTOMER_PROOF_KEY, JSON.stringify(proof))
    } else if (customerUserId && !proof) {
      // Unsigned (dev) — store id only
      localStorage.setItem(CUSTOMER_STORAGE_KEY, customerUserId)
      localStorage.removeItem(CUSTOMER_PROOF_KEY)
    } else {
      localStorage.removeItem(CUSTOMER_STORAGE_KEY)
      localStorage.removeItem(CUSTOMER_PROOF_KEY)
    }
  } catch {
    /* ignore */
  }
}

function readPersistedProof(): CustomerIdentityProof | null {
  try {
    const raw = localStorage.getItem(CUSTOMER_PROOF_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CustomerIdentityProof
    if (!parsed?.customerId || !parsed?.sig || !parsed?.exp) return null
    if (parsed.exp < Math.floor(Date.now() / 1000)) {
      localStorage.removeItem(CUSTOMER_PROOF_KEY)
      localStorage.removeItem(CUSTOMER_STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function readPersistedCustomerId(): string | null {
  try {
    const raw = localStorage.getItem(CUSTOMER_STORAGE_KEY)?.trim()
    return raw ? normalizeCustomerId(raw) : null
  } catch {
    return null
  }
}

/**
 * Magento redirect (signed):
 *   /ai-assistant?q=shorts&customer_id=42&cid_exp=1710000000&cid_sig=abc...
 * Magento redirect (dev unsigned — only if Node secret empty):
 *   /ai-assistant?q=shorts&customer_id=42
 * Logout:
 *   /ai-assistant?logged_in=0
 */
function readCustomerFromUrl():
  | { kind: 'logout' }
  | { kind: 'customer'; userId: string; identity?: CustomerIdentityProof }
  | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const loggedIn = params.get('logged_in') ?? params.get('loggedIn')
    if (loggedIn === '0' || loggedIn === 'false') return { kind: 'logout' }

    const raw =
      params.get('customer_id') ??
      params.get('customerId') ??
      params.get('cid')
    if (raw === '0' || raw === '') return { kind: 'logout' }
    if (!raw) return null

    const userId = normalizeCustomerId(raw)
    if (!userId) return null

    const customerId = userId.replace(/^customer_/, '')
    const expRaw = params.get('cid_exp') ?? params.get('exp')
    const sig = params.get('cid_sig') ?? params.get('sig')
    if (expRaw && sig) {
      const exp = Number(expRaw)
      if (Number.isFinite(exp) && exp > 0) {
        return {
          kind: 'customer',
          userId,
          identity: { customerId, exp, sig },
        }
      }
    }
    return { kind: 'customer', userId }
  } catch {
    return null
  }
}

/**
 * Resolve who is shopping for context memory + analytics.
 * Logged-in Magento customers should arrive with HMAC proof (cid_exp + cid_sig).
 */
export function resolveUserIdentity(): UserIdentity {
  const fromUrl = readCustomerFromUrl()
  if (fromUrl?.kind === 'logout') {
    persistCustomer(null, null)
    return { userId: guestId(), kind: 'guest' }
  }
  if (fromUrl?.kind === 'customer') {
    persistCustomer(fromUrl.userId, fromUrl.identity ?? null)
    return {
      userId: fromUrl.userId,
      kind: 'customer',
      magentoCustomerId: fromUrl.userId.replace(/^customer_/, ''),
      identity: fromUrl.identity,
    }
  }

  const proof = readPersistedProof()
  if (proof) {
    return {
      userId: `customer_${proof.customerId}`,
      kind: 'customer',
      magentoCustomerId: proof.customerId,
      identity: proof,
    }
  }

  const persisted = readPersistedCustomerId()
  if (persisted) {
    return {
      userId: persisted,
      kind: 'customer',
      magentoCustomerId: persisted.replace(/^customer_/, ''),
    }
  }

  return { userId: guestId(), kind: 'guest' }
}

export function getOrCreateUserId(): string {
  return resolveUserIdentity().userId
}

/** Fields to attach on every API call that carries identity. */
export function getIdentityRequestFields(): {
  userId: string
  identity?: CustomerIdentityProof
} {
  const id = resolveUserIdentity()
  return {
    userId: id.userId,
    ...(id.identity ? { identity: id.identity } : {}),
  }
}

export function clearCustomerIdentity(): void {
  persistCustomer(null, null)
}
