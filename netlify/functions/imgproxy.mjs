export const handler = async (event) => {
  const target = event.queryStringParameters?.url
  if (!target || !target.startsWith('https://upload.wikimedia.org/')) {
    return { statusCode: 400, body: 'Invalid URL: ' + target }
  }

  const sizeMatch = target.match(/\/(\d+px-)([^/]+)$/)
  if (!sizeMatch) {
    return { statusCode: 400, body: 'Could not parse URL: ' + target }
  }

  const filename = sizeMatch[2]
  const base = target.replace(/\/\d+px-[^/]+$/, '')
  const sizes = ['330', '300', '400', '250', '500', '220', '150']
  const tried = []

  for (const size of sizes) {
    const tryUrl = `${base}/${size}px-${filename}`
    tried.push(tryUrl)
    try {
      const res = await fetch(tryUrl, {
        headers: { 'User-Agent': 'JeoTrainer/1.0 (https://jeotrainer.netlify.app; jsmithindc@gmail.com)' }
      })
      if (res.ok) {
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
      } else {
        tried[tried.length - 1] += ` [${res.status}]`
      }
    } catch (e) {
      tried[tried.length - 1] += ` [err: ${e.message}]`
    }
  }

  return {
    statusCode: 404,
    headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' },
    body: 'All sizes failed:\n' + tried.join('\n')
  }
}
