/**
 * CLI: Google Sheet / CSV → BGE-M3 → sheet_chunks
 *
 * Usage:
 *   npm run sync:sheets                  # resume (skips indexed row ids)
 *   npm run sync:sheets -- --force       # re-embed everything
 *   npm run sync:sheets -- --concurrency 8
 */
import '../config/env.js'
import { config, isSheetRagConfigured } from '../config/env.js'
import { closeContextPool } from '../context/db.js'
import { syncSheetKnowledge } from '../knowledge/index.js'

function parseArgs(argv: string[]): { force: boolean; concurrency: number } {
  const force = argv.includes('--force')
  const idx = argv.indexOf('--concurrency')
  const parsed = idx >= 0 ? Number.parseInt(argv[idx + 1] ?? '', 10) : Number.NaN
  return {
    force,
    concurrency: Number.isFinite(parsed)
      ? parsed
      : config.sheetRag.syncConcurrency,
  }
}

async function main() {
  if (!isSheetRagConfigured()) {
    console.error(
      'Sheet RAG is not configured. Set SHEET_RAG_ENABLED=true and DATABASE_URL in server/.env',
    )
    process.exit(1)
  }

  const { force, concurrency } = parseArgs(process.argv.slice(2))
  const started = Date.now()

  console.log(
    `Syncing merchant sheet → embeddings (concurrency ${concurrency}${force ? ', force' : ', resume'})…`,
  )
  if (config.sheetRag.csvUrl) {
    console.log(`  URL: ${config.sheetRag.csvUrl}`)
  } else {
    console.log(`  File: ${config.sheetRag.csvPath}`)
  }

  const result = await syncSheetKnowledge({
    concurrency,
    force,
    onProgress: (info) => {
      console.log(
        `  embedded ${info.upserted}, skipped ${info.skipped}, scanned ${info.scanned}/${info.totalCount}`,
      )
    },
  })

  const elapsed = Math.round((Date.now() - started) / 1000)
  console.log(
    `Done in ${elapsed}s. scanned=${result.scanned} embedded=${result.upserted} skipped=${result.skipped} failed=${result.failed} removed=${result.removed}`,
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
