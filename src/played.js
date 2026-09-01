// Deciding whether an episode has been played is not as simple as comparing ids.
// Games recorded before the app stored gameId have only episodeId, which holds the
// show number — and j-archive's season listing no longer publishes show numbers, so
// there is nothing on the episode side to compare it against.
//
// Air date is the one field both sides have always carried, so it serves as the
// fallback. History stores "Friday, April 24, 2026" and the listing "April 24, 2026",
// hence the weekday strip.

export function normalizeAirDate(value) {
  return String(value || '')
    .replace(/^\s*[A-Za-z]+day,\s*/, '') // "Friday, April 24, 2026" → "April 24, 2026"
    .trim()
    .toLowerCase()
}

/**
 * Index game history for lookup by episode. Built oldest-first so a replayed episode
 * resolves to the most recent attempt.
 */
export function buildPlayedIndex(gameHistory = []) {
  const byId = new Map()
  const byDate = new Map()

  for (const game of [...gameHistory].reverse()) {
    if (game?.gameId) byId.set(String(game.gameId), game)
    const date = normalizeAirDate(game?.airDate)
    if (date) byDate.set(date, game)
  }

  return { byId, byDate }
}

/** The game record for this episode, or undefined if it has not been played. */
export function findPlayed(index, episode) {
  if (!index || !episode) return undefined
  return (
    index.byId.get(String(episode.gameId)) ||
    index.byDate.get(normalizeAirDate(episode.airDate))
  )
}

export function isPlayed(index, episode) {
  return !!findPlayed(index, episode)
}
