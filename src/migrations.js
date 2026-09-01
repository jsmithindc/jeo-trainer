// ─── One-off data repairs ─────────────────────────────────────────────────────

// Before v2.5.3, saveGame() declared a finalActualScore parameter and never read it,
// so a finished game stored the actualScore from *before* Final Jeopardy — the wager
// was missing from every saved record.
//
// Deciding whether a given record is stale can't rely on the date alone. Answering
// Final Jeopardy twice made the second save capture the already-updated score, so a
// handful of pre-fix records are in fact correct, and re-applying the wager to those
// would double-count it.
//
// The reliable signal is arithmetic: a pre-Final score is a sum of clue values and
// wagers, and every clue on the board is a multiple of 100. So we test which
// hypothesis leaves a round pre-Final score. Only when the wager is itself a multiple
// of 100 — leaving both hypotheses round — do we fall back to when the game was played.
//
// Each record is stamped with fjWagerApplied so this is safe to run repeatedly.

const FJ_FIX_TIME = Date.parse('2026-09-01T05:51:40Z') // v2.5.3 shipped

const isRound = n => n % 100 === 0

export function migrateFJWagers(games) {
  let changed = 0

  const migrated = games.map(game => {
    if (game.fjWagerApplied) return game

    const fj = game.finalJeopardy
    const wager = fj?.wager || 0

    // No Final Jeopardy, no wager, or no score to repair — mark and move on.
    if (!fj || !wager || !fj.result || typeof game.actualScore !== 'number') {
      return { ...game, fjWagerApplied: true }
    }

    const delta = fj.result === 'correct' ? wager : -wager
    const staleFits = isRound(game.actualScore)           // score IS the pre-Final total
    const appliedFits = isRound(game.actualScore - delta) // wager already included

    let needsRepair
    if (staleFits && !appliedFits) needsRepair = true
    else if (!staleFits && appliedFits) needsRepair = false
    else if (staleFits && appliedFits) needsRepair = Date.parse(game.playedAt) < FJ_FIX_TIME
    else return { ...game, fjWagerApplied: true } // neither fits — leave the number alone

    if (!needsRepair) return { ...game, fjWagerApplied: true }

    changed++
    return { ...game, actualScore: game.actualScore + delta, fjWagerApplied: true }
  })

  return { games: migrated, changed }
}

// Daily Double wagers were only recorded from v2.5.8 onward, but their net effect on
// older games can be recovered exactly. Coryat ignores Daily Doubles entirely, so
// whatever separates the pre-Final show score from Coryat is the DD wagering:
//
//   ddNet = (actualScore − finalJeopardyDelta) − coryatScore
//
// Must run after migrateFJWagers, since it reads actualScore.
export function backfillDdNet(games) {
  let changed = 0

  const migrated = games.map(game => {
    if (game.ddNetBackfilled) return game

    // actualScore may still be pre-repair — come back once the FJ migration has run.
    if (!game.fjWagerApplied) return game

    // Games played from v2.5.8 on carry a real per-DD log and a directly computed
    // ddNet. Never overwrite a measured value with a derived one.
    if (Array.isArray(game.dailyDoubles)) return { ...game, ddNetBackfilled: true }

    // Predates actualScore tracking — leave ddNet absent. A fabricated 0 would read
    // as "wagered and broke even", which is a different claim from "unknown".
    if (typeof game.actualScore !== 'number' || typeof game.coryatScore !== 'number') {
      return { ...game, ddNetBackfilled: true }
    }

    const fj = game.finalJeopardy
    const fjDelta = fj?.wager && fj?.result
      ? (fj.result === 'correct' ? fj.wager : -fj.wager)
      : 0

    changed++
    return {
      ...game,
      ddNet: (game.actualScore - fjDelta) - game.coryatScore,
      ddNetDerived: true, // inferred from the score identity, not from a wager log
      ddNetBackfilled: true,
    }
  })

  return { games: migrated, changed }
}

// Adopt FSRS for cards that only have SM-2 state. Stability is estimated from the
// current interval and difficulty from the ease factor.
//
// Due dates are deliberately left alone. Rescheduling the whole deck at once would
// either bury the user under a sudden backlog or silently push work months out;
// instead each card keeps its place and FSRS takes over from its next review.
import { seedFsrsState, hasFsrsState } from './fsrs.js'

export function migrateToFsrs(cards) {
  let changed = 0
  const migrated = cards.map(card => {
    if (hasFsrsState(card)) return card
    changed++
    return { ...card, ...seedFsrsState(card) } // dueAt untouched
  })
  return { cards: migrated, changed }
}
