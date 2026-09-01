// Final Jeopardy wagering, as a drill.
//
// Coryat deliberately excludes Daily Doubles and Final Jeopardy, so wagering is the
// part of the game your score has never measured — and it is where a good player and
// a great one separate. The maths is small and learnable, which makes it drillable.
//
// Terms used throughout: Y = your score, S = the closest opponent's score.

/** The wager that guarantees a win if you answer correctly and second place doubles. */
export function coverWager(you, second) {
  return Math.max(0, 2 * second + 1 - you)
}

/** True when you cannot be caught even if you answer incorrectly and wager nothing. */
export function isLock(you, second) {
  return you > 2 * second
}

/** The largest wager that keeps a lock intact. */
export function maxLockWager(you, second) {
  return Math.max(0, you - 2 * second - 1)
}

/**
 * Assess a Final Jeopardy wager.
 * Returns the acceptable range, a verdict, and the reasoning to show afterwards.
 */
export function evaluateFinalWager({ you, second }, wager) {
  const w = Math.round(Number(wager) || 0)

  if (w < 0 || w > you) {
    return {
      verdict: 'invalid',
      min: 0, max: you,
      headline: 'Not a legal wager',
      why: `A wager has to be between $0 and your score of $${you.toLocaleString()}.`,
    }
  }

  // Leading, and out of reach even if you miss.
  if (isLock(you, second)) {
    const max = maxLockWager(you, second)
    const safe = w <= max
    return {
      verdict: safe ? 'optimal' : 'risky',
      min: 0, max,
      headline: safe ? 'Lock preserved' : 'Gave up a locked game',
      why: safe
        ? `You have a lock: $${you.toLocaleString()} is more than double $${second.toLocaleString()}. Anything up to $${max.toLocaleString()} wins even if you are wrong.`
        : `You had a lock. Wagering more than $${max.toLocaleString()} means a wrong answer drops you to $${(you - w).toLocaleString()}, at or below the $${(second * 2).toLocaleString()} second place can reach.`,
    }
  }

  // Leading, but catchable.
  if (you > second) {
    const cover = coverWager(you, second)
    const covered = w >= cover
    return {
      verdict: covered ? 'optimal' : 'wrong',
      min: cover, max: you,
      headline: covered ? 'Covered the field' : 'Left yourself catchable',
      why: covered
        ? `Second place can reach $${(2 * second).toLocaleString()} by doubling. Wagering at least $${cover.toLocaleString()} beats that when you are right.`
        : `Second place doubles to $${(2 * second).toLocaleString()}. You needed at least $${cover.toLocaleString()} to stay ahead; $${w.toLocaleString()} loses to a correct opponent.`,
    }
  }

  // Trailing: you have to pass the leader, and they will usually cover.
  const needed = Math.max(0, second - you + 1)
  const enough = w >= needed
  return {
    verdict: enough ? 'optimal' : 'wrong',
    min: needed, max: you,
    headline: enough ? 'Gave yourself a chance' : 'Not enough to catch up',
    why: enough
      ? `Trailing $${second.toLocaleString()}, a correct answer puts you at $${(you + w).toLocaleString()} — ahead of the leader's current score, so you win whenever they miss.`
      : `You would finish at $${(you + w).toLocaleString()}, still short of the leader's $${second.toLocaleString()}. Trailing means wagering at least $${needed.toLocaleString()}, even though it stings.`,
  }
}

const round = (n, to = 100) => Math.max(0, Math.round(n / to) * to)

/**
 * Generate a Final Jeopardy scenario. Deliberately weighted across the three shapes
 * that need different reasoning, rather than uniformly random — the drill is only
 * useful if locks and trailing positions come up often enough to practise.
 */
export function generateFinalScenario(rand = Math.random) {
  const shape = rand()
  let you, second

  if (shape < 0.3) {
    // Locked: more than double second place.
    second = round(2000 + rand() * 8000)
    you = round(second * (2.1 + rand() * 0.8))
  } else if (shape < 0.75) {
    // Leading but catchable — the most common real position.
    second = round(4000 + rand() * 10000)
    you = round(second * (1.05 + rand() * 0.85))
  } else {
    // Trailing.
    second = round(8000 + rand() * 12000)
    you = round(second * (0.4 + rand() * 0.55))
  }

  // Third place matters for how the board feels, but not for the core decision.
  const third = round(Math.min(you, second) * (0.3 + rand() * 0.5))

  return {
    you: Math.max(1000, you),
    second: Math.max(1000, second),
    third: Math.max(0, third),
    position: isLock(you, second) ? 'lock' : you > second ? 'leading' : 'trailing',
  }
}
