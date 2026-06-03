export async function fetchEpisode(episodeId = 'latest') {
  // Step 1: Try server-side fetch first (fast, works for most episodes)
  const res = await fetch(`/.netlify/functions/jarchive?episode=${episodeId}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to fetch episode')

  // Step 2: If DJ is missing, try client-side fetch via CORS proxy
  // (recent episodes get truncated when fetched from server IP)
  if (!data.doubleJeopardy && episodeId !== 'latest') {
    console.log('DJ missing from server fetch, trying client-side fetch...')
    try {
      const jarchiveUrl = `https://j-archive.com/showgame.php?game_id=${episodeId}`
      const proxyRes = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(jarchiveUrl)}`)
      const proxyData = await proxyRes.json()
      const html = proxyData.contents

      if (html && html.includes('double_jeopardy_round')) {
        const parseRes = await fetch(`/.netlify/functions/jarchive?episode=${episodeId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html, episodeId })
        })
        const fullData = await parseRes.json()
        if (fullData.doubleJeopardy) return fullData
      }
    } catch (err) {
      console.warn('Client-side fetch failed:', err.message)
    }
  }

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
