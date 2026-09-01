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
