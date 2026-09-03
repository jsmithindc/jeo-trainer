import { describe, it, expect } from 'vitest'
import {
  isLeech, isSuspended, shouldQuarantine, suspendCard, releaseCard, releaseRewritten,
  partitionByHealth, LEECH_LAPSES, QUARANTINE_LAPSES,
} from './leech.js'

const card = (over = {}) => ({ id: 'c1', front: 'f', back: 'b', lapses: 0, ...over })

describe('the two tiers', () => {
  it('flags at 4 but does not quarantine there', () => {
    const c = card({ lapses: LEECH_LAPSES })
    expect(isLeech(c)).toBe(true)
    expect(shouldQuarantine(c)).toBe(false)
  })

  it('quarantines only at 8', () => {
    expect(shouldQuarantine(card({ lapses: QUARANTINE_LAPSES - 1 }))).toBe(false)
    expect(shouldQuarantine(card({ lapses: QUARANTINE_LAPSES }))).toBe(true)
    expect(shouldQuarantine(card({ lapses: 20 }))).toBe(true)
  })

  it('does not re-quarantine an already suspended card', () => {
    expect(shouldQuarantine(card({ lapses: 12, suspended: true }))).toBe(false)
  })

  it('survives missing fields', () => {
    expect(isLeech({})).toBe(false)
    expect(isLeech(undefined)).toBe(false)
    expect(isSuspended(undefined)).toBe(false)
    expect(shouldQuarantine({})).toBe(false)
  })
})

describe('suspending and releasing', () => {
  it('suspends with a reason and a timestamp', () => {
    const s = suspendCard(card({ lapses: 9 }))
    expect(s.suspended).toBe(true)
    expect(s.suspendedReason).toBe('leech')
    expect(s.suspendedAt).toBeGreaterThan(0)
    expect(s.lapses).toBe(9) // history preserved
  })

  it('releases without leaving the suspension fields behind', () => {
    const r = releaseCard(suspendCard(card({ lapses: 9 })))
    expect(r.suspended).toBeUndefined()
    expect(r.suspendedAt).toBeUndefined()
    expect(r.suspendedReason).toBeUndefined()
    expect(r.lapses).toBe(9) // released as-is, still a known problem card
  })

  it('clears the lapse count when released after a rewrite', () => {
    // Otherwise a single miss on the rewritten card re-quarantines it immediately.
    const r = releaseRewritten(suspendCard(card({ lapses: 11 })))
    expect(r.suspended).toBeUndefined()
    expect(r.lapses).toBe(0)
    expect(shouldQuarantine(r)).toBe(false)
  })

  it('keeps the rest of the card intact through the round trip', () => {
    const original = card({ lapses: 8, front: 'Q', back: 'A', interval: 3, easeFactor: 1.9 })
    const back = releaseCard(suspendCard(original))
    expect(back.front).toBe('Q')
    expect(back.interval).toBe(3)
    expect(back.easeFactor).toBe(1.9)
  })
})

describe('partitionByHealth', () => {
  it('splits suspended, flagged and healthy', () => {
    const p = partitionByHealth([
      card({ id: 'ok', lapses: 0 }),
      card({ id: 'hard', lapses: 5 }),
      card({ id: 'gone', lapses: 9, suspended: true }),
      card({ id: 'ok2', lapses: 3 }),
    ])
    expect(p.healthy.map(c => c.id)).toEqual(['ok', 'ok2'])
    expect(p.leeches.map(c => c.id)).toEqual(['hard'])
    expect(p.suspended.map(c => c.id)).toEqual(['gone'])
  })

  it('counts a suspended card once, as suspended rather than as a leech', () => {
    const p = partitionByHealth([card({ lapses: 12, suspended: true })])
    expect(p.suspended).toHaveLength(1)
    expect(p.leeches).toHaveLength(0)
  })

  it('handles an empty deck', () => {
    expect(partitionByHealth([])).toEqual({ suspended: [], leeches: [], healthy: [] })
    expect(() => partitionByHealth(undefined)).not.toThrow()
  })
})
