import { parse } from 'node-html-parser'

export const handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }

  try {
    const search = event.queryStringParameters?.search || ''
    const season = event.queryStringParameters?.season || ''

    const fetchOpts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://j-archive.com/',
      }
    }

    // Fetch season list
    const seasonsRes = await fetch('https://j-archive.com/listseasons.php', fetchOpts)
    if (!seasonsRes.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: `j-archive returned HTTP ${seasonsRes.status} for seasons list` }) }
    }

    const seasonsHtml = await seasonsRes.text()
    if (seasonsHtml.length < 100) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: `j-archive returned unexpectedly short response: "${seasonsHtml.slice(0, 100)}"` }) }
    }

    const seasonsDoc = parse(seasonsHtml)
    const seasonLinks = seasonsDoc.querySelectorAll('a[href*="listseasonepisodes"]')
    const seasons = seasonLinks.map(el => ({
      id: (el.getAttribute('href').match(/season=(\d+)/) || [])[1],
      label: el.text.trim()
    })).filter(s => s.id)

    if (!seasons.length) {
      // Return raw HTML snippet to debug
      return { statusCode: 502, headers, body: JSON.stringify({ 
        error: 'Could not find season links in j-archive response',
        htmlSnippet: seasonsHtml.slice(0, 500)
      })}
    }

    // Determine which season to fetch
    const targetSeason = season || seasons[0].id

    const epRes = await fetch(`https://j-archive.com/listseasonepisodes.php?season=${targetSeason}`, fetchOpts)
    if (!epRes.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: `j-archive returned HTTP ${epRes.status} for episodes list` }) }
    }

    const epHtml = await epRes.text()
    const epDoc = parse(epHtml)

    const episodes = []
    for (const link of epDoc.querySelectorAll('a[href*="showgame"]')) {
      const href = link.getAttribute('href') || ''
      const gameIdMatch = href.match(/game_id=(\d+)/)
      if (!gameIdMatch) continue
      const gameId = gameIdMatch[1]
      const text = link.text.trim()
      const showMatch = text.match(/#(\d+)/)
      const showNumber = showMatch ? showMatch[1] : ''
      const dateMatch = text.match(/,\s*(.+)$/)
      const airDate = dateMatch ? dateMatch[1].trim() : text

      episodes.push({ gameId, showNumber, airDate, season: targetSeason })
    }

    // Filter by search
    let filtered = episodes
    if (search) {
      const q = search.toLowerCase().replace(/\s+/g, '')
      filtered = episodes.filter(ep =>
        ep.showNumber.includes(search) ||
        ep.airDate.toLowerCase().replace(/\s+/g, '').includes(q)
      )
    }

    filtered.sort((a, b) => parseInt(b.gameId) - parseInt(a.gameId))

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ episodes: filtered.slice(0, 50), seasons })
    }

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message, stack: err.stack?.slice(0, 300) }) }
  }
}
