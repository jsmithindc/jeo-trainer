const CARDS_KEY = 'coryat-flashcards-v1'
const GAMES_KEY = 'coryat-games-v1'
const GAME_STATE_KEY = 'coryat-game-state-v1'
const EPISODE_CACHE_KEY = 'coryat-episode-cache-v1'

function get(key) { try { return JSON.parse(localStorage.getItem(key)) } catch { return null } }

// A silent write failure is how a deck disappears: the app keeps showing cards that
// were never persisted, and the next reload loses everything since the last good
// write. Report failures so callers can surface them instead of guessing.
let onStorageError = null
export function setStorageErrorHandler(fn) { onStorageError = fn }

function set(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val))
    return true
  } catch (err) {
    const quota = err?.name === 'QuotaExceededError' || err?.code === 22
    console.error('[storage] write failed:', key, err?.name || err)
    if (onStorageError) {
      onStorageError(quota
        ? 'Out of local storage — recent changes were not saved. Free space in Settings, or sign in so your data syncs.'
        : `Could not save locally (${err?.name || 'unknown error'}). Recent changes may be lost.`)
    }
    return false
  }
}

export function loadCards() { return get(CARDS_KEY) || [] }
export function saveCards(cards) { return set(CARDS_KEY, cards) }
export function loadGameHistory() { return get(GAMES_KEY) || [] }
export function saveGameHistory(games) { return set(GAMES_KEY, games) }

// ── In-progress game state ────────────────────────────────────────────────────
export function loadGameState() { return get(GAME_STATE_KEY) }
export function saveGameState(state) {
  if (!state) { localStorage.removeItem(GAME_STATE_KEY); return }
  set(GAME_STATE_KEY, { ...state, savedAt: Date.now() })
}
export function clearGameState() { localStorage.removeItem(GAME_STATE_KEY) }

// ── Episode cache ─────────────────────────────────────────────────────────────
export function loadEpisodeCache() { return get(EPISODE_CACHE_KEY) || {} }

export function saveEpisodeToCache(episodeId, episodeData, pinned = false) {
  const cache = loadEpisodeCache()
  cache[episodeId] = { episodeData, cachedAt: Date.now(), pinned }

  // Keep max 10 unpinned episodes — remove oldest unpinned if over limit
  const unpinned = Object.entries(cache)
    .filter(([, v]) => !v.pinned)
    .sort(([, a], [, b]) => a.cachedAt - b.cachedAt)

  if (unpinned.length > 10) {
    unpinned.slice(0, unpinned.length - 10).forEach(([id]) => delete cache[id])
  }

  set(EPISODE_CACHE_KEY, cache)
}

export function getEpisodeFromCache(episodeId) {
  const cache = loadEpisodeCache()
  return cache[episodeId]?.episodeData || null
}

export function pinEpisode(episodeId) {
  const cache = loadEpisodeCache()
  if (cache[episodeId]) { cache[episodeId].pinned = true; set(EPISODE_CACHE_KEY, cache) }
}

export function unpinEpisode(episodeId) {
  const cache = loadEpisodeCache()
  if (cache[episodeId]) { cache[episodeId].pinned = false; set(EPISODE_CACHE_KEY, cache) }
}

export function removeEpisodeFromCache(episodeId) {
  const cache = loadEpisodeCache()
  delete cache[episodeId]
  set(EPISODE_CACHE_KEY, cache)
}

export function getCacheStats() {
  const cache = loadEpisodeCache()
  const entries = Object.entries(cache)
  const totalBytes = JSON.stringify(cache).length
  return {
    total: entries.length,
    pinned: entries.filter(([, v]) => v.pinned).length,
    unpinned: entries.filter(([, v]) => !v.pinned).length,
    sizeKB: Math.round(totalBytes / 1024),
    episodes: entries.map(([id, v]) => ({
      episodeId: id,
      airDate: v.episodeData?.airDate || '',
      episodeNumber: v.episodeData?.singleJeopardy ? v.episodeData.episodeNumber : '',
      cachedAt: v.cachedAt,
      pinned: v.pinned,
    })).sort((a, b) => b.cachedAt - a.cachedAt),
  }
}

// ── Daily study stats ─────────────────────────────────────────────────────────
const DAILY_STATS_KEY = 'jeo-daily-stats'

