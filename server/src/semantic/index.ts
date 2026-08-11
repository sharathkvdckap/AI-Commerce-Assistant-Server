export {
  syncProductEmbeddings,
  searchSemanticProducts,
  hydrateSemanticHits,
  buildSemanticQueryText,
  getSemanticIndexStatus,
} from './sync.js'
export { mergeAndRerank, scoreProduct } from './rerank.js'
export {
  countProductEmbeddings,
  searchProductEmbeddings,
  upsertProductEmbedding,
} from './repository.js'
