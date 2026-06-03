export async function fetchEpisode(episodeId = 'latest') {
  const res = await fetch(`/.netlify/functions/jarchive?episode=${episodeId}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to fetch episode')
  return data
}

export function episodeToBoard(episode, round = 'single') {
  const roundData = round === 'double' ? episode.doubleJeopardy : episode.singleJeopardy
  if (!roundData) throw new Error('Round data unavailable')
  return {
    board: {
      round: round === 'double' ? 'Double Jeopardy' : 'Single Jeopardy',
      airDate: episode.airDate,
      episodeNumber: episode.episodeNumber,
      episodeId: episode.episodeId,
      url: episode.url,
      categories: roundData.categories,
    },
    meta: {
      episodeNumber: episode.episodeNumber,
      airDate: episode.airDate,
      url: episode.url,
      hasDouble: !!episode.doubleJeopardy,
      finalJeopardy: episode.finalJeopardy,
      contestants: episode.contestants || null,
    }
  }
}

export async function searchEpisodesByCategory(categoryName) {
  const res = await fetch(`/.netlify/functions/episodes?category=${encodeURIComponent(categoryName)}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Search failed')
  return data.episodes || []
}
