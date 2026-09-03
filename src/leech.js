// Leech quarantine.
//
// A leech is a card you keep failing. They are corrosive because failing collapses the
// interval, so the card reappears almost immediately, you fail it again, and it crowds
// out cards you could actually be learning. A handful can eat a large share of every
// session.
//
// Two tiers, deliberately far apart:
//   4+ lapses  — flagged 🐛, still reviewed. You are finding it hard; that is normal.
//   8+ lapses  — quarantined. Eight failures is not a difficulty problem, it is
//                usually a bad card: ambiguous, two facts in one, or the answer is
//                sitting in the question.
//
// Quarantine suspends rather than deletes, because the fix is almost always to rewrite
// the card, and the wording you failed on is the evidence for how to rewrite it.

export const LEECH_LAPSES = 4
export const QUARANTINE_LAPSES = 8

export function isLeech(card) {
  return (card?.lapses || 0) >= LEECH_LAPSES
}

export function isSuspended(card) {
  return card?.suspended === true
}

/** True when this card has just earned quarantine and is not already suspended. */
export function shouldQuarantine(card) {
  return !isSuspended(card) && (card?.lapses || 0) >= QUARANTINE_LAPSES
}

export function suspendCard(card) {
  return { ...card, suspended: true, suspendedAt: Date.now(), suspendedReason: 'leech' }
}

/** Put a card back into rotation, keeping its history. */
export function releaseCard(card) {
  const { suspended, suspendedAt, suspendedReason, ...rest } = card
  return rest
}

/**
 * Release after a rewrite. The lapse count is cleared deliberately: a rewritten card is
 * effectively a new one, and carrying eight failures forward would re-quarantine it on
 * the very next miss, which defeats the point of rewriting it.
 */
export function releaseRewritten(card) {
  return { ...releaseCard(card), lapses: 0 }
}

/** Cards excluded from study, and the ones merely flagged. */
export function partitionByHealth(cards = []) {
  const suspended = [], leeches = [], healthy = []
  for (const c of cards) {
    if (isSuspended(c)) suspended.push(c)
    else if (isLeech(c)) leeches.push(c)
    else healthy.push(c)
  }
  return { suspended, leeches, healthy }
}
