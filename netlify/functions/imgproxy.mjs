// Image proxy using Wikipedia's thumbnail API - reliable, open, no auth needed
export const handler = async (event) => {
  const title = event.queryStringParameters?.title
  if (!title) {
    return { statusCode: 400, body: 'Missing title parameter' }
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=604800',
  }

  try {
    // Wikipedia page image API - returns thumbnail for any article
    const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&format=json&pithumbsize=400`
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'JeoTrainer/1.0 (jsmithindc@gmail.com)' }
    })
    const data = await res.json()
    const pages = data.query?.pages || {}
    const page = Object.values(pages)[0]
    const imgUrl = page?.thumbnail?.source

    if (!imgUrl) {
      return { statusCode: 404, headers, body: 'No image for: ' + title }
    }

    // Fetch the actual image
    const imgRes = await fetch(imgUrl, {
      headers: { 'User-Agent': 'JeoTrainer/1.0 (jsmithindc@gmail.com)' }
    })
    if (!imgRes.ok) {
      return { statusCode: imgRes.status, headers, body: 'Image fetch failed: ' + imgRes.status }
    }

    const buffer = await imgRes.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        ...headers,
        'Content-Type': imgRes.headers.get('content-type') || 'image/jpeg',
      },
      body: base64,
    }
  } catch (e) {
    return { statusCode: 500, headers, body: 'Error: ' + e.message }
  }
}
