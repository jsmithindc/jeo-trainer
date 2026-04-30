import JSZip from 'jszip'
import { newCard } from './srs.js'

export async function parseApkg(file) {
  const zip = await JSZip.loadAsync(file)

  // Load sql.js — point to the wasm file in the public dir
  const initSqlJs = (await import('sql.js')).default
  const SQL = await initSqlJs({
    locateFile: (filename) => {
      // Try multiple paths for PWA compatibility
      if (filename.endsWith('.wasm')) {
        return '/sql-wasm.wasm'
      }
      return filename
    }
  })

  const dbFile = zip.file('collection.anki21') || zip.file('collection.anki2')
  if (!dbFile) throw new Error('No Anki database found in this file.')

  const dbBuffer = await dbFile.async('arraybuffer')
  const db = new SQL.Database(new Uint8Array(dbBuffer))

  let fieldNamesByModel = {}
  let deckNames = {}

  try {
    const colRows = db.exec('SELECT models, decks FROM col LIMIT 1')
    if (colRows.length && colRows[0].values.length) {
      const [modelsJson, decksJson] = colRows[0].values[0]
      const models = JSON.parse(modelsJson)
      const decks = JSON.parse(decksJson)
      for (const [mid, model] of Object.entries(models)) {
        fieldNamesByModel[mid] = model.flds.map(f => f.name)
      }
      for (const [did, deck] of Object.entries(decks)) {
        deckNames[did] = deck.name
      }
    }
  } catch {}

  let rows = []
  try {
    const result = db.exec(`
      SELECT n.id, n.flds, n.tags, n.mid,
             c.ivl, c.factor, c.reps, c.due, c.did
      FROM notes n
      LEFT JOIN cards c ON c.nid = n.id
      GROUP BY n.id
    `)
    rows = result.length ? result[0].values : []
  } catch {
    const result = db.exec('SELECT id, flds, tags, mid, 0, 2500, 0, 0, 0 FROM notes')
    rows = result.length ? result[0].values : []
  }

  db.close()

  const cards = []
  for (const [nid, flds, tags, mid, ivl, factor, reps, due, did] of rows) {
    const fields = flds.split('\x1f').map(f => stripHtml(f).trim())
    if (fields.length < 2) continue
    const front = fields[0] || ''
    const back = fields[1] || ''
    if (!front || !back) continue

    const category = (tags || '').trim().split(' ').filter(Boolean).join(', ') || ''
    const deckName = deckNames[did] || ''
    const intervalDays = Math.max(0, ivl || 0)
    const easeFactor = Math.max(1.3, (factor || 2500) / 1000)
    const repetitions = reps || 0
    const dueAt = intervalDays > 0 ? Date.now() + intervalDays * 24 * 60 * 60 * 1000 : Date.now()

    cards.push({
      id: `anki-${nid}-${Math.random().toString(36).slice(2)}`,
      front,
      back,
      category: [deckName, category].filter(Boolean).join(' · ') || '',
      value: 0,
      source: 'anki',
      interval: intervalDays,
      easeFactor,
      repetitions,
      dueAt,
      lastReviewed: null,
      createdAt: Date.now(),
    })
  }

  return cards
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim()
}
