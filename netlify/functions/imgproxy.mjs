export const handler = async (event) => {
  const target = event.queryStringParameters?.url
  if (!target || !target.startsWith('https://upload.wikimedia.org/')) {
    return { statusCode: 400, body: 'Invalid URL' }
  }
  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': 'JeoTrainer/1.0 (https://jeotrainer.netlify.app)' }
    })
    const buffer = await res.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
      body: base64,
    }
  } catch (e) {
    return { statusCode: 500, body: 'Fetch failed: ' + e.message }
  }
}
