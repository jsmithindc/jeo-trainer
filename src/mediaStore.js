// ─── IndexedDB media store ────────────────────────────────────────────────────
const DB_NAME = 'jeo-trainer-media'
const DB_VERSION = 1
const STORE = 'media'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = () => reject(req.error)
  })
}

export async function storeMedia(key, blob, mimeType) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ key, blob, mimeType, storedAt: Date.now() })
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

export async function getMedia(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

export async function getMediaUrl(key) {
  const record = await getMedia(key)
  if (!record) return null
  return URL.createObjectURL(new Blob([record.blob], { type: record.mimeType }))
}

export async function deleteMedia(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearAllMedia() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

export async function getMediaStats() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      const records = req.result
      const totalBytes = records.reduce((sum, r) => sum + (r.blob?.byteLength || 0), 0)
      resolve({ count: records.length, sizeKB: Math.round(totalBytes / 1024) })
    }
    req.onerror = () => reject(req.error)
  })
}

// ─── MIME type detection ──────────────────────────────────────────────────────
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
