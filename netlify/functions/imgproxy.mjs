export const handler = async (event) => {
  const target = event.queryStringParameters?.url
  if (!target || !target.startsWith('https://upload.wikimedia.org/')) {
    return { statusCode: 400, body: 'Invalid URL' }
  }

  // Split on the last slash before the size prefix to get base and filename
  // Keep everything URL-encoded as-is
  const lastSlash = target.lastIndexOf('/')
  const sizeAndFile = target.slice(lastSlash + 1) // e.g. "330px-Filename.jpg"
  const base = target.slice(0, lastSlash) // everything before last slash
  
  const sizeMatch = sizeAndFile.match(/^(\d+)px-(.+)$/)
  if (!sizeMatch) {
    return { statusCode: 400, body: 'Could not parse: ' + sizeAndFile }
  }
  
  const filename = sizeMatch[2] // already URL-encoded
  const sizes = ['330', '300', '400', '250', '500', '220', '150']

  for (const size of sizes) {
    const tryUrl = `${base}/${size}px-${filename}`
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
      }
    } catch (e) { /* try next */ }
  }

  return {
    statusCode: 404,
    headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' },
    body: 'Image not available'
  }
}
