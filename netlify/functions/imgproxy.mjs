// Image proxy - uses Wikipedia API with fallback search
export const handler = async (event) => {
  const title = event.queryStringParameters?.title
  if (!title) return { statusCode: 400, body: 'Missing title' }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=604800',
  }

  const ua = 'JeoTrainer/1.0 (jsmithindc@gmail.com)'

  try {
    // Try exact title first
    let imgUrl = await getWikiImage(title, ua)

    // If not found, try search
    if (!imgUrl) {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title.replace(/_/g,' '))}&srlimit=1&format=json`
      const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': ua } })
      const searchData = await searchRes.json()
      const firstResult = searchData.query?.search?.[0]?.title
      if (firstResult) {
        imgUrl = await getWikiImage(firstResult.replace(/ /g, '_'), ua)
      }
    }

    if (!imgUrl) return { statusCode: 404, headers, body: 'No image found for: ' + title }

    const imgRes = await fetch(imgUrl, { headers: { 'User-Agent': ua } })
    if (!imgRes.ok) return { statusCode: imgRes.status, headers, body: 'Image fetch failed' }

    const buffer = await imgRes.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: { ...headers, 'Content-Type': imgRes.headers.get('content-type') || 'image/jpeg' },
      body: base64,
    }
  } catch (e) {
    return { statusCode: 500, headers, body: 'Error: ' + e.message }
  }
}

async function getWikiImage(title, ua) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&format=json&pithumbsize=400`
  const res = await fetch(url, { headers: { 'User-Agent': ua } })
  const data = await res.json()
  const page = Object.values(data.query?.pages || {})[0]
  return page?.thumbnail?.source || null
}
