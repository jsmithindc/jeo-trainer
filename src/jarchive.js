export async function fetchEpisode(episodeId = 'latest') {
  // For 'latest', use the server function which handles season lookup
  if (episodeId === 'latest') {
    const res = await fetch('/.netlify/functions/jarchive?episode=latest')
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to fetch episode')
    return data
  }

  // For specific episodes: fetch j-archive directly from the browser via CORS proxy
  // This bypasses the server IP truncation issue
  const jarchiveUrl = `https://j-archive.com/showgame.php?game_id=${episodeId}`
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(jarchiveUrl)}`

  try {
    const proxyRes = await fetch(proxyUrl)
    const proxyData = await proxyRes.json()
    const html = proxyData.contents

    if (!html || html.length < 50000) {
      throw new Error('Incomplete page from proxy, falling back to server')
    }

    // Send HTML to server function for parsing
    const parseRes = await fetch('/.netlify/functions/jarchive?episode=' + episodeId + '&mode=parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, episodeId })
    })
    const data = await parseRes.json()
    if (!parseRes.ok) throw new Error(data.error || 'Parse failed')
    return data
  } catch (err) {
    // Fall back to server-side fetch
    console.warn('Client-side fetch failed, falling back to server:', err.message)
    const res = await fetch(`/.netlify/functions/jarchive?episode=${episodeId}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to fetch episode')
    return data
  }
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
