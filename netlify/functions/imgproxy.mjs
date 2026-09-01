// Without an allowlist the `url` parameter turns this into an open proxy: anyone can
// have our Netlify function fetch any URL and read the response back, on our bandwidth
// and from inside Netlify's network. Only the hosts the app actually needs are allowed.
const ALLOWED_HOSTS = new Set([
  'upload.wikimedia.org',
  'commons.wikimedia.org',
  'en.wikipedia.org',
])

function isAllowed(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    return ALLOWED_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

export const handler = async (event) => {
  const title = event.queryStringParameters?.title
  const directUrl = event.queryStringParameters?.url
  if (!title && !directUrl) return { statusCode: 400, body: 'Missing title or url' }

  const headers = {
    'Access-Control-Allow-Origin': 'https://jeotrainer.netlify.app',
    'Cache-Control': 'public, max-age=604800',
  }

  if (directUrl && !isAllowed(directUrl)) {
    return { statusCode: 400, headers, body: 'URL host not allowed' }
  }
  const ua = 'JeoTrainer/1.0 (jsmithindc@gmail.com)'

  try {
    let imgUrl = directUrl || null

    if (!imgUrl && title) {
      imgUrl = await getWikiImage(title, ua)
      if (!imgUrl) {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title.replace(/_/g,' '))}&srlimit=1&format=json`
        const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': ua } })
        const searchData = await searchRes.json()
        const firstResult = searchData.query?.search?.[0]?.title
        if (firstResult) imgUrl = await getWikiImage(firstResult.replace(/ /g, '_'), ua)
      }
    }

    if (!imgUrl) return { statusCode: 404, headers, body: 'No image found' }

    // The title path derives its URL from the Wikipedia API response, which is still
    // external input — check the final URL too, not just the caller-supplied one.
    if (!isAllowed(imgUrl)) return { statusCode: 400, headers, body: 'Resolved host not allowed' }

    const imgRes = await fetch(imgUrl, { headers: { 'User-Agent': ua } })
    if (!imgRes.ok) return { statusCode: imgRes.status, headers, body: 'Fetch failed: ' + imgRes.status }

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
