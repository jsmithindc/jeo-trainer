// Recent episodes (high game IDs) get truncated when fetched server-side.
// For these we fetch via allorigins CORS proxy from the browser and POST the
// full HTML to the server for parsing.
const RECENT_THRESHOLD = 9400 // episodes above this ID may need client-side fetch

export async function fetchEpisode(episodeId = 'latest') {
  // Step 1: Always try server-side fetch first (fast, works for most episodes)
  const res = await fetch(`/.netlify/functions/jarchive?episode=${episodeId}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to fetch episode')

  // Step 2: If DJ is missing and episode is recent, try client-side fetch
  const numericId = parseInt(episodeId)
  const isRecent = isNaN(numericId) ? false : numericId >= RECENT_THRESHOLD
  const needsClientFetch = !data.doubleJeopardy && (isRecent || episodeId === 'latest')

  if (needsClientFetch) {
    console.log(`DJ missing for episode ${episodeId}, trying client-side fetch...`)
    try {
      const targetId = data.episodeId || episodeId
      const jarchiveUrl = `https://j-archive.com/showgame.php?game_id=${targetId}`
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(jarchiveUrl)}`

      const proxyRes = await fetch(proxyUrl)
      const proxyData = await proxyRes.json()
      const html = proxyData.contents

      if (html && html.includes('double_jeopardy_round')) {
        const parseRes = await fetch(`/.netlify/functions/jarchive?episode=${targetId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html, episodeId: targetId })
        })
        const fullData = await parseRes.json()
        if (fullData.doubleJeopardy) {
          console.log(`Client-side fetch succeeded for episode ${targetId}`)
          return fullData
        }
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
