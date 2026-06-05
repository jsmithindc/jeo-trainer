// Simple proxy for j-archive pages
// Allows browser to get full HTML including DJ round
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

export default async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers }
  }

  const gameId = event.queryStringParameters?.game_id
  if (!gameId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'game_id required' }) }
  }

  try {
    const res = await fetch(`https://j-archive.com/showgame.php?game_id=${gameId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://j-archive.com/',
      }
    })

    if (!res.ok) {
      return { statusCode: res.status, headers, body: JSON.stringify({ error: `j-archive returned ${res.status}` }) }
    }

    const html = await res.text()
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'text/plain' },
      body: html
    }
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
