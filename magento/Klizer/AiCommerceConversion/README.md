# Klizer_AiCommerceConversion

Tracks **reached cart**, **reached checkout**, and **placed order** as three separate events on the AI Commerce Assistant analytics API.

Funnel: search → impression → View Product click → **cart** → **checkout** → **order**.

## Install

```bash
# Magento root
cp -R magento/Klizer/AiCommerceConversion app/code/Klizer/AiCommerceConversion
bin/magento module:enable Klizer_AiCommerceConversion
bin/magento setup:upgrade
bin/magento cache:flush
```

## Configure

**Stores → Configuration → Klizer → AI Commerce Conversion**

| Field | Value |
| --- | --- |
| Enable | Yes |
| Assistant API base URL | `http://127.0.0.1:3001` (Node API; use a reachable host from Magento) |
| Ingest token | Same as `ANALYTICS_INGEST_SECRET` or `CUSTOMER_ID_HMAC_SECRET` in `server/.env` |

On Node:

```bash
cd server
npm run db:migrate:analytics   # applies 003–005 (CTR + cart/checkout/order)
```

## How it works

1. Assistant **View Product** opens Magento PDP with `ai_search_id`, `ai_sku`, `ai_uid`, `ai_session_id`.
2. Storefront JS sets a first-party cookie (`ai_commerce_attr`).
3. Opening `/checkout/cart` posts `eventType: cart` (once per quote).
4. Opening `/checkout` posts `eventType: checkout` (once per quote).
5. Placing an order posts `eventType: order` (separate row, with `order_id` + revenue).

Only cart/order SKUs that were opened from the assistant are attributed. Cart without checkout, or checkout without an order, is abandonment.

Events never block Magento checkout (2s timeout, errors are logged).
