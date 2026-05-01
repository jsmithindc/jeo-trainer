import JSZip from 'jszip'
import { newCard } from './srs.js'
import { storeMedia, getMimeType, isImage, isAudio } from './mediaStore.js'
import { uploadMedia } from './supabase.js'

/**
 * Parse an Anki .apkg file.
 * - Extracts cards from SQLite
 * - Stores media in IndexedDB (local, always works)
 * - If user is logged in, also uploads media to Supabase Storage
 *   and rewrites img/audio src to public URLs (syncs across devices)
 */
export async function parseApkg(file, onProgress = null, user = null) {
  // 1. Unzip
  const zip = await JSZip.loadAsync(file)

  // 2. Parse media manifest
  const mediaMap = {} // index → original filename
  const mediaFile = zip.file('media')
  if (mediaFile) {
    try {
      const mediaJson = await mediaFile.async('string')
      Object.assign(mediaMap, JSON.parse(mediaJson))
    } catch {}
  }

  // 3. Extract media files
  // Build a map of filename → { arrayBuffer, mimeType, publicUrl }
  const mediaIndex = {} // filename → { arrayBuffer, mimeType, publicUrl? }
  const mediaKeys = Object.keys(mediaMap)
  let storedCount = 0

  for (const idx of mediaKeys) {
    const filename = mediaMap[idx]
    if (!isImage(filename) && !isAudio(filename)) continue
    const mediaZipFile = zip.file(idx)
    if (!mediaZipFile) continue

    try {
      const arrayBuffer = await mediaZipFile.async('arraybuffer')
      const mimeType = getMimeType(filename)

      // Always store locally in IndexedDB
      await storeMedia(`anki:${filename}`, arrayBuffer, mimeType)

      let publicUrl = null

      // If logged in, upload to Supabase Storage
      if (user) {
        try {
          publicUrl = await uploadMedia(filename, arrayBuffer, mimeType)
          if (onProgress) onProgress({ phase: 'upload', file: filename, stored: ++storedCount, total: mediaKeys.length })
        } catch (uploadErr) {
          console.warn('Media upload failed for', filename, uploadErr.message)
        }
      } else {
        storedCount++
        if (onProgress) onProgress({ phase: 'media', stored: storedCount, total: mediaKeys.length })
      }

      mediaIndex[filename] = { arrayBuffer, mimeType, publicUrl }
    } catch {}
  }

  // 4. Load sql.js
  const initSqlJs = (await import('sql.js')).default
  const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' })

  // 5. Find database
  const dbFile = zip.file('collection.anki21') || zip.file('collection.anki2')
  if (!dbFile) throw new Error('No Anki database found in this file.')

  const dbBuffer = await dbFile.async('arraybuffer')
  const db = new SQL.Database(new Uint8Array(dbBuffer))

  // 6. Load model/deck info
  let deckNames = {}
  try {
    const colRows = db.exec('SELECT models, decks FROM col LIMIT 1')
    if (colRows.length && colRows[0].values.length) {
      const [, decksJson] = colRows[0].values[0]
      const decks = JSON.parse(decksJson)
      for (const [did, deck] of Object.entries(decks)) {
        deckNames[did] = deck.name
      }
    }
  } catch {}

  // 7. Query notes + cards
  let rows = []
  try {
    const result = db.exec(`
      SELECT n.id, n.flds, n.tags, n.mid,
             c.ivl, c.factor, c.reps, c.due, c.did, c.lapses
      FROM notes n
      LEFT JOIN cards c ON c.nid = n.id
      GROUP BY n.id
    `)
    rows = result.length ? result[0].values : []
  } catch {
    const result = db.exec('SELECT id, flds, tags, mid, 0, 2500, 0, 0, 0, 0 FROM notes')
    rows = result.length ? result[0].values : []
  }

  db.close()

  // 8. Convert rows to cards
  const cards = []
  let processed = 0

  for (const [nid, flds, tags, mid, ivl, factor, reps, due, did, lapses] of rows) {
    const fields = flds.split('\x1f')
    if (fields.length < 2) continue

    // Process HTML, replacing media references with URLs
    const front = processAnkiHtml(fields[0] || '', mediaIndex, user)
    const back = processAnkiHtml(fields[1] || '', mediaIndex, user)

    const textFront = front.replace(/<[^>]+>/g, '').trim()
    const textBack = back.replace(/<[^>]+>/g, '').trim()
    if (!textFront && !front.includes('<img') && !front.includes('<audio')) continue

    const category = (tags || '').trim().split(' ').filter(Boolean).join(', ') || ''
    const deckName = deckNames[did] || ''
    const intervalDays = Math.max(0, ivl || 0)
    const easeFactor = Math.max(1.3, (factor || 2500) / 1000)
    const repetitions = reps || 0
    const cardLapses = lapses || 0
    const dueAt = intervalDays > 0 ? Date.now() + intervalDays * 24 * 60 * 60 * 1000 : Date.now()
    const hasMedia = front.includes('<img') || front.includes('<audio') ||
                     back.includes('<img') || back.includes('<audio')

    cards.push({
      id: `anki-${nid}-${Math.random().toString(36).slice(2)}`,
      front,
      back,
      category: [deckName, category].filter(Boolean).join(' · ') || '',
      value: 0,
      source: 'anki',
      hasMedia,
      interval: intervalDays,
      easeFactor,
      repetitions,
      lapses: cardLapses,
      dueAt,
      lastReviewed: null,
      createdAt: Date.now(),
    })

    processed++
    if (onProgress && processed % 50 === 0) {
      onProgress({ phase: 'cards', processed, total: rows.length })
    }
  }

  return { cards, mediaCount: storedCount }
}

