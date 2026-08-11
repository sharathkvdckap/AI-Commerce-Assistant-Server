# Node / app demo — screenshots

Local **Node** run for **AI Commerce Assistant**: Vite frontend, Express API, and embedding sync.

Magento admin + storefront demos: **[magento/DEMO.md](./magento/DEMO.md)**  
Setup guide: [README.md](./README.md)

---

## Contents

1. [Local run (frontend & backend)](#1-local-run-frontend--backend)
2. [Semantic / embeddings (Node)](#2-semantic--embeddings-node)
3. [Screenshot index](#screenshot-index)

---

## 1. Local run (frontend & backend)

### Frontend UI run

Vite UI starting (`npm run dev` → typically `http://localhost:5173`).

![Frontend UI run](https://i.ibb.co/pjyCtNw1/image.png)

### AI Commerce Assistant app (test UI)

Assistant app running in the browser for testing.

![AI Commerce Assistant app UI](https://i.ibb.co/4RFMNNVK/image.png)

### Backend run

Express API starting (`cd server && npm run dev` → typically `http://localhost:3001`).

![Backend run](https://i.ibb.co/5g3q0B0P/image.png)

---

## 2. Semantic / embeddings (Node)

Catalog indexed into Postgres / pgvector from the API (`cd server && npm run sync:embeddings`).

![Product synced in vector embeddings](https://i.ibb.co/XxNDHbxZ/image.png)

Storefront PLP with semantic % and context reuse: [magento/DEMO.md — Semantic search on PLP](./magento/DEMO.md#3-semantic-search-on-plp).

---

## Screenshot index

| Caption | Image |
| ------- | ----- |
| Frontend UI run | https://i.ibb.co/pjyCtNw1/image.png |
| AI Commerce Assistant app (test UI) | https://i.ibb.co/4RFMNNVK/image.png |
| Backend run | https://i.ibb.co/5g3q0B0P/image.png |
| Products synced in vector embeddings | https://i.ibb.co/XxNDHbxZ/image.png |

---

## Related

| Doc | What it covers |
| --- | -------------- |
| [magento/DEMO.md](./magento/DEMO.md) | Magento config, search icon, Q&A, PLP, videos |
| [README.md](./README.md) | Full setup |
| [HACKATHON_DOCUMENTATION.md](./HACKATHON_DOCUMENTATION.md) | Architecture |
