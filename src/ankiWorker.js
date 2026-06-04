// ankiWorker.js - runs in a Web Worker to avoid blocking the main thread

import JSZip from 'jszip'
import { storeMedia, getMimeType, isImage, isAudio } from './mediaStore.js'

// Can't use supabase directly in worker, so we skip upload here
// Upload happens on main thread after worker returns

self.onmessage = async (e) => {
  const { file, hasUser } = e.data

  try {
    self.postMessage({ type: 'progress', phase: 'unzip', message: 'Unzipping deck...' })

    // 1. Unzip
    const zip = await JSZip.loadAsync(file)

    // 2. Parse media manifest
    const mediaMap = {}
    const mediaFile = zip.file('media')
    if (mediaFile) {
      try {
        const mediaJson = await mediaFile.async('string')
        Object.assign(mediaMap, JSON.parse(mediaJson))
      } catch {}
    }

    // 3. Extract media files into IndexedDB
    const mediaKeys = Object.keys(mediaMap)
    let storedCount = 0
    const mediaIndex = {} // filename → { arrayBuffer, mimeType, publicUrl: null }

    for (const idx of mediaKeys) {
      const filename = mediaMap[idx]
      if (!isImage(filename) && !isAudio(filename)) continue
      const mediaZipFile = zip.file(idx)
      if (!mediaZipFile) continue

      try {
        const arrayBuffer = await mediaZipFile.async('arraybuffer')
        const mimeType = getMimeType(filename)
        await storeMedia(`anki:${filename}`, arrayBuffer, mimeType)
        storedCount++
        mediaIndex[filename] = { arrayBuffer, mimeType, publicUrl: null }
        self.postMessage({ type: 'progress', phase: 'media', stored: storedCount, total: mediaKeys.length, message: `Storing media ${storedCount}/${mediaKeys.length}...` })
      } catch (e) {
        console.warn('Failed to store media:', filename, e)
      }
    }

    // 4. Load sql.js
    self.postMessage({ type: 'progress', phase: 'sql', message: 'Loading database...' })
    const initSqlJs = (await import('sql.js')).default
    const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' })

    // 5. Find database
    const dbFile = zip.file('collection.anki21') ||
                   zip.file('collection.anki2') ||
                   zip.file('collection.anki21b')

    if (!dbFile) {
      const files = Object.keys(zip.files).join(', ')
      throw new Error(`No Anki database found. Files in archive: ${files}`)
    }

    if (dbFile.name === 'collection.anki21b') {
      throw new Error(
        'This deck uses the newer Anki 2.1.50+ format. ' +
        'To import: open Anki → File → Export → check "Legacy format" → Export.'
      )
    }

    self.postMessage({ type: 'progress', phase: 'parse', message: 'Parsing cards...' })
    const dbBuffer = await dbFile.async('arraybuffer')
    const db = new SQL.Database(new Uint8Array(dbBuffer))

    // 6. Load deck names
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

      const front = processAnkiHtml(fields[0] || '', mediaIndex)
      const back = processAnkiHtml(fields[1] || '', mediaIndex)

      const textFront = front.replace(/<[^>]+>/g, '').trim()
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
        // Store media info for main thread to upload to Supabase
        _mediaFiles: hasMedia ? Object.entries(mediaIndex).map(([filename, info]) => ({
          filename,
          mimeType: info.mimeType,
          // Can't transfer ArrayBuffer directly in postMessage without transferable
          // Main thread will re-read from IndexedDB for upload
        })) : [],
      })

      processed++
      if (processed % 50 === 0) {
        self.postMessage({ type: 'progress', phase: 'cards', processed, total: rows.length, message: `Parsing ${processed}/${rows.length} cards...` })
      }
    }

    self.postMessage({
      type: 'done',
      cards,
      mediaCount: storedCount,
      mediaFilenames: Object.keys(mediaIndex),
    })

  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) })
  }
}

function processAnkiHtml(html, mediaIndex) {
  if (!html) return ''

  // Convert sound tags
  html = html.replace(/\[sound:([^\]]+)\]/g, (_, filename) => {
    if (isAudio(filename)) {
      return `<audio-ref src="anki:${filename}"></audio-ref>`
    }
    return ''
  })

  // Process img tags - mark with data-anki-src for local IndexedDB resolution
  html = html.replace(/<img([^>]*?)src="([^"]+)"([^>]*?)>/gi, (_, pre, src, post) => {
    if (src.startsWith('http') || src.startsWith('data:')) {
      return `<img${pre}src="${src}"${post}>`
    }
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
