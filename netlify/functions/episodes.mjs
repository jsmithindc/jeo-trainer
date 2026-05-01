import { parse } from 'node-html-parser'

export const handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }

  try {
    const search = event.queryStringParameters?.search || ''
    const season = event.queryStringParameters?.season || ''
    const categorySearch = event.queryStringParameters?.category || ''

    // Category search — j-archive has a search page
    if (categorySearch) {
      const searchRes = await fetch(
        `https://j-archive.com/search.php?search=${encodeURIComponent(categorySearch)}&submit=Search`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }
      )
      const searchHtml = await searchRes.text()
      const gameMatches = [...searchHtml.matchAll(/game_id=(\d+)[^>]*>[^<]*#(\d+)[^,]*,\s*([^<"]+)/g)]
      const episodes = gameMatches.map(m => ({
        gameId: m[1],
        showNumber: m[2],
        airDate: m[3].trim(),
        season: '',
      })).filter(e => e.showNumber)
      // Also try alternate pattern
      const altMatches = [...searchHtml.matchAll(/showgame\.php\?game_id=(\d+)"[^>]*>([^<]+)<\/a>/g)]
      const altEps = altMatches.map(m => {
        const text = m[2].trim()
        const showMatch = text.match(/#(\d+)/)
        const dateMatch = text.match(/,\s*(.+)$/)
        return { gameId: m[1], showNumber: showMatch?.[1] || '', airDate: dateMatch?.[1]?.trim() || text, season: '' }
      }).filter(e => e.showNumber)
      const combined = episodes.length > 0 ? episodes : altEps
      return { statusCode: 200, headers, body: JSON.stringify({ episodes: combined.slice(0, 50), seasons: [] }) }
    }

    const fetchOpts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://j-archive.com/',
      }
    }

    // Fetch season list — links are showseason.php?season=42
    const seasonsRes = await fetch('https://j-archive.com/listseasons.php', fetchOpts)
    const seasonsHtml = await seasonsRes.text()

    // Extract numeric seasons only (skip special ones like "cwcpi", "goattournament")
    const seasonMatches = [...seasonsHtml.matchAll(/href="showseason\.php\?season=(\d+)"[^>]*>([^<]+)</g)]
    const seasons = seasonMatches.map(m => ({ id: m[1], label: m[2].trim() }))

    if (seasons.length === 0) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'No seasons found', htmlLength: seasonsHtml.length }) }
    }

    // Fetch episodes for target season — showseason.php?season=42
    const targetSeason = season || seasons[0].id
    const epRes = await fetch(`https://j-archive.com/showseason.php?season=${targetSeason}`, fetchOpts)
    const epHtml = await epRes.text()

    // Episodes are linked as showgame.php?game_id=XXXX
    const epMatches = [...epHtml.matchAll(/href="showgame\.php\?game_id=(\d+)"[^>]*>([^<]+)</g)]

    const episodes = epMatches.map(m => {
      const gameId = m[1]
      const text = m[2].trim()
      // Format: "#9200, Monday, April 14, 2025"
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
