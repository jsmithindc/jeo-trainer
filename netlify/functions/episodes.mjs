import { parse } from 'node-html-parser'

// Returns a list of recent episodes with show number, air date, and game_id
// Also supports searching by show number or date string
export const handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }

  try {
    const search = event.queryStringParameters?.search || ''
    const season = event.queryStringParameters?.season || ''

    // Fetch the season list to find relevant seasons
    const seasonsRes = await fetch('https://j-archive.com/listseasons.php', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    })
    const seasonsHtml = await seasonsRes.text()
    const seasonsDoc = parse(seasonsHtml)

    // Get all season links — format: listseasonepisodes.php?season=XX
    const seasonLinks = seasonsDoc.querySelectorAll('a[href*="listseasonepisodes"]')
    const seasons = seasonLinks.map(el => ({
      id: (el.getAttribute('href').match(/season=(\d+)/) || [])[1],
      label: el.text.trim()
    })).filter(s => s.id)

    if (!seasons.length) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not fetch season list' }) }
    }

    // If just requesting the season list, return it
    if (event.queryStringParameters?.list === 'seasons') {
      return { statusCode: 200, headers, body: JSON.stringify({ seasons }) }
    }

    // Determine which season(s) to fetch episodes from
    // Default: most recent season. If search provided, may need multiple.
    const targetSeasons = season ? [season] : [seasons[0].id]

    let episodes = []
    for (const sid of targetSeasons) {
      const epRes = await fetch(`https://j-archive.com/listseasonepisodes.php?season=${sid}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
      })
      const epHtml = await epRes.text()
      const epDoc = parse(epHtml)

      // Each episode row: <a href="showgame.php?game_id=XXXX">#YYYY, Day Date Year</a>
      const links = epDoc.querySelectorAll('a[href*="showgame"]')
      for (const link of links) {
        const href = link.getAttribute('href') || ''
        const gameIdMatch = href.match(/game_id=(\d+)/)
        if (!gameIdMatch) continue
        const gameId = gameIdMatch[1]
        const text = link.text.trim()
        // Format: "#9200, Monday, April 14, 2025" or "Show #9200 ..."
        const showMatch = text.match(/#(\d+)/)
        const showNumber = showMatch ? showMatch[1] : ''
        // Everything after the comma is the date
        const dateMatch = text.match(/,\s*(.+)$/)
        const airDate = dateMatch ? dateMatch[1].trim() : ''

        episodes.push({ gameId, showNumber, airDate, season: sid })
      }
    }

    // Filter by search term (show number or date fragment)
    if (search) {
      const q = search.toLowerCase().replace(/\s+/g, '')
      episodes = episodes.filter(ep =>
        ep.showNumber.includes(search) ||
        ep.airDate.toLowerCase().replace(/\s+/g, '').includes(q)
      )
    }

    // Sort newest first (highest game_id first)
    episodes.sort((a, b) => parseInt(b.gameId) - parseInt(a.gameId))

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ episodes: episodes.slice(0, 50), seasons })
    }
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
