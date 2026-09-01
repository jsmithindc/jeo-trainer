import DOMPurify from 'dompurify'

// Anki decks are downloaded from the internet — that is the entire point of the
// import feature — and their card content is injected with dangerouslySetInnerHTML.
// This runs in the app's own origin, where the Supabase session token lives, so a
// hostile deck could read it.
//
// The previous defence was a set of regexes that stripped <script>, <style>,
// javascript:, and event handlers written with double quotes. Single-quoted and
// unquoted handlers passed straight through, as did <iframe>, <object> and <embed>.
// Hand-rolled HTML sanitisers are an unwinnable category; this defers to a real one.

// Tags an Anki card legitimately uses for formatting, media and tables.
const ALLOWED_TAGS = [
  'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'br', 'hr', 'p', 'div', 'span',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  'img', 'audio', 'source', 'figure', 'figcaption', 'font', 'small', 'mark',
  'audio-ref', // inert placeholder; CardContent swaps it for a real <audio> at render
]

const ALLOWED_ATTR = [
  'src', 'alt', 'title', 'width', 'height', 'style', 'class',
  'controls', 'type', 'colspan', 'rowspan', 'align', 'color', 'face',
  'data-anki-src', // internal marker used to resolve media from IndexedDB
]

// Media resolves to Supabase https URLs or to blob: URLs created from IndexedDB.
// Everything else — javascript:, data:text/html, external trackers — is dropped.
const ALLOWED_URI_REGEXP = /^(?:https?:|blob:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i

export function sanitizeCardHtml(html) {
  if (!html) return ''
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta', 'base'],
    // DOMPurify treats data-* as a category, so a blanket ban would strip
    // data-anki-src regardless of ALLOWED_ATTR and silently break local media.
    // Data attributes are inert — they carry no behaviour of their own.
    ALLOW_DATA_ATTR: true,
    KEEP_CONTENT: true, // drop the tag, keep the readable text inside it
  })
}
