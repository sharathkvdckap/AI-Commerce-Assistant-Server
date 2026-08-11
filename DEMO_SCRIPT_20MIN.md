# 20-minute demo script — AI Commerce Assistant

A human-readable guide for presenting to colleagues or judges. Speak naturally; use this as a checklist, not a teleprompter.

**Audience goal:** They leave understanding *the problem*, *why AI is core*, *how Magento stays the source of truth*, and *what changes when semantic is OFF vs ON*.

**Related:** [README.md](./README.md) · [DEMO.md](./DEMO.md) · [magento/DEMO.md](./magento/DEMO.md) · Jumpshare videos in Magento demo doc

---

## Before you start (5–10 min prep)

### Have running

| Piece | Check |
| ----- | ----- |
| Ollama | `qwen2.5:3b` (and `bge-m3` if you will show semantic ON) |
| API | `cd server && npm run dev` → http://localhost:3001/api/health |
| UI | `npm run dev` → http://localhost:5173/ai-assistant |
| Magento | GraphQL reachable; storefront if you demo search redirect |
| Postgres + embeddings | Only needed for **Part C (semantic ON)** — sync done once |

### Health check talking point

Open `/api/health` and say:

> “Green Magento means live catalog. Semantic and context blocks show whether hybrid search and memory are on.”

### Prep two `.env` modes

You will switch once mid-demo (or use two terminals / restart).

**Mode A — Semantic OFF**

```env
SEMANTIC_ENABLED=false
# CONTEXT_MEMORY_ENABLED=false   # optional: keep demos simpler
```

**Mode B — Semantic ON**

```env
SEMANTIC_ENABLED=true
DATABASE_URL=postgresql://...
# embeddings already synced: cd server && npm run sync:embeddings
```

After each change: restart the API (`server` process).

### Pick one primary example (apparel)

Use the **same customer sentence** in both modes so the audience can compare:

> **“Show some good varieties of shorts”**

Optional second vertical (if time): *“Motor shaft grinding—need replacement”* (industrial).

---

## 20-minute agenda

| Min | Section | What you do |
| --- | ------- | ----------- |
| 0–3 | Hook + problem | Story, not slides dump |
| 3–6 | Solution & AI at the core | Simple diagram in words |
| 6–12 | **Live demo — Semantic OFF** | Shorts query → clarify → Magento cards |
| 12–17 | **Live demo — Semantic ON** | Same / vague query → hybrid / semantic % |
| 17–20 | Wrap: value, what we did *not* do, Q&A | Close strong |

If Magento search redirect works, spend 30–60s opening the storefront search bar so they see “this is not a disconnected chatbot.”

---

## Part 1 — Hook (0–3 min)

### What to say

> “Magento search is great when shoppers know the product name or SKU. Real shoppers don’t. They say things like *comfortable for the gym* or *show me some good shorts*. Keywords miss intent. Support gets ‘help me find…’ tickets. That’s the gap.”

### Concept to cover

| Pain | One line |
| ---- | -------- |
| Keyword-only search | Misses intent language |
| Unknown product names | Especially gifts, apparel, industrial parts |
| Large catalogs | Right item buried |
| Support load | Humans become the search engine |

### Example (one sentence)

> “B2C: *something comfortable for the gym*. B2B: *motor shaft is grinding—need a replacement*. Neither is a SKU.”

---

## Part 2 — Solution & why AI is core (3–6 min)

### One picture, spoken aloud

```text
Customer language
    → AI understands & may ask 1–3 short questions
    → Structured filters
    → Magento GraphQL returns REAL products
    → (optional) Semantic embeddings help when keywords fail
    → Product cards → Magento product page
```

### What to share verbally (concepts checklist)

