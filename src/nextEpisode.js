import { normalizeAirDate } from './played.js'

// Season N runs September to July: season 1 premiered September 1984, season 42 is 2025–26.
export function seasonForAirDate(airDate) {
  const s = normalizeAirDate(airDate)
  let y, m
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) {
    y = Number(iso[1]); m = Number(iso[2])
  } else {
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return null
    y = d.getFullYear(); m = d.getMonth() + 1
  }
  return m >= 9 ? y - 1983 : y - 1984
}

function locate(episodes, game) {
  let i = game.gameId ? episodes.findIndex(e => String(e.gameId) === String(game.gameId)) : -1
  if (i === -1 && game.airDate) {
    const air = normalizeAirDate(game.airDate)
    i = episodes.findIndex(e => normalizeAirDate(e.airDate) === air)
  }
  return i
}

/**
 * The show that aired after `lastGame`, as { episodes, index } — the season list it sits in
 * (newest-first, as the episodes function returns them) and its position there. Null when
 * the last game was the newest show there is, or can't be placed.
 *
 * The startup board used to look for the last game only in the current season, so anyone
 * working through an older season got the latest episode every time.
 */
export async function findNextEpisode(lastGame, currentEpisodes, fetchSeason) {
  if (!lastGame) return null
  const currentSeason = currentEpisodes[0]?.season != null ? String(currentEpisodes[0].season) : null
  const seasonList = s => (String(s) === currentSeason ? Promise.resolve(currentEpisodes) : fetchSeason(s).catch(() => []))

  let episodes = currentEpisodes
  let i = locate(episodes, lastGame)
  if (i === -1) {
    const guess = lastGame.airDate ? seasonForAirDate(lastGame.airDate) : null
    if (!guess) return null
    // The air-date rule is right for regular episodes; the neighbours cover the odd
    // tournament or special that j-archive files differently.
    for (const s of [guess, guess + 1, guess - 1]) {
      if (String(s) === currentSeason) continue
      const list = await seasonList(s)
      const j = locate(list, lastGame)
      if (j !== -1) { episodes = list; i = j; break }
    }
    if (i === -1) return null
  }

  if (i > 0) return { episodes, index: i - 1 }

  // The newest show of its season: carry on into the following season's first show.
  const season = Number(episodes[0]?.season)
  if (!season || String(season) === currentSeason) return null // the newest show of all
  const following = await seasonList(season + 1)
  if (!following.length) return null
  return { episodes: following, index: following.length - 1 }
}
