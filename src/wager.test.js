import { describe, it, expect } from 'vitest'
import { coverWager, isLock, maxLockWager, evaluateFinalWager, generateFinalScenario } from './wager.js'

describe('the underlying maths', () => {
  it('covers a doubling opponent by exactly a dollar', () => {
    // Second doubles to 20,000; you need 20,001, so from 15,000 that is 5,001.
    expect(coverWager(15000, 10000)).toBe(5001)
  })

  it('needs nothing when already beyond their double', () => {
    expect(coverWager(25000, 10000)).toBe(0)
  })

  it('identifies a lock only above exactly double', () => {
    expect(isLock(20001, 10000)).toBe(true)
    expect(isLock(20000, 10000)).toBe(false) // a tie is not a win
  })

  it('gives the largest wager that keeps a lock', () => {
    // 25,000 vs 10,000: they reach 20,000, so you may risk 4,999.
    expect(maxLockWager(25000, 10000)).toBe(4999)
    expect(25000 - 4999).toBeGreaterThan(20000)
  })
})

describe('evaluateFinalWager — locked', () => {
  const s = { you: 25000, second: 10000 }

  it('accepts a wager that keeps the lock', () => {
    const r = evaluateFinalWager(s, 4999)
    expect(r.verdict).toBe('optimal')
    expect(r.max).toBe(4999)
  })

  it('flags a wager that throws the lock away', () => {
    const r = evaluateFinalWager(s, 5000)
    expect(r.verdict).toBe('risky')
    expect(r.why).toMatch(/lock/i)
  })

  it('accepts wagering nothing', () => {
    expect(evaluateFinalWager(s, 0).verdict).toBe('optimal')
  })
})

describe('evaluateFinalWager — leading but catchable', () => {
  const s = { you: 15000, second: 10000 }

  it('accepts the exact cover', () => {
    expect(evaluateFinalWager(s, 5001).verdict).toBe('optimal')
  })

  it('rejects a dollar short', () => {
    const r = evaluateFinalWager(s, 5000)
    expect(r.verdict).toBe('wrong')
    expect(r.min).toBe(5001)
  })

  it('accepts betting everything', () => {
    expect(evaluateFinalWager(s, 15000).verdict).toBe('optimal')
  })
})

describe('evaluateFinalWager — trailing', () => {
  const s = { you: 8000, second: 14000 }

  it('requires enough to pass the leader', () => {
    expect(evaluateFinalWager(s, 6001).verdict).toBe('optimal')
    expect(evaluateFinalWager(s, 5000).verdict).toBe('wrong')
  })

  it('explains why a timid wager cannot win', () => {
    expect(evaluateFinalWager(s, 1000).why).toMatch(/short of the leader/i)
  })
})

describe('evaluateFinalWager — legality', () => {
  it('rejects more than you have, and negatives', () => {
    expect(evaluateFinalWager({ you: 10000, second: 5000 }, 10001).verdict).toBe('invalid')
    expect(evaluateFinalWager({ you: 10000, second: 5000 }, -1).verdict).toBe('invalid')
  })

  it('treats junk input as zero rather than throwing', () => {
    expect(() => evaluateFinalWager({ you: 10000, second: 5000 }, undefined)).not.toThrow()
    expect(evaluateFinalWager({ you: 10000, second: 5000 }, 'abc').verdict).toBeDefined()
  })
})

describe('generateFinalScenario', () => {
  it('produces legal, round scenarios', () => {
    for (let i = 0; i < 200; i++) {
      const s = generateFinalScenario()
      expect(s.you).toBeGreaterThan(0)
      expect(s.second).toBeGreaterThan(0)
      expect(s.third).toBeGreaterThanOrEqual(0)
      expect(s.you % 100).toBe(0)
      expect(s.second % 100).toBe(0)
      expect(['lock', 'leading', 'trailing']).toContain(s.position)
    }
  })

  it('covers all three positions, so every case gets practised', () => {
    const seen = new Set()
    for (let i = 0; i < 400; i++) seen.add(generateFinalScenario().position)
    expect(seen.size).toBe(3)
  })

  it('labels the position consistently with the evaluator', () => {
    for (let i = 0; i < 200; i++) {
      const s = generateFinalScenario()
      if (s.position === 'lock') expect(isLock(s.you, s.second)).toBe(true)
      if (s.position === 'trailing') expect(s.you).toBeLessThanOrEqual(s.second)
    }
  })
})
