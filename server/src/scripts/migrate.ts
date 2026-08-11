/**
 * Apply SQL migrations using DATABASE_URL from server/.env
 *
 * Usage:
 *   npm run db:migrate                 # all files in sql/, in name order
 *   npm run db:migrate 001             # only files matching the argument
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import '../config/env.js'
import { config, isDatabaseConfigured } from '../config/env.js'
import { closeContextPool, getDbPool } from '../context/db.js'

const sqlDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../sql',
)

function redact(url: string): string {
  return url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')
}

async function main() {
  if (!isDatabaseConfigured()) {
    console.error('DATABASE_URL is not set in server/.env')
    process.exit(1)
  }

  const filter = process.argv[2]
  const files = (await readdir(sqlDir))
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => (filter ? f.includes(filter) : true))
    .sort()

  if (files.length === 0) {
    console.error(
      filter
        ? `No .sql files in sql/ matching "${filter}"`
        : 'No .sql files found in sql/',
    )
    process.exit(1)
  }

  console.log(`Database: ${redact(config.context.databaseUrl)}`)
  const pool = getDbPool()

  for (const file of files) {
    const sql = await readFile(path.join(sqlDir, file), 'utf8')
    process.stdout.write(`  applying ${file} … `)
    await pool.query(sql)
    console.log('ok')
  }

  console.log(`Applied ${files.length} migration(s).`)
}

main()
  .catch((error) => {
    console.error('\nMigration failed:')
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeContextPool()
  })
