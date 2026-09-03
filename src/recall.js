// Recall timing for study sessions.
//
// A card answered correctly but slowly is not really known — on a buzzer you would
// have lost it. FSRS only sees the grade, so without this a slow recall and an instant
// one schedule identically, which is the largest source of scheduling error for
// Jeopardy practice specifically.
//
// The clock starts after a grace period for reading the clue, so the measurement is
// retrieval time rather than reading speed.

export const READ_GRACE_MS = 1000

// Thresholds apply to retrieval time, i.e. after the grace period.
export const EASY_UNDER_MS = 2000
export const GOOD_UNDER_MS = 4000

/** Retrieval time in ms: reveal, less when the card appeared, less the reading grace. */
export function recallMs(shownAt, revealedAt = Date.now()) {
  if (!shownAt) return null
  return Math.max(0, revealedAt - shownAt - READ_GRACE_MS)
}

/**
 * The grade this attempt suggests. 0=Again 1=Hard 2=Good 3=Easy.
 * Returns null when there is nothing to go on, so the UI suggests nothing rather
 * than guessing.
 */
export function suggestGrade({ correct, ms }) {
  if (correct === false) return 0            // a miss is a miss, however fast
  if (correct !== true && ms == null) return null
  if (ms == null) return null

  if (ms < EASY_UNDER_MS) return 3           // instant
  if (ms < GOOD_UNDER_MS) return 2           // comfortable
  return 1                                   // dragged it up — Hard
}

/** Short label for a duration, e.g. "1.4s". */
export function formatRecall(ms) {
  if (ms == null) return null
  if (ms < 100) return 'instant'
  return `${(ms / 1000).toFixed(1)}s`
}

/** Distribution of retrieval times, for showing the real spread later. */
export function summariseRecall(log = []) {
  const timed = log.filter(e => typeof e.ms === 'number' && e.q > 0)
  if (!timed.length) return { n: 0, median: null, fast: 0, ok: 0, slow: 0 }

  const sorted = timed.map(e => e.ms).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)

  return {
    n: timed.length,
    median,
    fast: timed.filter(e => e.ms < EASY_UNDER_MS).length,
    ok: timed.filter(e => e.ms >= EASY_UNDER_MS && e.ms < GOOD_UNDER_MS).length,
    slow: timed.filter(e => e.ms >= GOOD_UNDER_MS).length,
  }
}
