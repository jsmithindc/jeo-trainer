// Answer matching, shared by the drills and by typed-answer flashcard sessions.
// Extracted from drills.jsx so both use one implementation rather than drifting apart.

export function normalize(s) {
  return (s || '').toLowerCase()
    .replace(/[.\-''']/g, '')   // remove periods, hyphens, apostrophes
    .replace(/\s+/g, ' ')
    .trim()
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

export function fuzzyMatch(input, target) {
  const a = normalize(input)
  const b = normalize(target)
  if (a === b) return true
  // Accept if input exactly matches any significant word in target (e.g. last name only)
  const bWords = b.split(' ').filter(w => w.length >= 4)
  if (bWords.some(w => w === a)) return true
  // Require input to be at least 40% the length of target to avoid trivial matches
  if (a.length < 3 || a.length < b.length * 0.4) return false
  const maxDist = b.length > 8 ? 2 : b.length > 4 ? 1 : 0
  return levenshtein(a, b) <= maxDist
}

// Flashcard backs are not the clean single answers the drills deal in: Anki cards carry
// HTML, and board cards often read "Who is Cleopatra?". Reduce both to the bare answer
// before matching, and accept the response with or without the Jeopardy phrasing.
const RESPONSE_PREFIX = /^\s*(what|who|where|when|why|how)\s+(is|are|was|were)\s+/i

export function answerCandidates(back) {
  const plain = String(back || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')       // strip Anki markup
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

  const stripped = plain.replace(RESPONSE_PREFIX, '').replace(/\?+\s*$/, '').trim()

  // Alternatives are commonly written "Twain (Clemens)" or "Holland / the Netherlands".
  const alternatives = stripped
    .split(/\s*[/|]\s*|\s*\(([^)]*)\)\s*/)
    .map(s => (s || '').trim())
    .filter(Boolean)

  return [...new Set([plain, stripped, ...alternatives])].filter(Boolean)
}

/** True if the typed response matches the card's answer in any reasonable form. */
export function matchesAnswer(input, back) {
  const typed = String(input || '').replace(RESPONSE_PREFIX, '').replace(/\?+\s*$/, '').trim()
  if (!normalize(typed)) return false
  return answerCandidates(back).some(candidate => fuzzyMatch(typed, candidate))
}
