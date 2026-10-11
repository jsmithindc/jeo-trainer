// Unfinished games, one per episode, kept as { games: { [episodeKey]: state }, removed: { [episodeKey]: ms } }.
//
// There used to be a single slot, locally and on the server, so starting a second game
// silently overwrote the first. `removed` records finished and discarded games, so a stale
// copy on another device can't bring one back when the two copies are merged.

export const LOCAL_LIMIT = 10
export const SERVER_LIMIT = 5
const REMOVED_TTL = 30 * 864e5

export const gameKey = state => String(state?.episodeMeta?.episodeId ?? state?.episodeMeta?.episodeNumber ?? '')
const savedAtMs = state => new Date(state?.savedAt || 0).getTime() || 0

export function emptyDoc() {
  return { games: {}, removed: {} }
}

/** Accepts the current shape, the single-game object older versions stored, or nothing. */
export function normalizeGameDoc(raw) {
  if (!raw || typeof raw !== 'object') return { ...emptyDoc(), rev: 0 }
  if (raw.episodeMeta) {
    const key = gameKey(raw)
    return { games: key ? { [key]: raw } : {}, removed: {}, rev: 0 }
  }
  return { games: { ...(raw.games || {}) }, removed: { ...(raw.removed || {}) }, rev: Number(raw.rev) || 0 }
}

function newestFirst(games) {
  return Object.entries(games).sort(([, a], [, b]) => savedAtMs(b) - savedAtMs(a))
}

function tidy({ games, removed }, limit, now) {
  const keptRemoved = Object.fromEntries(Object.entries(removed).filter(([, t]) => now - t < REMOVED_TTL))
  const live = Object.fromEntries(
    newestFirst(games)
      .filter(([key, g]) => g?.episodeMeta && !g.fjAnswered && !((keptRemoved[key] || 0) >= savedAtMs(g)))
      .slice(0, limit),
  )
  return { games: live, removed: keptRemoved }
}

/** Per game, the newer save wins; a removal newer than a save deletes it. */
export function mergeGameDocs(a, b, { limit = LOCAL_LIMIT, now = Date.now() } = {}) {
  const A = normalizeGameDoc(a), B = normalizeGameDoc(b)
  const removed = { ...A.removed }
  for (const [key, t] of Object.entries(B.removed)) removed[key] = Math.max(removed[key] || 0, t)
  const games = { ...A.games }
  for (const [key, g] of Object.entries(B.games)) {
    if (!games[key] || savedAtMs(g) > savedAtMs(games[key])) games[key] = g
  }
  return tidy({ games, removed }, limit, now)
}

export function upsertGame(doc, state, { limit = LOCAL_LIMIT, now = Date.now() } = {}) {
  const d = normalizeGameDoc(doc)
  const key = gameKey(state)
  if (!key) return tidy(d, limit, now)
  // Saving a game again un-removes it: you restarted or replayed that episode.
  const { [key]: _, ...removed } = d.removed
  return tidy({ games: { ...d.games, [key]: state }, removed }, limit, now)
}

export function removeGame(doc, key, { now = Date.now() } = {}) {
  const d = normalizeGameDoc(doc)
  const { [key]: _, ...games } = d.games
  return tidy({ games, removed: { ...d.removed, [key]: now } }, LOCAL_LIMIT, now)
}

/** The server copy: fewer games, and without `board`, which is rebuilt from episodeData on resume. */
export function trimForServer(doc, { limit = SERVER_LIMIT, now = Date.now() } = {}) {
  const d = tidy(normalizeGameDoc(doc), limit, now)
  const games = Object.fromEntries(Object.entries(d.games).map(([k, { board, ...rest }]) => [k, rest]))
  return { games, removed: d.removed }
}

export function listUnfinished(doc) {
  return newestFirst(normalizeGameDoc(doc).games)
    .map(([, g]) => g)
    .filter(g => g?.episodeMeta && !g.fjAnswered)
}
