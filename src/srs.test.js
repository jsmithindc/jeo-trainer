import { describe, it, expect } from 'vitest'
import { sm2, newCard } from './srs.js'

const DAY = 86400000
const days = c => Math.round((c.dueAt - Date.now()) / DAY)

// quality: 0 = Again, 1 = Hard, 2 = Good, 3 = Easy
describe('sm2 scheduling', () => {
  it('starts a new card due immediately with a 2.5 ease', () => {
    const c = newCard('front', 'back')
    expect(c.repetitions).toBe(0)
    expect(c.interval).toBe(0)
    expect(c.easeFactor).toBe(2.5)
    expect(c.dueAt).toBeLessThanOrEqual(Date.now())
  })

  it('schedules the first review at 1 day for Hard and Good, 4 for Easy', () => {
    const c = newCard('f', 'b')
    expect(days(sm2(c, 1))).toBe(1)
    expect(days(sm2(c, 2))).toBe(1)
    expect(days(sm2(c, 3))).toBe(4)
  })

  it('schedules the second review at 3 / 6 / 8 days', () => {
    const c = { ...newCard('f', 'b'), repetitions: 1, interval: 1 }
    expect(days(sm2(c, 1))).toBe(3)
    expect(days(sm2(c, 2))).toBe(6)
    expect(days(sm2(c, 3))).toBe(8)
  })

  it('multiplies the interval on later reviews', () => {
    const c = { ...newCard('f', 'b'), repetitions: 2, interval: 10, easeFactor: 2.5 }
    expect(days(sm2(c, 1))).toBe(12)              // 10 * 1.2
    expect(days(sm2(c, 2))).toBe(25)              // 10 * 2.5
    expect(days(sm2(c, 3))).toBe(Math.round(32.5)) // 10 * 2.5 * 1.3
  })

  it('resets to 1 day and clears the streak on Again', () => {
    const c = { ...newCard('f', 'b'), repetitions: 5, interval: 40 }
    const r = sm2(c, 0)
    expect(r.repetitions).toBe(0)
    expect(days(r)).toBe(1)
  })

  it('adjusts ease per grade and never drops below 1.3', () => {
    const c = newCard('f', 'b')
    expect(sm2(c, 3).easeFactor).toBeCloseTo(2.6, 5)
    expect(sm2(c, 2).easeFactor).toBeCloseTo(2.5, 5)
    expect(sm2(c, 1).easeFactor).toBeCloseTo(2.36, 5)
    expect(sm2(c, 0).easeFactor).toBeCloseTo(2.18, 5)

    let hard = { ...c, easeFactor: 1.3 }
    for (let i = 0; i < 10; i++) hard = sm2(hard, 0)
    expect(hard.easeFactor).toBe(1.3)
  })

  it('stamps lastReviewed', () => {
    expect(sm2(newCard('f', 'b'), 2).lastReviewed).toBeGreaterThan(0)
  })
})

describe('sm2 lapse counting (drives leech detection)', () => {
  it('counts consecutive failures', () => {
    let c = newCard('f', 'b')
    c = sm2(c, 0); c = sm2(c, 0); c = sm2(c, 0)
    expect(c.lapses).toBe(3)
  })

  // DeckView flags leeches at lapses >= 4, but a single correct answer wipes the
  // count — so only four failures in a row can ever raise the flag. A card failed
  // twenty times with an occasional success never registers, which is exactly the
  // card the leech filter is meant to surface.
  it('DOCUMENTS CURRENT BEHAVIOUR: any success resets the lapse count to zero', () => {
    let c = newCard('f', 'b')
    c = sm2(c, 0); c = sm2(c, 0); c = sm2(c, 0)
    expect(c.lapses).toBe(3)
    c = sm2(c, 2) // one Good
    expect(c.lapses).toBe(0)
  })
})
