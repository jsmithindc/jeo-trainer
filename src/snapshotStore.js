// ─── Deck snapshots ───────────────────────────────────────────────────────────
// Snapshots used to live in localStorage, where three copies of a ~2,000-card deck
// came to 2.3 MB — more than twice the deck itself, and roughly two thirds of the
// ~5 MB origin cap. The backup was the biggest single threat to the data it existed
// to protect, because a failed write is swallowed silently.
//
// The payload now lives in IndexedDB (GB-scale). A small index stays in localStorage
// so the "already snapshotted today" check costs a ~100-byte parse instead of
// deserialising megabytes on every single card rating.

const DB_NAME = 'jeo-trainer-snapshots'
const DB_VERSION = 1
const STORE = 'snapshots'
const META_KEY = 'jeo-snapshot-meta'
const LEGACY_KEY = 'jeo-deck-snapshot' // localStorage payload, pre-2.6.0
const MAX_SNAPSHOTS = 3

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'date' })
    }
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = e => { dbPromise = null; reject(e.target.error) }
    // Unlike the media store, a blocked upgrade must never delete anything here.
    req.onblocked = () => { dbPromise = null; reject(new Error('Snapshot DB blocked by another tab')) }
  })
  return dbPromise
}

function tx(db, mode) { return db.transaction(STORE, mode).objectStore(STORE) }

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Index (localStorage, tiny) ────────────────────────────────────────────────
export function getSnapshotMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '[]') } catch { return [] }
}

function setSnapshotMeta(meta) {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); return true } catch { return false }
}

// The legacy move and an ordinary save both write the index and prune the store, so
// a save racing the migration would prune the very rows the migration is writing.
// Everything that touches the store waits on this first.
let migrationPromise = null
export function ensureSnapshotsMigrated() {
  if (!migrationPromise) migrationPromise = migrateLegacySnapshots().catch(() => 0)
  return migrationPromise
}
const ensureMigrated = ensureSnapshotsMigrated

// ── Write ─────────────────────────────────────────────────────────────────────
export async function saveDeckSnapshot(cards) {
  await ensureMigrated()
  const date = today()
  const meta = getSnapshotMeta()

  // Cheap guard, before any serialisation — this runs on every card rating.
  if (meta.length && meta[0].date === date && Math.abs(meta[0].count - cards.length) < 5) return false

  // Images are re-fetchable; keeping them would multiply the snapshot size.
  const slim = cards.map(c => { if (!c.image) return c; const { image, ...rest } = c; return rest })

  try {
    const db = await openDB()
    await new Promise((resolve, reject) => {
      const store = tx(db, 'readwrite')
      store.put({ date, count: slim.length, cards: slim, savedAt: Date.now() })
      store.transaction.oncomplete = resolve
      store.transaction.onerror = () => reject(store.transaction.error)
    })

    const next = [{ date, count: slim.length, savedAt: Date.now() },
                  ...meta.filter(m => m.date !== date)].slice(0, MAX_SNAPSHOTS)
    setSnapshotMeta(next)

    // Drop anything that fell off the end so the store can't grow without bound.
    const keep = new Set(next.map(m => m.date))
    const db2 = await openDB()
    await new Promise(resolve => {
      const store = tx(db2, 'readwrite')
      const req = store.getAllKeys()
      req.onsuccess = () => {
        req.result.filter(k => !keep.has(k)).forEach(k => store.delete(k))
        store.transaction.oncomplete = resolve
        store.transaction.onerror = resolve
      }
      req.onerror = resolve
    })
    return true
  } catch (err) {
    console.warn('[snapshot] save failed:', err.message)
    return false
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────
export async function getDeckSnapshots() {
  await ensureMigrated()
  try {
    const db = await openDB()
    const all = await new Promise((resolve, reject) => {
      const req = tx(db, 'readonly').getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
    return all.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
  } catch {
    return []
  }
}

export async function restoreSnapshot(index = 0) {
  const snapshots = await getDeckSnapshots()
  return snapshots[index]?.cards || null
}

// ── One-off move out of localStorage ──────────────────────────────────────────
// Frees ~2.3 MB. Only removes the legacy key once the copy is safely in IndexedDB.
async function migrateLegacySnapshots() {
  let legacy
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return 0
    legacy = JSON.parse(raw)?.snapshots || []
  } catch {
    localStorage.removeItem(LEGACY_KEY) // unparseable, nothing to preserve
    return 0
  }
  if (!legacy.length) { localStorage.removeItem(LEGACY_KEY); return 0 }

  try {
    const db = await openDB()
    await new Promise((resolve, reject) => {
      const store = tx(db, 'readwrite')
      legacy.forEach((s, i) => store.put({
        date: s.date || `legacy-${i}`,
        count: s.count ?? s.cards?.length ?? 0,
        cards: s.cards || [],
        savedAt: Date.now() - i, // preserve ordering, newest first
      }))
      store.transaction.oncomplete = resolve
      store.transaction.onerror = () => reject(store.transaction.error)
    })

    setSnapshotMeta(legacy.slice(0, MAX_SNAPSHOTS).map((s, i) => ({
      date: s.date || `legacy-${i}`,
      count: s.count ?? s.cards?.length ?? 0,
      savedAt: Date.now() - i,
    })))

    localStorage.removeItem(LEGACY_KEY) // only after the copy is committed
    return legacy.length
  } catch (err) {
    console.warn('[snapshot] migration failed, leaving localStorage copy in place:', err.message)
    return 0
  }
}
