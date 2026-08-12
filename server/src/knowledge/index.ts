export { loadSheetRows } from './fetch.js'
export {
  countSheetChunks,
  pingSheetKnowledge,
  searchSheetChunks,
} from './repository.js'
export { getSheetIndexStatus, syncSheetKnowledge } from './sync.js'
export {
  attachKnowledgeMessage,
  formatKnowledgeForShopper,
  formatKnowledgePrompt,
  retrieveSheetChunks,
  retrieveSheetChunksSafe,
  type KnowledgeHit,
} from './retrieve.js'
