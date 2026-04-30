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
    const seasonsHtml = await seasonsRes.text()

    // Extract season links via regex — more reliable than DOM parsing
    // Format: href="listseasonepisodes.php?season=41"
    const seasonMatches = [...seasonsHtml.matchAll(/href="listseasonepisodes\.php\?season=(\d+)"[^>]*>([^<]+)</g)]
    
    // Also try the full URL format
    const seasonMatchesFull = [...seasonsHtml.matchAll(/href="[^"]*listseasonepisodes[^"]*season=(\d+)"[^>]*>([^<]+)</g)]
    
    const allMatches = seasonMatches.length > 0 ? seasonMatches : seasonMatchesFull

    // Debug: if still no matches, return what links we DO find
    if (allMatches.length === 0) {
      const allLinks = [...seasonsHtml.matchAll(/href="([^"]{0,80})"/g)].slice(0, 20).map(m => m[1])
      return { statusCode: 502, headers, body: JSON.stringify({
        error: 'Could not find season links',
        allLinksFound: allLinks,
        htmlLength: seasonsHtml.length,
      })}
    }

    const seasons = allMatches.map(m => ({ id: m[1], label: m[2].trim() }))

    // Determine which season to fetch
    const targetSeason = season || seasons[0].id

    const epRes = await fetch(`https://j-archive.com/listseasonepisodes.php?season=${targetSeason}`, fetchOpts)
    const epHtml = await epRes.text()

    // Extract episodes via regex
    // Format: href="showgame.php?game_id=9200">#9157, Monday, April 14, 2025
    const epMatches = [...epHtml.matchAll(/href="showgame\.php\?game_id=(\d+)"[^>]*>([^<]+)</g)]

    const episodes = epMatches.map(m => {
      const gameId = m[1]
      const text = m[2].trim()
      const showMatch = text.match(/#(\d+)/)
      const showNumber = showMatch ? showMatch[1] : ''
      const dateMatch = text.match(/,\s*(.+)$/)
      const airDate = dateMatch ? dateMatch[1].trim() : text
      return { gameId, showNumber, airDate, season: targetSeason }
    }).filter(ep => ep.showNumber)

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
