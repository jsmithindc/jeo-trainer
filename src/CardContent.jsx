import { useState, useEffect, useRef } from 'react'
import { getMediaUrl } from './mediaStore.js'

/**
 * Renders card content — either plain text or sanitized Anki HTML with media.
 * For cards with hasMedia=true, resolves img/audio references from IndexedDB.
 */
export function CardContent({ content, style, isHtml = false }) {
  const [resolvedHtml, setResolvedHtml] = useState(null)
  const containerRef = useRef(null)
  const urlsRef = useRef([]) // track created object URLs for cleanup

  useEffect(() => {
    if (!isHtml || !content) return

    let cancelled = false

    async function resolve() {
      let html = content

      // Find all data-anki-src references
      const srcMatches = [...html.matchAll(/data-anki-src="([^"]+)"/g)]

      for (const match of srcMatches) {
        if (cancelled) return
        const key = match[1] // e.g. "anki:image.jpg"
        try {
          const url = await getMediaUrl(key)
          if (url && !cancelled) {
            urlsRef.current.push(url)
            html = html.replace(
              `data-anki-src="${key}" src=""`,
              `src="${url}"`
            )
          }
        } catch {}
      }

      // Find audio-ref tags
      const audioMatches = [...html.matchAll(/<audio-ref src="([^"]+)"><\/audio-ref>/g)]
      for (const match of audioMatches) {
        if (cancelled) return
        const key = match[1]
        try {
          const url = await getMediaUrl(key)
          if (url && !cancelled) {
            urlsRef.current.push(url)
            html = html.replace(
              match[0],
              `<audio controls style="width:100%;margin-top:8px"><source src="${url}"></audio>`
            )
          }
        } catch {
          // Remove audio-ref if media not found
          html = html.replace(match[0], '')
        }
      }

      if (!cancelled) setResolvedHtml(html)
    }

    resolve()

    return () => {
      cancelled = true
      // Revoke object URLs to free memory
      urlsRef.current.forEach(url => URL.revokeObjectURL(url))
      urlsRef.current = []
    }
  }, [content, isHtml])

  if (!isHtml) {
    return <span style={style}>{content}</span>
  }

  const htmlToRender = resolvedHtml || content

  return (
    <div
      ref={containerRef}
      className="card-content"
      style={{ ...style, lineHeight: 1.5 }}
      dangerouslySetInnerHTML={{ __html: htmlToRender }}
    />
  )
}

/**
 * Determine if a card's content should be rendered as HTML.
 * True if the content contains HTML tags.
 */
export function cardIsHtml(content) {
  return /<[a-z][\s\S]*>/i.test(content)
}
