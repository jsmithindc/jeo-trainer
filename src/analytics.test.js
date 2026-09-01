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

import { buildRetentionSeries, buildDeckHealth } from './analytics.js'

describe('buildRetentionSeries', () => {
  const DAY = 86400000
  const ago = d => Date.now() - d * DAY

  it('counts only already-learned cards', () => {
    const log = [
      { t: ago(1), q: 0, l: 1 }, // learned card failed
      { t: ago(1), q: 2, l: 1 }, // learned card passed
      { t: ago(1), q: 0, l: 0 }, // brand new card failed — must not count
      { t: ago(1), q: 0, l: 0 },
    ]
    const s = buildRetentionSeries(log, { bucketDays: 7, buckets: 1 })
    expect(s[0].n).toBe(2)
    expect(s[0].retention).toBe(50) // not 25%, which is what counting new cards gives
  })

  it('buckets by age and reports null for empty windows', () => {
    const log = [{ t: ago(1), q: 2, l: 1 }, { t: ago(1), q: 2, l: 1 }]
    const s = buildRetentionSeries(log, { bucketDays: 7, buckets: 3 })
    expect(s).toHaveLength(3)
    expect(s[2].retention).toBe(100) // most recent bucket
    expect(s[0].retention).toBeNull() // nothing that long ago
    expect(s[0].n).toBe(0)
  })

  it('treats Hard as a pass', () => {
    // Recalling it slowly is still recalling it; only Again is a lapse.
    const log = [{ t: ago(1), q: 1, l: 1 }]
    expect(buildRetentionSeries(log, { bucketDays: 7, buckets: 1 })[0].retention).toBe(100)
  })

  it('handles an empty log', () => {
    const s = buildRetentionSeries([], { buckets: 4 })
    expect(s.every(b => b.retention === null && b.n === 0)).toBe(true)
  })
})

describe('buildDeckHealth', () => {
  it('summarises deck state', () => {
    const h = buildDeckHealth([
      { repetitions: 5, interval: 30, lapses: 0, easeFactor: 2.5 },
      { repetitions: 2, interval: 3, lapses: 1, easeFactor: 2.1 },
      { repetitions: 0, interval: 0, lapses: 0, easeFactor: 2.5 },
      { repetitions: 9, interval: 60, lapses: 5, easeFactor: 1.7 },
    ])
    expect(h.total).toBe(4)
    expect(h.learned).toBe(3)
    expect(h.mature).toBe(2)
    expect(h.lapsed).toBe(2)
    expect(h.leeches).toBe(1)
    expect(h.maturePct).toBe(50)
    expect(h.avgEase).toBe(2.2)
  })

  it('handles an empty deck', () => {
    const h = buildDeckHealth([])
    expect(h.total).toBe(0)
    expect(h.maturePct).toBe(0)
    expect(h.avgEase).toBeNull()
  })
})

import { buildStudyStreak } from './analytics.js'

describe('buildStudyStreak', () => {
  const DAY = 86400000
  const NOW = Date.parse('2026-09-04T12:00:00')
  const daysAgo = n => ({ t: NOW - n * DAY, q: 2, l: 1 })

  it('counts consecutive days studied', () => {
    const s = buildStudyStreak([daysAgo(0), daysAgo(1), daysAgo(2)], { now: NOW })
    expect(s.current).toBe(3)
    expect(s.studiedToday).toBe(true)
  })

  it('keeps the streak alive if you studied yesterday but not yet today', () => {
    // Breaking it at midnight would punish someone who simply has not studied yet.
    const s = buildStudyStreak([daysAgo(1), daysAgo(2)], { now: NOW })
    expect(s.current).toBe(2)
    expect(s.studiedToday).toBe(false)
  })

  it('breaks the streak once a whole day is missed', () => {
    const s = buildStudyStreak([daysAgo(2), daysAgo(3)], { now: NOW })
    expect(s.current).toBe(0)
    expect(s.longest).toBe(2) // history still recorded
  })

  it('counts several reviews in one day once', () => {
    const s = buildStudyStreak([daysAgo(0), daysAgo(0), daysAgo(0)], { now: NOW })
    expect(s.current).toBe(1)
    expect(s.totalDays).toBe(1)
  })

  it('reports the longest run even when the current one is shorter', () => {
    const log = [daysAgo(0), daysAgo(5), daysAgo(6), daysAgo(7), daysAgo(8)]
    const s = buildStudyStreak(log, { now: NOW })
    expect(s.current).toBe(1)
    expect(s.longest).toBe(4)
  })

  it('handles an empty log', () => {
    const s = buildStudyStreak([], { now: NOW })
    expect(s).toEqual({ current: 0, longest: 0, studiedToday: false, totalDays: 0 })
  })
})
