import { readFile } from 'node:fs/promises'
import { config } from '../config/env.js'
import { csvRowsToObjects, parseCsv } from './parseCsv.js'

export interface SheetRow {
  id: string
  topic: string
  sku: string
  question: string
  answer: string
  content: string
}

function cell(obj: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]?.trim()
    if (value) return value
  }
  return ''
}

export function objectsToSheetRows(
  objects: Record<string, string>[],
): SheetRow[] {
  const rows: SheetRow[] = []
  for (let i = 0; i < objects.length; i += 1) {
    const obj = objects[i]
    const question = cell(obj, 'question', 'title', 'q')
    const answer = cell(obj, 'answer', 'content', 'text', 'a')
    if (!question && !answer) continue

    const topic = cell(obj, 'topic', 'category')
    const sku = cell(obj, 'sku', 'product_sku')
    const id = cell(obj, 'id', 'row_id') || `row-${i + 1}`
    const parts = [topic, question, answer, sku ? `SKU ${sku}` : '']
      .filter(Boolean)
      .join(' · ')

    rows.push({
      id,
      topic,
      sku,
      question,
      answer,
      content: parts.replace(/\s+/g, ' ').trim(),
    })
  }
  return rows
}

async function fetchCsvUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: 'text/csv,text/plain,*/*' },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) {
    throw new Error(`Sheet CSV fetch failed (${res.status})`)
  }
  return res.text()
}

export async function loadSheetRows(): Promise<{
  rows: SheetRow[]
  source: string
}> {
  const url = config.sheetRag.csvUrl
  const filePath = config.sheetRag.csvPath

  if (url) {
    try {
      const text = await fetchCsvUrl(url)
      return {
        rows: objectsToSheetRows(csvRowsToObjects(parseCsv(text))),
        source: url,
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'fetch_failed'
      console.warn(`[knowledge] CSV URL failed (${msg}); trying local file`)
    }
  }

  if (!filePath) {
    throw new Error('Set SHEET_CSV_URL or SHEET_CSV_PATH')
  }

  const text = await readFile(filePath, 'utf8')
  return {
    rows: objectsToSheetRows(csvRowsToObjects(parseCsv(text))),
    source: filePath,
  }
}
