const RECENT_THRESHOLD = 9400

export async function fetchEpisode(episodeId = 'latest') {
  const res = await fetch(`/.netlify/functions/jarchive?episode=${episodeId}`)
  const data = await res.json()

  // For recent episodes, don't throw on 422 (parse failure) — try own proxy instead
  const numericId = parseInt(data.episodeId || episodeId)
  const isRecent = !isNaN(numericId) && numericId >= RECENT_THRESHOLD
  if (!res.ok && !(res.status === 422 && isRecent)) throw new Error(data.error || 'Failed to fetch episode')

  const missingDJ = !data.doubleJeopardy
  const incompleteSJ = !data.singleJeopardy || data.singleJeopardy.categories.length < 6
  const needsClientFetch = isRecent && (missingDJ || incompleteSJ || !res.ok)

  if (needsClientFetch) {
    const targetId = data.episodeId || episodeId
    console.log(`Episode ${targetId} needs proxy fetch (missingDJ:${missingDJ}, incompleteSJ:${incompleteSJ})`)
    try {
      // Use our own Netlify proxy function — no CORS issues, no third-party limits
      const proxyRes = await fetch(
        `/.netlify/functions/proxy?game_id=${targetId}`,
        { signal: AbortSignal.timeout(15000) }
      )
      if (proxyRes.ok) {
        const html = await proxyRes.text()
        if (html && html.length > 10000) {
          const parseRes = await fetch(`/.netlify/functions/jarchive?episode=${targetId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html, episodeId: targetId })
          })
          const fullData = await parseRes.json()
          if (fullData.singleJeopardy || fullData.doubleJeopardy) {
            console.log(`Proxy fetch succeeded for episode ${targetId}`)
            return fullData
          } else {
            console.warn('Proxy parse returned no data:', fullData.error)
          }
        } else {
          console.warn('Proxy response too short:', html?.length)
        }
      } else {
        console.warn('Proxy non-ok:', proxyRes.status)
      }
    } catch (err) {
      console.warn('Proxy fetch failed:', err.message)
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
      episodeId: episode.episodeId,
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
