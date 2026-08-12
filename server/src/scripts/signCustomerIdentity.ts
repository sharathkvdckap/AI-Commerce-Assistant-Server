/**
 * Generate a Magento-style customer identity HMAC for local testing.
 *
 * Usage:
 *   CUSTOMER_ID_HMAC_SECRET=dev-secret npm run sign:customer -- 42
 *   CUSTOMER_ID_HMAC_SECRET=dev-secret npm run sign:customer -- 42 3600
 *
 * Payload: v1|{customerId}|{exp}
 * Signature: HMAC-SHA256 hex
 */
import { config } from '../config/env.js'
import {
  customerIdentityPayload,
  signCustomerIdentity,
} from '../auth/customerIdentity.js'

const customerId = (process.argv[2] ?? '').trim()
const ttlSec = Number.parseInt(process.argv[3] ?? '', 10)
const ttl = Number.isFinite(ttlSec) && ttlSec > 0
  ? ttlSec
  : config.identity.tokenTtlSec

if (!/^\d+$/.test(customerId) || customerId === '0') {
  console.error('Usage: npm run sign:customer -- <customerId> [ttlSeconds]')
  process.exit(1)
}

const secret = config.identity.hmacSecret
if (!secret) {
  console.error(
    'Set CUSTOMER_ID_HMAC_SECRET in server/.env (or the environment) first.',
  )
  process.exit(1)
}

const exp = Math.floor(Date.now() / 1000) + ttl
const sig = signCustomerIdentity(customerId, exp, secret)
const payload = customerIdentityPayload(customerId, exp)

const qs = new URLSearchParams({
  customer_id: customerId,
  cid_exp: String(exp),
  cid_sig: sig,
})

console.log(
  JSON.stringify(
    {
      customerId,
      exp,
      sig,
      payload,
      queryString: qs.toString(),
      exampleUrl: `http://localhost:5173/ai-assistant?q=shorts&${qs.toString()}`,
    },
    null,
    2,
  ),
)