export function getDailyStats() {
  try {
    const data = JSON.parse(localStorage.getItem(DAILY_STATS_KEY) || '{}')
    const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    if (data.date !== today) return { date: today, cardsReviewed: 0 }
    return data
  } catch { return { date: new Date().toISOString().slice(0, 10), cardsReviewed: 0 } }
}

export function incrementDailyCards(n = 1) {
  const stats = getDailyStats()
  // n can be negative when a rating is undone; never let the day's count go below 0.
  stats.cardsReviewed = Math.max(0, (stats.cardsReviewed || 0) + n)
  localStorage.setItem(DAILY_STATS_KEY, JSON.stringify(stats))
  return stats.cardsReviewed
}

// ── Trash bin (deleted cards, emptied daily) ──────────────────────────────────
const TRASH_KEY = 'jeo-trash'

export function getTrash() {
  try {
    const data = JSON.parse(localStorage.getItem(TRASH_KEY) || '{}')
    const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    if (data.date !== today) return { date: today, cards: [] }
    return data
  } catch { return { date: new Date().toISOString().slice(0, 10), cards: [] } }
}

export function addToTrash(card) {
  const trash = getTrash()
  trash.cards = [{ ...card, deletedAt: Date.now() }, ...trash.cards].slice(0, 100)
  localStorage.setItem(TRASH_KEY, JSON.stringify(trash))
}

export function restoreFromTrash(cardId) {
  const trash = getTrash()
  const card = trash.cards.find(c => c.id === cardId)
  trash.cards = trash.cards.filter(c => c.id !== cardId)
  localStorage.setItem(TRASH_KEY, JSON.stringify(trash))
  return card
}

export function clearTrash() {
  const today = new Date().toISOString().slice(0, 10)
  localStorage.setItem(TRASH_KEY, JSON.stringify({ date: today, cards: [] }))
}

// Deck snapshots moved to IndexedDB in v2.6.0 — see snapshotStore.js

// ── Deletion tombstones ───────────────────────────────────────────────────────
// A card missing from remote is ambiguous: deleted elsewhere, or an upload that
// never landed. Recording deletions explicitly lets the merge tell them apart,
// so a failed upload retries instead of being destroyed.
const TOMBSTONE_KEY = 'jeo-tombstones'
const TOMBSTONE_LIMIT = 1000

export function getTombstones() {
  try { return JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || '[]') } catch { return [] }
}

export function addTombstones(ids) {
  const list = Array.isArray(ids) ? ids : [ids]
  if (!list.length) return
  const now = Date.now()
  const existing = getTombstones()
  const merged = new Map(existing.map(t => [t.id, t]))
  list.filter(Boolean).forEach(id => merged.set(id, { id, deletedAt: now }))
  const next = [...merged.values()]
    .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
    .slice(0, TOMBSTONE_LIMIT)
  set(TOMBSTONE_KEY, next)
}

export function saveTombstones(tombstones) { set(TOMBSTONE_KEY, tombstones || []) }

// Restoring from the trash must clear the tombstone, or the next sync deletes it again.
export function removeTombstone(id) {
  set(TOMBSTONE_KEY, getTombstones().filter(t => t.id !== id))
}

// ─── Review log ───────────────────────────────────────────────────────────────
// True retention — how often a card you had already learned comes back correctly —
// can't be derived from card state, because each review overwrites the last. It needs
// a log, so one starts here. Entries are compact ({t}ime, {q}uality, was it a
// {l}earned card) and capped; this is analytics, not durable data.
const REVIEW_LOG_KEY = 'jeo-review-log'
const REVIEW_LOG_LIMIT = 4000

export function getReviewLog() {
  try { return JSON.parse(localStorage.getItem(REVIEW_LOG_KEY) || '[]') } catch { return [] }
}

export function logReview(quality, wasLearned, ms = null) {
  const log = getReviewLog()
  const entry = { t: Date.now(), q: quality, l: wasLearned ? 1 : 0 }
  if (typeof ms === 'number') entry.ms = ms // retrieval time, absent on older entries
  log.push(entry)
  // Trim from the front so the newest reviews are the ones that survive.
  set(REVIEW_LOG_KEY, log.length > REVIEW_LOG_LIMIT ? log.slice(-REVIEW_LOG_LIMIT) : log)
}

export function removeLastReview() {
  const log = getReviewLog()
  log.pop()
  set(REVIEW_LOG_KEY, log)
}
