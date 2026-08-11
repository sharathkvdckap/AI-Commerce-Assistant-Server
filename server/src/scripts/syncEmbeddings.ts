/**
 * CLI: Magento catalog → BGE-M3 → product_embeddings
 *
 * Usage:
 *   npm run sync:embeddings                  # resume (skips indexed SKUs)
 *   npm run sync:embeddings -- --force       # re-embed everything
 *   npm run sync:embeddings -- --concurrency 8
 */
import '../config/env.js'
import { config, isSemanticConfigured } from '../config/env.js'
import { closeContextPool } from '../context/db.js'
import { syncProductEmbeddings } from '../semantic/index.js'

function parseArgs(argv: string[]): { force: boolean; concurrency: number } {
  const force = argv.includes('--force')
  const idx = argv.indexOf('--concurrency')
  const parsed = idx >= 0 ? Number.parseInt(argv[idx + 1] ?? '', 10) : Number.NaN
  return {
    force,
    concurrency: Number.isFinite(parsed)
      ? parsed
      : config.semantic.syncConcurrency,
  }
}

async function main() {
  if (!isSemanticConfigured()) {
    console.error(
      'Semantic search is not configured. Set SEMANTIC_ENABLED=true and DATABASE_URL in server/.env',
    )
    process.exit(1)
  }

  const { force, concurrency } = parseArgs(process.argv.slice(2))
  const started = Date.now()

  console.log(
    `Syncing Magento products → embeddings (concurrency ${concurrency}${force ? ', force' : ', resume'})…`,
  )

  const result = await syncProductEmbeddings({
    concurrency,
    force,
    onProgress: (info) => {
      const mins = (Date.now() - started) / 60000
      const rate = mins > 0 ? Math.round(info.upserted / mins) : 0
      console.log(
        `  page ${info.page}: embedded ${info.upserted}, skipped ${info.skipped}, scanned ${info.scanned}/${info.totalCount} (~${rate}/min)`,
      )
    },
  })

  const elapsed = Math.round((Date.now() - started) / 1000)
  console.log(
    `Done in ${elapsed}s. scanned=${result.scanned} embedded=${result.upserted} skipped=${result.skipped} failed=${result.failed}`,
  )
  if (result.errors.length > 0) {
    console.log('Sample errors:')
    for (const err of result.errors) console.log(`  - ${err}`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeContextPool()
  })
