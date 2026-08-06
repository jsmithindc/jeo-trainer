export default async function handler(req) {
  const url = new URL(req.url)
  const target = url.searchParams.get('url')
  if (!target || !target.startsWith('https://upload.wikimedia.org/')) {
    return new Response('Invalid URL', { status: 400 })
  }
  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': 'JeoTrainer/1.0 (https://jeotrainer.netlify.app)' }
    })
    const body = await res.arrayBuffer()
    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      }
    })
  } catch (e) {
    return new Response('Fetch failed', { status: 500 })
  }
}

export const config = { path: '/imgproxy' }
