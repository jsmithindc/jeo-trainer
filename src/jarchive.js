const RECENT_THRESHOLD = 9400

export async function fetchEpisode(episodeId = 'latest') {
  const res = await fetch(`/.netlify/functions/jarchive?episode=${episodeId}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to fetch episode')

  const numericId = parseInt(data.episodeId || episodeId)
  const isRecent = !isNaN(numericId) && numericId >= RECENT_THRESHOLD
  const needsClientFetch = !data.doubleJeopardy && isRecent

  if (needsClientFetch) {
    const targetId = data.episodeId || episodeId
    console.log(`DJ missing for episode ${targetId}, trying codetabs proxy...`)
    try {
      const proxyRes = await fetch(
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(`https://j-archive.com/showgame.php?game_id=${targetId}`)}`,
        { signal: AbortSignal.timeout(10000) }
      )
      if (proxyRes.ok) {
        const html = await proxyRes.text()
        if (html && html.includes('double_jeopardy_round')) {
          const parseRes = await fetch(`/.netlify/functions/jarchive?episode=${targetId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html, episodeId: targetId })
          })
          const fullData = await parseRes.json()
          if (fullData.doubleJeopardy) {
            console.log(`codetabs proxy succeeded for episode ${targetId}`)
            return fullData
          } else {
            console.warn('Parse returned no DJ:', fullData.error)
          }
        } else {
          console.warn('codetabs response missing DJ, length:', html?.length)
        }
      } else {
        console.warn('codetabs non-ok:', proxyRes.status)
      }
    } catch (err) {
      console.warn('codetabs proxy failed:', err.message)
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
