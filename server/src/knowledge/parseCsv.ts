/** RFC 4180-ish CSV parser (quoted fields, commas, newlines). */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    const next = input[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"'
        i += 1
      } else if (ch === '"') {
        inQuotes = false
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      continue
    }
    if (ch === '\n') {
      row.push(field)
      field = ''
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
      continue
    }
    if (ch === '\r') continue
    field += ch
  }

  row.push(field)
  if (row.some((cell) => cell.trim())) rows.push(row)
  return rows
}

export function csvRowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return []
  const headers = rows[0].map((h) => h.trim().toLowerCase())
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {}
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i]
      if (!key) continue
      obj[key] = (cells[i] ?? '').trim()
    }
    return obj
  })
}
