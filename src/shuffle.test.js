import { describe, it, expect } from 'vitest'
import { shuffled } from './shuffle.js'

describe('shuffled', () => {
  it('keeps every item exactly once and leaves the input alone', () => {
    const input = [1, 2, 3, 4, 5]
    const out = shuffled(input)
    expect(out).toHaveLength(5)
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5])
    expect(input).toEqual([1, 2, 3, 4, 5])
  })

  it('handles empty and single-item arrays', () => {
    expect(shuffled([])).toEqual([])
    expect(shuffled(['only'])).toEqual(['only'])
  })

  // The property the old sort-based version failed. Over many shuffles every item should
  // land in the first position at roughly the same rate; a biased shuffle leaves the
  // original leader there far too often.
  it('distributes the first position evenly', () => {
    const N = 8, RUNS = 8000
    const items = Array.from({ length: N }, (_, i) => i)
    const firsts = new Array(N).fill(0)
    for (let i = 0; i < RUNS; i++) firsts[shuffled(items)[0]]++

    const expected = RUNS / N
    for (const count of firsts) {
      expect(count).toBeGreaterThan(expected * 0.75)
      expect(count).toBeLessThan(expected * 1.25)
    }
  })
})
