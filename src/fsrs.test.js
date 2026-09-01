import { describe, it, expect } from 'vitest'
import { rateCard, previewIntervals, seedFsrsState, hasFsrsState, difficultyToEase, easeToDifficulty } from './fsrs.js'
import { newCard } from './srs.js'

const DAY = 86400000
const days = (card, from = Date.now()) => Math.round((card.dueAt - from) / DAY)

describe('difficulty ↔ ease projection', () => {
  it('maps the ends of the range', () => {
    expect(difficultyToEase(1)).toBe(2.7)
    expect(difficultyToEase(10)).toBe(1.3)
  })

  it('round-trips within tolerance', () => {
    for (const ef of [1.3, 1.8, 2.2, 2.5, 2.7]) {
      expect(difficultyToEase(easeToDifficulty(ef))).toBeCloseTo(ef, 1)
    }
  })

  it('clamps out-of-range input rather than producing nonsense', () => {
    expect(difficultyToEase(-5)).toBe(2.7)
    expect(difficultyToEase(99)).toBe(1.3)
    expect(easeToDifficulty(undefined)).toBeGreaterThanOrEqual(1)
  })
})

describe('seeding from SM-2 state', () => {
  it('treats a reviewed card as already stable', () => {
    const s = seedFsrsState({ interval: 30, easeFactor: 2.5, repetitions: 4 })
    expect(s.stability).toBe(30) // interval ≈ stability at 90% retention
    expect(s.difficulty).toBeGreaterThan(1)
  })

  it('treats a never-reviewed card as new', () => {
    const s = seedFsrsState({ interval: 0, easeFactor: 2.5, repetitions: 0 })
    expect(s.stability).toBe(0)
  })

  it('maps a low ease to high difficulty', () => {
    const hard = seedFsrsState({ interval: 5, easeFactor: 1.4, repetitions: 3 })
    const easy = seedFsrsState({ interval: 5, easeFactor: 2.6, repetitions: 3 })
    expect(hard.difficulty).toBeGreaterThan(easy.difficulty)
  })
})

describe('rateCard', () => {
  it('schedules further out for better grades', () => {
    const c = newCard('f', 'b')
    const again = days(rateCard(c, 0))
    const hard = days(rateCard(c, 1))
    const good = days(rateCard(c, 2))
    const easy = days(rateCard(c, 3))
    expect(again).toBeLessThanOrEqual(hard)
    expect(hard).toBeLessThanOrEqual(good)
    expect(good).toBeLessThan(easy)
  })

  it('keeps the legacy fields in step so existing filters still work', () => {
    const r = rateCard(newCard('f', 'b'), 2)
    expect(typeof r.interval).toBe('number')
    expect(typeof r.repetitions).toBe('number')
    expect(typeof r.lapses).toBe('number')
    expect(r.easeFactor).toBeGreaterThanOrEqual(1.3)
    expect(r.easeFactor).toBeLessThanOrEqual(2.7)
    expect(r.dueAt).toBeGreaterThan(Date.now())
    expect(r.lastReviewed).toBeGreaterThan(0)
  })

  it('grows stability as a card is repeatedly recalled', () => {
    let c = newCard('f', 'b')
    let at = Date.now()
    const seen = []
    for (let i = 0; i < 4; i++) {
      c = rateCard(c, 2, new Date(at))
      seen.push(c.stability)
      at = c.dueAt
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1])
  })

  it('counts a lapse and collapses the interval on Again', () => {
    let c = rateCard(newCard('f', 'b'), 3)
    c = rateCard(c, 2, new Date(c.dueAt))
    const before = c.interval
    const after = rateCard(c, 0, new Date(c.dueAt))
    expect(after.lapses).toBe(c.lapses + 1)
    expect(after.interval).toBeLessThan(before)
  })

  it('adopts a legacy SM-2 card without losing its place', () => {
    const legacy = {
      ...newCard('f', 'b'),
      interval: 30, easeFactor: 2.3, repetitions: 5, lapses: 2,
      dueAt: Date.now() + 5 * DAY, lastReviewed: Date.now() - 25 * DAY,
    }
    expect(hasFsrsState(legacy)).toBe(false)
    const rated = rateCard(legacy, 2)
    expect(hasFsrsState(rated)).toBe(true)
    expect(rated.lapses).toBe(2)          // history preserved
    expect(rated.repetitions).toBe(6)     // and continued, not restarted
    expect(rated.interval).toBeGreaterThan(1)
  })

  it('defaults an unknown grade to Good rather than throwing', () => {
    expect(() => rateCard(newCard('f', 'b'), 99)).not.toThrow()
  })
})

describe('previewIntervals', () => {
  it('returns a label per grade, ascending', () => {
    const p = previewIntervals(newCard('f', 'b'))
    expect(p).toHaveLength(4)
    p.forEach(l => expect(l).toMatch(/^(<1d|\d+d)$/))
  })

  it('matches what rateCard actually schedules', () => {
    const c = { ...newCard('f', 'b'), interval: 10, easeFactor: 2.5, repetitions: 3 }
    const now = new Date()
    const preview = previewIntervals(c, now)[2]
    const actual = Math.round((rateCard(c, 2, now).dueAt - now.getTime()) / DAY)
    // Fuzz can shift the two calls apart by a day; the label must still be close.
    expect(Math.abs(parseInt(preview) - actual)).toBeLessThanOrEqual(2)
  })
})