1. **AI is the front of the funnel** — turns messy language into Magento-ready filters.  
2. **Magento is the source of truth** — AI never invents SKUs, prices, or stock.  
3. **Clarifying questions (max 3)** — with chips, not endless chat.  
4. **Fast path** — exact SKU / clear name can skip Q&A.  
5. **Two retrieval modes** — Magento-only vs Magento + semantic (hybrid).  
6. **Storefront bridge** (if you show it) — Magento search can open the assistant.

### Easy analogy

> “Think of AI as a smart sales associate who asks two good questions, then walks you to the right aisle. The aisle and the products are still Magento’s warehouse—not made-up inventory.”

### What you do *not* need to deep-dive (save for Q&A)

- Zod schemas, LangChain internals  
- SQL migration details  
- Full API list  

---

## Part 3 — Live demo: Semantic DISABLED (6–12 min)

### Setup reminder

`SEMANTIC_ENABLED=false` → restart API → confirm health: semantic not configured / disabled.

### Story for the audience

> “First we run **without** vector search. Only Magento GraphQL. You’ll see AI still do the conversation—but product recall is keyword and category filters only.”

### Script (follow this)

**Step 1 — Open the assistant**  
URL: `http://localhost:5173/ai-assistant`  
(Or Magento search → lands on assistant with `?q=…`.)

**Step 2 — Type the example**

```text
show some good varieties of shorts
```

**Step 3 — Narrate what happens**

| What they see | What you say |
| ------------- | ------------ |
| Thinking / typing | “Ollama is deciding: ask a question or search Magento.” |
| Clarifying question + chips | “AI is collecting filters—category, use, color—so Magento can filter properly.” |
| You click 1–2 answers | “Each answer updates filters. Max three questions, then we search.” |
| Product cards appear | “These SKUs, prices, and stock came from Magento GraphQL—not the LLM.” |

**Step 4 — Point at a card**

> “Open a product URL—same Magento PDP. AI recommended; Magento owns the catalog.”

**Step 5 — Optional console (if engineers in the room)**

Server logs show Magento path. You will **not** see `before reRank` / `after reRank` logs—semantic enrich returns early when disabled.

**Step 6 — One-line summary for this mode**

> “Semantic OFF = AI for understanding + Magento for search. Source on the response is **`magento`**.”

### Flow diagram (show or draw quickly)

```text
Query → AI clarify (optional) → filters
      → Magento GraphQL only
      → Cards (source: magento)
```

**Skipped:** pgvector, BGE-M3 product recall, hybrid merge/re-rank.

---

## Part 4 — Live demo: Semantic ENABLED (12–17 min)

### Setup

1. Set `SEMANTIC_ENABLED=true` (+ valid `DATABASE_URL`).  
2. Confirm embeddings exist (`sync:embeddings` already run).  
3. Restart API. Health should show semantic OK.  
4. Optional: show a screenshot or DB note — “catalog vectors are indexed.”

### Story for the audience

> “Same customer language, but now we add **hybrid recall**. Magento still runs first. If keywords are weak, embeddings find similar products by meaning. We still load those SKUs from Magento—no invented products.”

### Best demo pattern (easy to compare)

**Option A — Same query again**  
*“Show some good varieties of shorts”*  
Explain: Magento may already be strong; hybrid may still enrich / re-rank. Point at **semantic match %** on cards if shown.

**Option B — More “intent” / paraphrase query (often clearer win)**  
Examples:

- *“Something light and comfortable for the gym in summer”*  
- *“Casual shorts for everyday wear under $50”* (if budget exists in catalog)

Say:

> “Keyword search struggles with *comfortable / summer / everyday*. Embeddings recover products that *mean* the same thing even if titles don’t match every word.”

### Script

| Step | Do | Say |
| ---- | -- | --- |
| 1 | Run query | “AI clarification can still happen—semantic doesn’t replace the chat.” |
| 2 | After search | “Now Magento GraphQL **and** vector recall run.” |
| 3 | Point at `source` / badge | “`magento`, `semantic`, or **`hybrid`**—hybrid means both contributed.” |
| 4 | Point at % if UI shows it | “Similarity score from BGE-M3—not a fake confidence from the chat model.” |
| 5 | Click PDP | “Still a real Magento product.” |

