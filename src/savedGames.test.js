import { describe, it, expect } from 'vitest'
import { normalizeGameDoc, mergeGameDocs, upsertGame, removeGame, trimForServer, listUnfinished, gameKey } from './savedGames.js'

const NOW = Date.parse('2026-10-11T12:00:00Z')
const at = mins => new Date(NOW - mins * 60000).toISOString()
const game = (id, savedMinsAgo, extra = {}) => ({ episodeMeta: { episodeId: id, episodeNumber: `#${id}` }, board: { big: true }, savedAt: at(savedMinsAgo), ...extra })

describe('normalizeGameDoc', () => {
  it('reads the single-game shape older versions stored', () => {
    const d = normalizeGameDoc(game('9552', 5))
    expect(Object.keys(d.games)).toEqual(['9552'])
    expect(d.rev).toBe(0)
  })
  it('treats nothing as an empty doc', () => {
    expect(normalizeGameDoc(null)).toEqual({ games: {}, removed: {}, rev: 0 })
  })
})

describe('upsertGame', () => {
  it('keeps one game per episode — starting a second game no longer overwrites the first', () => {
    let d = upsertGame(null, game('A', 10), { now: NOW })
    d = upsertGame(d, game('B', 1), { now: NOW })
    expect(listUnfinished(d).map(gameKey)).toEqual(['B', 'A'])
  })
  it('keeps only the most recent games', () => {
    let d = null
    for (let i = 0; i < 12; i++) d = upsertGame(d, game(`G${i}`, 100 - i), { now: NOW })
    expect(Object.keys(d.games)).toHaveLength(10)
    expect(d.games.G0).toBeUndefined()
  })
  it('drops a game that reached Final Jeopardy', () => {
    expect(listUnfinished(upsertGame(null, game('A', 1, { fjAnswered: 'correct' }), { now: NOW }))).toEqual([])
  })
})

describe('mergeGameDocs', () => {
  it('keeps the newer save of each game and every game from both sides', () => {
    const laptop = upsertGame(upsertGame(null, game('A', 30), { now: NOW }), game('B', 2), { now: NOW })
    const phone = upsertGame(null, game('A', 1, { tag: 'phone' }), { now: NOW })
    const m = mergeGameDocs(laptop, phone, { now: NOW })
    expect(m.games.A.tag).toBe('phone')
    expect(m.games.B).toBeDefined()
  })
  it('a game finished on one device stays gone when the other device\'s older copy is merged', () => {
    const phone = removeGame(upsertGame(null, game('A', 10), { now: NOW }), 'A', { now: NOW })
    const laptop = upsertGame(null, game('A', 20), { now: NOW }) // stale copy
    expect(mergeGameDocs(laptop, phone, { now: NOW }).games.A).toBeUndefined()
    expect(mergeGameDocs(phone, laptop, { now: NOW }).games.A).toBeUndefined()
  })
  it('a game saved after it was removed comes back — the episode was played again', () => {
    const removed = removeGame(null, 'A', { now: NOW - 3600000 })
    expect(mergeGameDocs(removed, upsertGame(null, game('A', 1), { now: NOW }), { now: NOW }).games.A).toBeDefined()
  })
})

describe('trimForServer', () => {
  it('sends the five newest games without their boards', () => {
    let d = null
    for (let i = 0; i < 8; i++) d = upsertGame(d, game(`G${i}`, 100 - i), { now: NOW })
    const t = trimForServer(d, { now: NOW })
    expect(Object.keys(t.games).sort()).toEqual(['G3', 'G4', 'G5', 'G6', 'G7'])
    expect(Object.values(t.games).every(g => !('board' in g))).toBe(true)
  })
})
