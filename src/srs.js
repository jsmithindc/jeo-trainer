// SM-2 Spaced Repetition Algorithm
// quality: 0=Again, 1=Hard, 2=Good, 3=Easy
export function sm2(card, quality) {
  let { interval, easeFactor, repetitions } = card

  // Track lapses for leech detection
  let lapses = card.lapses || 0

  if (quality === 0) {
    // Again: reset to 1 day
    repetitions = 0
    interval = 1
    lapses += 1
  } else {
    lapses = 0
    if (repetitions === 0) {
      // First review: Hard=1d, Good=1d, Easy=4d
      interval = quality === 3 ? 4 : 1
    } else if (repetitions === 1) {
      // Second review: Hard=3d, Good=6d, Easy=8d
      interval = quality === 1 ? 3 : quality === 2 ? 6 : 8
    } else {
      // Subsequent: apply quality multiplier to current interval
      const multiplier = quality === 1 ? 1.2 : quality === 2 ? easeFactor : easeFactor * 1.3
      interval = Math.round(interval * multiplier)
    }
    repetitions += 1
  }

  easeFactor = Math.max(
    1.3,
    easeFactor + 0.1 - (3 - quality) * (0.08 + (3 - quality) * 0.02)
  )

  const dueAt = Date.now() + interval * 24 * 60 * 60 * 1000

  return { ...card, interval, easeFactor, repetitions, lapses, dueAt, lastReviewed: Date.now() }
}

export function newCard(front, back, category = '', value = 0, source = 'manual') {
  return {
    id: `card-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    front,
    back,
    category,
    value,
    source, // 'missed' | 'manual' | 'anki'
    interval: 0,
    easeFactor: 2.5,
    repetitions: 0,
    dueAt: Date.now(),
    lastReviewed: null,
    createdAt: Date.now(),
  }
}

export function formatRelative(ts) {
  const diff = ts - Date.now()
  const days = Math.ceil(diff / 86400000)
  if (days <= 0) return 'now'
  if (days === 1) return 'tomorrow'
  if (days < 7) return `in ${days}d`
  if (days < 30) return `in ${Math.round(days / 7)}w`
  return `in ${Math.round(days / 30)}mo`
}

export function nextDueLabel(quality, card) {
  const updated = sm2({ ...card }, quality)
  const ms = updated.dueAt - Date.now()
  const days = Math.round(ms / 86400000)
  if (days < 1) return '< 1d'
  if (days === 1) return '1d'
  return `${days}d`
}
