import { useState, useEffect, useRef } from 'react'
import { getMediaUrl } from './mediaStore.js'
import { sanitizeCardHtml } from './sanitize.js'

/**
 * Renders card content — either plain text or Anki HTML with media.
 * All HTML is sanitised here, at the point of injection, so cards imported before
 * sanitising was fixed (and already synced to Supabase) are covered too.
 * For cards with hasMedia=true, resolves img/audio references from IndexedDB.
 */
export function CardContent({ content, style, isHtml = false }) {
  const [resolvedHtml, setResolvedHtml] = useState(null)
  // Initialize to content so HTML renders immediately even before media resolves
  const initialHtml = isHtml ? content : null
  const containerRef = useRef(null)
  const urlsRef = useRef([]) // track created object URLs for cleanup

  useEffect(() => {
    if (!isHtml || !content) return

    let cancelled = false

    async function resolve() {
      let html = content

      // Find all data-anki-src references (local IndexedDB fallback)
      const srcMatches = [...html.matchAll(/data-anki-src="([^"]+)"/g)]

      for (const match of srcMatches) {
        if (cancelled) return
        const key = match[1] // e.g. "anki:image.jpg"
        try {
          const url = await getMediaUrl(key)
          if (url && !cancelled) {
            urlsRef.current.push(url)
            // Replace the data-anki-src placeholder with the real object URL
            // Match the marker on its own: sanitising may reorder or drop a
            // neighbouring empty src, so pairing them would break silently.
            html = html.replace(
              new RegExp(`data-anki-src="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'),
              `src="${url}"`
            )
          }
        } catch (e) {
          console.warn('[CardContent] Failed to resolve media key:', key, e)
        }
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

      if (!cancelled) setResolvedHtml(sanitizeCardHtml(html))
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

  // Sanitise the pre-resolution fallback too — it renders on the first paint,
  // before the media effect has run.
  const htmlToRender = resolvedHtml || sanitizeCardHtml(initialHtml || content)

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
  if (!content) return false
  return /<[a-z][\s\S]*>/i.test(content) ||
         content.includes('data-anki-src') ||
         content.includes('audio-ref')
}