/**
 * Process Anki HTML:
 * - If user is logged in and media was uploaded, use public Supabase URLs
 * - Otherwise, mark with data-anki-src for local IndexedDB resolution
 * - Convert [sound:] tags to <audio> elements
 * - Strip dangerous HTML
 */
function processAnkiHtml(html, mediaIndex, user) {
  if (!html) return ''

  // Convert sound tags
  html = html.replace(/\[sound:([^\]]+)\]/g, (_, filename) => {
    const media = mediaIndex[filename]
    if (!media) return ''
    if (media.publicUrl) {
      return `<audio controls style="width:100%;margin-top:8px"><source src="${media.publicUrl}" type="${media.mimeType}"></audio>`
    }
    return `<audio-ref src="anki:${filename}"></audio-ref>`
  })

  // Process img tags
  html = html.replace(/<img([^>]*?)src="([^"]+)"([^>]*?)>/gi, (_, pre, src, post) => {
    // Already a full URL — keep as-is
    if (src.startsWith('http') || src.startsWith('data:')) {
      return `<img${pre}src="${src}"${post}>`
    }

    const media = mediaIndex[src]
    if (media?.publicUrl) {
      // Use Supabase public URL — works on all devices
      return `<img${pre}src="${media.publicUrl}"${post} style="max-width:100%;height:auto;border-radius:6px">`
    }

    // Fall back to local IndexedDB reference
    return `<img${pre}data-anki-src="anki:${src}" src=""${post} style="max-width:100%;height:auto;border-radius:6px">`
  })

  // Remove dangerous content
  html = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/javascript:/gi, '')

  return html.trim()
}

/**
 * Migrate existing local media to Supabase Storage.
 * Called when a user logs in and has local media that wasn't uploaded.
 * Returns count of migrated files.
 */
export async function migrateLocalMediaToSupabase(user, onProgress = null) {
  if (!user) return 0

  // Get all keys from IndexedDB
  const { openDB } = await import('./mediaStore.js')

  // We'll re-import by reading from IndexedDB directly
  // Get all stored media records
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('jeo-trainer-media', 1)
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = () => reject(req.error)
  })

  const records = await new Promise((resolve, reject) => {
    const tx = db.transaction('media', 'readonly')
    const req = tx.objectStore('media').getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  let migrated = 0
  for (const record of records) {
    if (!record.key.startsWith('anki:')) continue
    const filename = record.key.replace('anki:', '')
    try {
      await uploadMedia(filename, record.blob, record.mimeType)
      migrated++
      if (onProgress) onProgress({ migrated, total: records.length })
    } catch {}
  }

  return migrated
}
