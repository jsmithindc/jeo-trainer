const CARDS_KEY = 'coryat-flashcards-v1'
const GAMES_KEY = 'coryat-games-v1'
const GAME_STATE_KEY = 'coryat-game-state-v1'
const EPISODE_CACHE_KEY = 'coryat-episode-cache-v1'

function get(key) { try { return JSON.parse(localStorage.getItem(key)) } catch { return null } }
function set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)) } catch {} }

export function loadCards() { return get(CARDS_KEY) || [] }
export function saveCards(cards) { set(CARDS_KEY, cards) }
export function loadGameHistory() { return get(GAMES_KEY) || [] }
export function saveGameHistory(games) { set(GAMES_KEY, games) }

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
