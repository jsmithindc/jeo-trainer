import { describe, it, expect } from 'vitest'
import { getMetaCategory } from './analytics.js'

describe('getMetaCategory — substring false positives', () => {
  // Each of these was misfiled by plain substring matching, which quietly skewed the
  // heat map and the "what should I study" recommendations built on top of it.
  it('does not read "war" inside a name', () => {
    expect(getMetaCategory('ANDY WARHOL')).not.toBe('History')
    expect(getMetaCategory('HOWARD THE DUCK')).not.toBe('History')
    expect(getMetaCategory('EDWARD SCISSORHANDS')).not.toBe('History')
  })

  it('does not read "uk" inside DUKE', () => {
    expect(getMetaCategory('DUKE ELLINGTON')).not.toBe('Geography')
  })

  it('does not read "pop" inside POPULATION', () => {
    expect(getMetaCategory('POPULATION DENSITY')).not.toBe('Arts & Entertainment')
  })
})

describe('getMetaCategory — genuine matches still work', () => {
  it('matches whole words', () => {
    expect(getMetaCategory('WORLD CAPITALS')).toBe('Geography')
    expect(getMetaCategory('THE CIVIL WAR')).toBe('History')
    expect(getMetaCategory('US PRESIDENTS')).toBe('History')
    expect(getMetaCategory('HOLLYWOOD DIRECTORS')).toBe('Arts & Entertainment')
    expect(getMetaCategory('OLYMPIC SPORTS')).toBe('Sports & Games')
  })

  it('tolerates plurals in either direction', () => {
    expect(getMetaCategory('THE NOVEL')).toBe('Literature')
    expect(getMetaCategory('NOVELS')).toBe('Literature')
    expect(getMetaCategory('WORLD WARS')).toBe('History')
  })

  it('falls back to Potpourri when nothing matches', () => {
    expect(getMetaCategory('ZZZZZ QQQQQ')).toBe('Potpourri')
    expect(getMetaCategory('')).toBe('Potpourri')
    expect(getMetaCategory(undefined)).toBe('Potpourri')
  })

  it('picks the best match rather than whichever is declared first', () => {
    // Two Sports keywords ("olympic", "swimming") beat the single Arts hit ("tv").
    expect(getMetaCategory('OLYMPIC SWIMMING ON TV')).toBe('Sports & Games')
  })
})

import { buildDailyDoubleStats } from './analytics.js'

describe('buildDailyDoubleStats', () => {
  const dd = (result, wager, value = 600, wagered = true) => ({ result, wager, value, wagered })

  it('sums net across every game that has one', () => {
    const s = buildDailyDoubleStats([{ ddNet: 1800 }, { ddNet: -500 }, { ddNet: 0 }])
    expect(s.net).toBe(1300)
    expect(s.gamesWithNet).toBe(3)
    expect(s.netPerGame).toBe(433)
  })

  it('ignores games with no ddNet at all', () => {
    // The oldest game predates actualScore tracking and must not count as a zero.
    const s = buildDailyDoubleStats([{ ddNet: 1000 }, { airDate: 'old' }])
    expect(s.gamesWithNet).toBe(1)
    expect(s.netPerGame).toBe(1000)
  })

  it('computes hit rate from the logged wagers only', () => {
    const s = buildDailyDoubleStats([
      { ddNet: 0, dailyDoubles: [dd('correct', 1000), dd('incorrect', 2000)] },
      { ddNet: 0, dailyDoubles: [dd('correct', 3000)] },
    ])
    expect(s.hits).toBe(2)
    expect(s.misses).toBe(1)
    expect(s.hitRate).toBe(67)
    expect(s.avgWager).toBe(2000)
    expect(s.biggestWin).toBe(3000)
    expect(s.biggestLoss).toBe(2000)
  })

  it('reports null rather than zero when nothing is logged yet', () => {
    const s = buildDailyDoubleStats([{ ddNet: 5000 }])
    expect(s.hitRate).toBeNull()
    expect(s.avgWager).toBeNull()
    expect(s.net).toBe(5000)
  })

  it('counts true Daily Doubles', () => {
    const s = buildDailyDoubleStats([{ ddNet: 0, dailyDoubles: [dd('correct', 3000, 600), dd('correct', 400, 600)] }])
    expect(s.trueDDs).toBe(1)
  })

  it('excludes skipped wagers from the average', () => {
    const s = buildDailyDoubleStats([{ ddNet: 0, dailyDoubles: [dd('correct', 1000), dd('correct', 600, 600, false)] }])
    expect(s.avgWager).toBe(1000)
    expect(s.hits).toBe(2)
  })
})
