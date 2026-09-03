import { describe, it, expect } from 'vitest'
import { recallMs, suggestGrade, formatRecall, summariseRecall, READ_GRACE_MS } from './recall.js'

describe('recallMs', () => {
  it('excludes the reading grace, so it measures retrieval not reading', () => {
    const shown = 1_000_000
    expect(recallMs(shown, shown + READ_GRACE_MS + 3000)).toBe(3000)
  })

  it('floors at zero when revealed inside the grace period', () => {
    const shown = 1_000_000
    expect(recallMs(shown, shown + 300)).toBe(0)
    expect(recallMs(shown, shown)).toBe(0)
  })

  it('returns null with no start time', () => {
    expect(recallMs(null)).toBeNull()
    expect(recallMs(undefined)).toBeNull()
  })
})

describe('suggestGrade', () => {
  it('grades a correct answer by speed', () => {
    expect(suggestGrade({ correct: true, ms: 0 })).toBe(3)      // instant → Easy
    expect(suggestGrade({ correct: true, ms: 1999 })).toBe(3)
    expect(suggestGrade({ correct: true, ms: 2000 })).toBe(2)   // → Good
    expect(suggestGrade({ correct: true, ms: 3999 })).toBe(2)
    expect(suggestGrade({ correct: true, ms: 4000 })).toBe(1)   // → Hard
    expect(suggestGrade({ correct: true, ms: 30000 })).toBe(1)
  })

  it('grades a miss as Again no matter how fast', () => {
    expect(suggestGrade({ correct: false, ms: 0 })).toBe(0)
    expect(suggestGrade({ correct: false, ms: 20000 })).toBe(0)
  })

  it('suggests by time alone when correctness is unknown', () => {
    // Reveal mode: the app knows how long you took, not whether you were right.
    expect(suggestGrade({ ms: 1000 })).toBe(3)
    expect(suggestGrade({ ms: 5000 })).toBe(1)
  })

  it('suggests nothing when there is nothing to go on', () => {
    expect(suggestGrade({})).toBeNull()
    expect(suggestGrade({ correct: true })).toBeNull()
  })
})

describe('formatRecall', () => {
  it('reads naturally', () => {
    expect(formatRecall(0)).toBe('instant')
    expect(formatRecall(1400)).toBe('1.4s')
    expect(formatRecall(12000)).toBe('12.0s')
    expect(formatRecall(null)).toBeNull()
  })
})

describe('summariseRecall', () => {
  const e = (ms, q = 2) => ({ t: Date.now(), q, l: 1, ms })

  it('buckets by the same thresholds the suggestion uses', () => {
    const s = summariseRecall([e(500), e(1500), e(2500), e(3000), e(9000)])
    expect(s.fast).toBe(2)
    expect(s.ok).toBe(2)
    expect(s.slow).toBe(1)
    expect(s.n).toBe(5)
  })

  it('reports the median', () => {
    expect(summariseRecall([e(1000), e(2000), e(9000)]).median).toBe(2000)
    expect(summariseRecall([e(1000), e(3000)]).median).toBe(2000)
  })

  it('ignores failed reviews and untimed entries', () => {
    // A lapse says nothing about retrieval speed, and old entries have no ms.
    const s = summariseRecall([e(1000), e(500, 0), { t: 1, q: 2, l: 1 }])
    expect(s.n).toBe(1)
  })

  it('handles an empty log', () => {
    expect(summariseRecall([])).toEqual({ n: 0, median: null, fast: 0, ok: 0, slow: 0 })
  })
})