### Flow diagram

```text
Query → AI clarify (optional) → filters
      → Magento GraphQL
      → Embed query (bge-m3) → pgvector top-K
      → Hydrate SKUs from Magento
      → Merge + re-rank
      → Cards (source: magento | semantic | hybrid)
```

### Optional 60-second add-on: context memory

If `CONTEXT_MEMORY_ENABLED=true` and you have time:

1. Finish one search.  
2. Ask a **similar** query with the same user.  
3. Show “Continue previous search?”  

> “That’s memory of *what they already decided*, refreshed against live Magento stock—not a hallucinated cart.”

### One-line summary for this mode

> “Semantic ON = Magento first + AI embeddings as a safety net for intent language. Products still Magento.”

---

## Side-by-side cheat sheet (say this if asked)

| | Semantic **OFF** | Semantic **ON** |
| --- | ---------------- | --------------- |
| Chat / clarify | Yes (Ollama) | Yes (same) |
| Product search | Magento GraphQL only | Magento + pgvector |
| Needs Postgres embeddings? | No | Yes |
| Response `source` | Usually `magento` | `magento` / `semantic` / `hybrid` |
| Best when | Catalog labels match query words | Vague / symptom / paraphrase queries |
| Demo query | Shorts (clear category) | Same shorts **or** vaguer gym/comfort phrasing |

---

## Part 5 — Close (17–20 min)

### Recap in 30 seconds

> “We close the gap between how customers speak and how Magento indexes. AI clarifies and filters; Magento returns truth; optional semantic search catches what keywords miss—and never invents inventory.”

### Business value (pick 2–3)

- Shoppers: plain language → real in-stock options  
- Support/sales: fewer “find me X” interruptions  
- Merchants: better discovery on the catalog they already have  

### What we deliberately do *not* do

- No LLM-generated fake products  
- No endless chatbot without a search outcome  
- No replacing Magento—**augmenting** search and discovery  

### Invite questions

Suggested Qs you are ready for:

- “Where does the model run?” → Local Ollama (`qwen2.5:3b`, `bge-m3`).  
- “Is data leaving Magento?” → Search via GraphQL; embeddings sync is your controlled pipeline.  
- “Multi-store?” → Store code + GraphQL URL in `.env`.  

---

## Spoken demo script (condensed — print this page)

1. **Problem:** People don’t search like catalogs. Example: *show some good varieties of shorts*.  
2. **Idea:** AI associate + Magento warehouse.  
3. **OFF:** Run shorts → questions → Magento cards → “source magento, no vectors.”  
4. **ON:** Flip flag / restart → vaguer or same query → show hybrid / semantic % → “still Magento SKUs.”  
5. **Close:** Intent → filters → real catalog → PDP. Optional memory. Questions?

---

## Timing tips

- If Ollama is slow on CPU: pre-warm with one throwaway query before the audience arrives; raise `OLLAMA_TIMEOUT_MS`.  
- If clarify takes too long: answer chips quickly; don’t over-explain every filter field.  
- If Magento is empty for “shorts”: use a category you know exists, or the industrial / fitness Jumpshare video as backup ([magento/DEMO.md](./magento/DEMO.md)).  
- Never debug live for more than 30 seconds—switch to recorded video, then return.

---

## Backup videos (if live breaks)

| Demo | Link |
| ---- | ---- |
| Apparels | https://jumpshare.com/share/cvHdGxYwQrR6WKjZmTN7 |
| Fitness | https://jumpshare.com/share/ddLEwgSeXLwBFWerYJSd |
| Industrial | https://jumpshare.com/share/7nwze2d2xxoKBQoCKol7 |

Use video for one vertical; keep live for the Semantic OFF vs ON comparison if possible—that contrast is the teaching moment.
