import { fsrs, generatorParameters, Rating, State } from 'ts-fsrs'

// FSRS replaces SM-2 as the scheduler. It models each card as stability (how long the
// memory lasts) and difficulty (how hard it is for you specifically), rather than a
// single ease multiplier, and typically cuts review load 20–30% for the same retention.
//
// Learning steps are disabled: FSRS/Anki would otherwise schedule a card minutes ahead,
// and this app has no concept of a card coming due inside the session you're in.
const PARAMS = generatorParameters({
  request_retention: 0.9,
  learning_steps: [],
  relearning_steps: [],
  enable_fuzz: true, // spreads due dates so a big import doesn't all resurface at once
})

const scheduler = fsrs(PARAMS)

// The app grades 0..3; FSRS grades 1..4.
const RATING = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]

const EF_MAX = 2.7, EF_MIN = 1.3
const D_MIN = 1, D_MAX = 10
const clampD = d => Math.min(D_MAX, Math.max(D_MIN, d))

// Nothing else in the app understands difficulty, but plenty of it reads easeFactor —
// the "Hard" filter, the deck health average. Keep a faithful projection so those keep
// working: difficulty 1 (easiest) maps to ease 2.7, difficulty 10 to 1.3.
export const difficultyToEase = d =>
  +(EF_MAX - ((clampD(d) - D_MIN) / (D_MAX - D_MIN)) * (EF_MAX - EF_MIN)).toFixed(2)

export const easeToDifficulty = ef =>
  clampD(D_MIN + ((EF_MAX - (ef ?? 2.5)) / (EF_MAX - EF_MIN)) * (D_MAX - D_MIN))

export function hasFsrsState(card) {
  return typeof card?.stability === 'number' && typeof card?.difficulty === 'number'
}

// Estimate FSRS state from a card that only has SM-2 fields. At 90% requested
// retention the scheduled interval is approximately the stability, so the current
// interval is the best available estimate of how long this memory already lasts.
export function seedFsrsState(card) {
  const interval = Math.max(0, card.interval || 0)
  const learned = (card.repetitions || 0) > 0 || interval > 0

  // A New card must have stability AND difficulty at zero — FSRS rejects a partial
  // memory state, and there is genuinely nothing to estimate from yet.
  if (!learned) return { stability: 0, difficulty: 0, fsrsState: State.New }

  return {
    stability: Math.max(0.5, interval || 1),
    difficulty: easeToDifficulty(card.easeFactor),
    fsrsState: State.Review,
  }
}

function toFsrsCard(card) {
  const seeded = hasFsrsState(card) ? card : { ...card, ...seedFsrsState(card) }
  return {
    due: new Date(seeded.dueAt || Date.now()),
    stability: seeded.stability,
    difficulty: seeded.difficulty,
    elapsed_days: seeded.elapsedDays || 0,
    scheduled_days: seeded.interval || 0,
    reps: seeded.repetitions || 0,
    lapses: seeded.lapses || 0,
    learning_steps: 0,
    state: seeded.fsrsState ?? State.New,
    last_review: seeded.lastReviewed ? new Date(seeded.lastReviewed) : undefined,
  }
}

function merge(card, f, now) {
  return {
    ...card,
    stability: f.stability,
    difficulty: f.difficulty,
    fsrsState: f.state,
    elapsedDays: f.elapsed_days,
    // Legacy fields kept in step so existing filters, stats and exports keep working.
    interval: f.scheduled_days,
    repetitions: f.reps,
    lapses: f.lapses,
    easeFactor: difficultyToEase(f.difficulty),
    dueAt: f.due.getTime(),
    lastReviewed: now.getTime(),
  }
}

/** Grade a card. quality: 0=Again 1=Hard 2=Good 3=Easy. */
export function rateCard(card, quality, now = new Date()) {
  const result = scheduler.repeat(toFsrsCard(card), now)[RATING[quality] ?? Rating.Good]
  return merge(card, result.card, now)
}

/** Day counts each grade would schedule, for the rating buttons. */
export function previewIntervals(card, now = new Date()) {
  const all = scheduler.repeat(toFsrsCard(card), now)
  return [0, 1, 2, 3].map(q => {
    const due = all[RATING[q]].card.due
    const days = (due.getTime() - now.getTime()) / 86400000
    return days < 1 ? '<1d' : `${Math.round(days)}d`
  })
}

/** Label for a single grade — mirrors the old nextDueLabel signature. */
export function nextDueLabel(quality, card, now = new Date()) {
  return previewIntervals(card, now)[quality] ?? '—'
}
