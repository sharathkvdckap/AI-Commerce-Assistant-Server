# Demo walkthrough — screenshots & videos

Visual guide for **AI Commerce Assistant**: Magento config → search → clarifying questions → PLP results → semantic / context memory. Companion to the [README](./README.md) and [HACKATHON_DOCUMENTATION.md](./HACKATHON_DOCUMENTATION.md).

---

## Demo videos

| # | Vertical | Link |
| - | -------- | ---- |
| 1 | Apparels | [Jumpshare – apparels](https://jumpshare.com/share/cvHdGxYwQrR6WKjZmTN7) |
| 2 | Fitness equipment | [Jumpshare – fitness equipment](https://jumpshare.com/share/ddLEwgSeXLwBFWerYJSd) |
| 3 | Industrial products | [Jumpshare – industry products](https://jumpshare.com/share/7nwze2d2xxoKBQoCKol7) |

---

## 1. Magento setup

### Magento config

Admin: **Stores → Configuration → Klizer → AI Commerce Assistant** (search redirect, assistant URL).

![Magento config](https://i.ibb.co/8D68Bt7S/image.png)

### AI product search icon

Storefront search UI with the AI assistant entry point.

![AI Product search Icon](https://i.ibb.co/7x3Zhsb0/image.png)

---

## 2. Apparel / gym flow

### Query in search bar

Customer enters a natural-language query (e.g. comfortable clothes for gym).

![Query enter in search bar](https://i.ibb.co/wFQT738D/image.png)

### Clarifying questions

Assistant asks follow-up questions with option chips.

![Questions for query](https://i.ibb.co/zL1bJhN/image.png)

### Answer — question 1

![Enter answer for question 1](https://i.ibb.co/Vpkq5vpQ/image.png)

### Answer — question 2

![Enter answer for question 2](https://i.ibb.co/wZBXVJYQ/image.png)

### Results — grid PLP

AI-matchable products on the grid PLP.

![AI matchable results in Grid PLP](https://i.ibb.co/TBhHfczN/m248p4-local-catalogsearch-result-q-show-comfortable-clothes-for-gym.png)

![AI matchable results in Grid PLP (alt)](https://i.ibb.co/PvrmkWfx/m248p4-local-catalogsearch-result-q-show-comfortable-clothes-for-gym-1.png)

### Product card hover UI

![PLP product card hover UI](https://i.ibb.co/NnyRzZ77/product-hover-card-UI.png)

**Video:** [Apparels demo](https://jumpshare.com/share/cvHdGxYwQrR6WKjZmTN7)

---

## 3. Semantic search & embeddings

### Products synced to vector embeddings

Catalog indexed into Postgres / pgvector (`sync:embeddings`).

![Product synced in vector embeddings](https://i.ibb.co/XxNDHbxZ/image.png)

### Grid PLP with semantic percentage

When `SEMANTIC_ENABLED=true`, cards can show semantic match %.

![AI results with semantic percentage](https://i.ibb.co/dw9nf26k/image.png)

### Saved user search history

Search history in DB; products shown with semantic enabled.

![Saved user search history](https://i.ibb.co/HDvWnvTk/image.png)

### Previous search / context reuse

Same or similar query again → previous search session / continue previous search.

![Previous search session](https://i.ibb.co/NnKj1hjT/image.png)

---

## 4. Industrial parts flow

### Query in search bar

e.g. *Motor shaft grinding—need replacement*.

![Industrial parts query](https://i.ibb.co/m5qhBXHq/image.png)

### Results — grid PLP

![Industrial AI matchable results](https://i.ibb.co/SHqN6D1/m248p4-local-catalogsearch-result-q-Motor-shaft-grinding-need-replacement.png)

**Video:** [Industry products demo](https://jumpshare.com/share/7nwze2d2xxoKBQoCKol7)

---

## 5. Fitness equipment flow

### Search

e.g. *Need something for strength training*.

![Fitness equipment search](https://i.ibb.co/tM4SSkZk/image.png)

### Results — grid PLP

![Fitness equipment PLP results](https://i.ibb.co/Wv20dddp/m248p4-local-catalogsearch-result-q-Need-something-for-strength-training.png)

**Video:** [Fitness equipment demo](https://jumpshare.com/share/ddLEwgSeXLwBFWerYJSd)

---

## Screenshot index

| Caption | Image |
| ------- | ----- |
| Magento config | https://i.ibb.co/8D68Bt7S/image.png |
| AI Product search Icon | https://i.ibb.co/7x3Zhsb0/image.png |
| Query enter in search bar | https://i.ibb.co/wFQT738D/image.png |
| Questions for query | https://i.ibb.co/zL1bJhN/image.png |
| Answer for question 1 | https://i.ibb.co/Vpkq5vpQ/image.png |
| Answer for question 2 | https://i.ibb.co/wZBXVJYQ/image.png |
| Products synced in vector embeddings | https://i.ibb.co/XxNDHbxZ/image.png |
| Grid PLP results (gym / apparel) | https://i.ibb.co/TBhHfczN/m248p4-local-catalogsearch-result-q-show-comfortable-clothes-for-gym.png |
| PLP product card hover UI | https://i.ibb.co/NnyRzZ77/product-hover-card-UI.png |
| Grid PLP results (apparel alt) | https://i.ibb.co/PvrmkWfx/m248p4-local-catalogsearch-result-q-show-comfortable-clothes-for-gym-1.png |
| Grid PLP + semantic % | https://i.ibb.co/dw9nf26k/image.png |
| Saved search history (semantic ON) | https://i.ibb.co/HDvWnvTk/image.png |
| Previous search / context reuse | https://i.ibb.co/NnKj1hjT/image.png |
| Industrial query in search bar | https://i.ibb.co/m5qhBXHq/image.png |
| Industrial Grid PLP | https://i.ibb.co/SHqN6D1/m248p4-local-catalogsearch-result-q-Motor-shaft-grinding-need-replacement.png |
| Fitness equipment search | https://i.ibb.co/tM4SSkZk/image.png |
| Fitness equipment Grid PLP | https://i.ibb.co/Wv20dddp/m248p4-local-catalogsearch-result-q-Need-something-for-strength-training.png |
