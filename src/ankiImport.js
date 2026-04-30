import JSZip from 'jszip'
import { newCard } from './srs.js'

/**
 * Parse an Anki .apkg file and return an array of card objects.
 *
 * .apkg structure:
 *   collection.anki2  — SQLite database (old format)
 *   collection.anki21 — SQLite database (new format, preferred)
 *   media             — JSON mapping of media file indices to filenames
 *   0, 1, 2, ...      — media files (images/audio, we skip these)
 *
 * Relevant tables in the SQLite DB:
 *   notes  — id, flds (fields separated by \x1f), tags, mid (model id)
 *   cards  — id, nid (note id), due, ivl (interval), factor (ease*1000), reps
 *   col    — models (JSON), decks (JSON)
 */
export async function parseApkg(file) {
  // 1. Unzip
  const zip = await JSZip.loadAsync(file)

  // 2. Load sql.js WASM
  const initSqlJs = (await import('sql.js')).default
  const SQL = await initSqlJs({
    // Point to the WASM file — Vite will copy it to dist
    locateFile: (filename) => `/${filename}`
  })

  // 3. Find the database file (prefer .anki21)
  const dbFile = zip.file('collection.anki21') || zip.file('collection.anki2')
  if (!dbFile) throw new Error('No Anki database found in this file.')

  const dbBuffer = await dbFile.async('arraybuffer')
  const db = new SQL.Database(new Uint8Array(dbBuffer))

  // 4. Load model info so we know field names
  let fieldNamesByModel = {}
  try {
    const colRows = db.exec('SELECT models FROM col LIMIT 1')
    if (colRows.length && colRows[0].values.length) {
      const models = JSON.parse(colRows[0].values[0][0])
      for (const [mid, model] of Object.entries(models)) {
        fieldNamesByModel[mid] = model.flds.map(f => f.name)
      }
    }
  } catch {
    // Non-critical — we'll fall back to Front/Back positionally
  }

  // 5. Load deck names
  let deckNames = {}
  try {
    const colRows = db.exec('SELECT decks FROM col LIMIT 1')
    if (colRows.length && colRows[0].values.length) {
      const decks = JSON.parse(colRows[0].values[0][0])
      for (const [did, deck] of Object.entries(decks)) {
        deckNames[did] = deck.name
      }
    }
  } catch {}

  // 6. Query notes joined with cards for SRS state
  // We join notes → cards to get existing interval/ease if re-importing a studied deck
  let rows
  try {
    const result = db.exec(`
      SELECT
        n.id,
        n.flds,
        n.tags,
        n.mid,
        c.ivl,
        c.factor,
        c.reps,
        c.due,
        c.did
      FROM notes n
      LEFT JOIN cards c ON c.nid = n.id
      GROUP BY n.id
    `)
    rows = result.length ? result[0].values : []
  } catch {
    // Fallback: just notes without card SRS data
    const result = db.exec('SELECT id, flds, tags, mid, 0, 2500, 0, 0, 0 FROM notes')
    rows = result.length ? result[0].values : []
  }

  db.close()

  // 7. Convert rows to our card format
  const cards = []
  for (const [nid, flds, tags, mid, ivl, factor, reps, due, did] of rows) {
    const fields = flds.split('\x1f').map(f => stripHtml(f).trim())
    if (fields.length < 2) continue

    const fieldNames = fieldNamesByModel[mid] || []
    const front = fields[0] || ''
    const back = fields[1] || ''
    if (!front || !back) continue

    const category = (tags || '').trim().split(' ').filter(Boolean).join(', ') || ''
    const deckName = deckNames[did] || ''

    // Re-use existing SRS state if the deck was already studied
    const intervalDays = Math.max(0, ivl || 0)
    const easeFactor = Math.max(1.3, (factor || 2500) / 1000)
    const repetitions = reps || 0
    const dueAt = intervalDays > 0
      ? Date.now() + intervalDays * 24 * 60 * 60 * 1000
      : Date.now()

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
