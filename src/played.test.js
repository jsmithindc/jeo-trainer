import { describe, it, expect } from 'vitest'
import { buildPlayedIndex, findPlayed, isPlayed, normalizeAirDate } from './played.js'

// Shapes taken from the real deck: modern records carry gameId, older ones don't.
const modern = { id: 'g1', gameId: '9504', episodeId: '9615', airDate: 'Friday, July 24, 2026', coryatScore: 20600 }
const legacy = { id: 'g2', gameId: undefined, episodeId: '9582', airDate: 'Tuesday, June 9, 2026', coryatScore: 18000 }

const ep = (gameId, airDate) => ({ gameId, airDate, showNumber: gameId })

describe('normalizeAirDate', () => {
  it('strips the weekday the history stores but the listing does not', () => {
    expect(normalizeAirDate('Friday, July 24, 2026')).toBe('july 24, 2026')
    expect(normalizeAirDate('July 24, 2026')).toBe('july 24, 2026')
  })

  it('survives missing values', () => {
    expect(normalizeAirDate(undefined)).toBe('')
    expect(normalizeAirDate(null)).toBe('')
  })
})

describe('findPlayed', () => {
  const index = buildPlayedIndex([modern, legacy])

  it('matches a modern record by game id', () => {
    expect(findPlayed(index, ep('9504', 'July 24, 2026'))?.id).toBe('g1')
  })

  it('matches a legacy record with no game id, by air date', () => {
    // The regression: 32 games were invisible because they were filtered on gameId.
    expect(findPlayed(index, ep('9471', 'June 9, 2026'))?.id).toBe('g2')
  })

  it('reports an unplayed episode as unplayed', () => {
    expect(isPlayed(index, ep('9999', 'August 3, 2026'))).toBe(false)
  })

  it('does not match on a missing date', () => {
    expect(isPlayed(buildPlayedIndex([{ id: 'x' }]), ep(undefined, undefined))).toBe(false)
  })

  it('prefers the game id when both could match different records', () => {
    const other = { id: 'g3', gameId: '9504', airDate: 'Tuesday, June 9, 2026' }
    const idx = buildPlayedIndex([legacy, other])
    expect(findPlayed(idx, ep('9504', 'June 9, 2026'))?.id).toBe('g3')
  })

  it('resolves a replayed episode to the most recent attempt', () => {
    const older = { id: 'old', gameId: '9504', airDate: 'Friday, July 24, 2026', coryatScore: 100 }
    const newer = { id: 'new', gameId: '9504', airDate: 'Friday, July 24, 2026', coryatScore: 999 }
    const idx = buildPlayedIndex([newer, older]) // history is newest-first
    expect(findPlayed(idx, ep('9504', 'July 24, 2026'))?.id).toBe('new')
  })

  it('handles an empty history and bad input', () => {
    const empty = buildPlayedIndex([])
    expect(isPlayed(empty, ep('1', 'x'))).toBe(false)
    expect(findPlayed(null, ep('1', 'x'))).toBeUndefined()
    expect(findPlayed(empty, null)).toBeUndefined()
    expect(() => buildPlayedIndex(undefined)).not.toThrow()
  })

  it('tolerates a numeric game id on either side', () => {
    const idx = buildPlayedIndex([{ id: 'n', gameId: 9504, airDate: 'x' }])
    expect(findPlayed(idx, ep(9504, 'y'))?.id).toBe('n')
    expect(findPlayed(idx, ep('9504', 'y'))?.id).toBe('n')
  })
})

// ── Replay history retention (v2.7.7) ────────────────────────────────────────
// saveGame used to drop any existing entry for the same episode, so replaying a game
// destroyed the earlier attempt. It still has to collapse a genuine double-save, which
// happens when Final Jeopardy is answered twice in one sitting.
describe('replay vs double-save', () => {
  const DOUBLE_SAVE_WINDOW = 10 * 60 * 1000

  // Mirrors the reducer in saveGame.
  const applySave = (prev, game, now = Date.now()) => {
    const kept = prev.filter(g => !(
      g.episodeId === game.episodeId &&
      now - new Date(g.playedAt).getTime() < DOUBLE_SAVE_WINDOW
    ))
    const attempt = kept.filter(g => g.episodeId === game.episodeId).length + 1
    return [{ ...game, attempt }, ...kept]
  }

  const at = mins => new Date(Date.now() - mins * 60000).toISOString()

  it('replaces an entry saved moments ago', () => {
    const prev = [{ id: 'a', episodeId: '9550', playedAt: at(1), coryatScore: 100 }]
    const out = applySave(prev, { id: 'b', episodeId: '9550', playedAt: at(0), coryatScore: 200 })
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('b')
    expect(out[0].attempt).toBe(1)
  })

  it('keeps a genuine replay from another day', () => {
    const prev = [{ id: 'a', episodeId: '9550', playedAt: at(60 * 24 * 3), coryatScore: 100 }]
    const out = applySave(prev, { id: 'b', episodeId: '9550', playedAt: at(0), coryatScore: 200 })
    expect(out).toHaveLength(2)
    expect(out[0].attempt).toBe(2) // so improvement is visible
    expect(out.map(g => g.coryatScore)).toEqual([200, 100])
  })

  it('leaves other episodes untouched', () => {
    const prev = [
      { id: 'x', episodeId: '9551', playedAt: at(2) },
      { id: 'a', episodeId: '9550', playedAt: at(2) },
    ]
    const out = applySave(prev, { id: 'b', episodeId: '9550', playedAt: at(0) })
    expect(out.map(g => g.id).sort()).toEqual(['b', 'x'])
  })

  it('numbers a third attempt correctly', () => {
    let h = [
      { id: 'a2', episodeId: '9550', playedAt: at(60 * 24 * 2), attempt: 2 },
      { id: 'a1', episodeId: '9550', playedAt: at(60 * 24 * 9), attempt: 1 },
    ]
    h = applySave(h, { id: 'a3', episodeId: '9550', playedAt: at(0) })
    expect(h[0].attempt).toBe(3)
    expect(h).toHaveLength(3)
  })
})
