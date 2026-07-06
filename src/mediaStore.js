// ─── IndexedDB media store ────────────────────────────────────────────────────
const DB_NAME = 'jeo-trainer-media'
const DB_VERSION = 4  // bumped again to force upgrade
const STORE = 'media'

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = e => {
      const db = e.target.result
      // Delete and recreate store if upgrading from old version without 'media' store
      if (e.oldVersion < 2) {
        // Old version had different structure, recreate
        try { db.deleteObjectStore(STORE) } catch {}
      }
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    }

    req.onsuccess = e => resolve(e.target.result)

    req.onerror = e => {
      dbPromise = null
      reject(e.target.error)
    }

    req.onblocked = () => {
      // Another tab has the DB open - delete and retry
      dbPromise = null
      indexedDB.deleteDatabase(DB_NAME)
      reject(new Error('DB blocked - will retry on reload'))
    }
  })
  return dbPromise
}

async function withDB(fn) {
  try {
    const db = await openDB()
    return await fn(db)
  } catch (err) {
    // Silently fail - media store is non-critical
    console.warn('MediaStore error:', err.message)
    return null
  }
}

export async function storeMedia(key, blob, mimeType) {
  return withDB(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ key, blob, mimeType, storedAt: Date.now() })
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  }))
}

export async function getMedia(key) {
  return withDB(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  }))
}

export async function getMediaUrl(key) {
  const record = await getMedia(key)
  if (!record) return null
  return URL.createObjectURL(new Blob([record.blob], { type: record.mimeType }))
}

export async function deleteMedia(key) {
  return withDB(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  }))
}

export async function clearAllMedia() {
  return withDB(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  }))
}

export async function getMediaStats() {
  const result = await withDB(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
  if (!result) return { count: 0, sizeKB: 0 }
  const totalBytes = result.reduce((sum, r) => sum + (r.blob?.byteLength || 0), 0)
  return { count: result.length, sizeKB: Math.round(totalBytes / 1024) }
}

export function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase()
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml',
    mp3: 'audio/mpeg', ogg: 'audio/ogg',
    mp4: 'video/mp4', m4a: 'audio/mp4',
  }
  return map[ext] || 'application/octet-stream'
}

export function isImage(filename) {
  const ext = filename.split('.').pop().toLowerCase()
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)
}

export function isAudio(filename) {
  const ext = filename.split('.').pop().toLowerCase()
  return ['mp3', 'ogg', 'm4a', 'wav'].includes(ext)
}
