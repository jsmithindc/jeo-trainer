import { describe, it, expect } from 'vitest'
import { mergeData } from './supabase.js'

// Sync cutoff used throughout: anything created before this was, in principle,
// already uploaded during a previous sync.
const CUTOFF = '2026-06-01T00:00:00Z'
const before = Date.parse('2026-05-01T00:00:00Z')
const after = Date.parse('2026-07-01T00:00:00Z')

const card = (id, createdAt) => ({ id, front: id, back: id, createdAt })
const game = (id, playedAt) => ({ id, playedAt })

describe('mergeData — cards', () => {
  it('returns remote cards when local is empty', () => {
    const r = mergeData({ cards: [], gameHistory: [] }, { cards: [card('a', before)], gameHistory: [] }, CUTOFF)
    expect(r.cards.map(c => c.id)).toEqual(['a'])
  })

  it('keeps a local card created since the last sync', () => {
    const r = mergeData(
      { cards: [card('new', after)], gameHistory: [] },
      { cards: [card('a', before)], gameHistory: [] },
      CUTOFF,
    )
    expect(r.cards.map(c => c.id).sort()).toEqual(['a', 'new'])
  })

  it('lets remote win for a card present on both sides', () => {
    const r = mergeData(
      { cards: [{ ...card('a', before), front: 'local version' }], gameHistory: [] },
      { cards: [{ ...card('a', before), front: 'remote version' }], gameHistory: [] },
      CUTOFF,
    )
    expect(r.cards).toHaveLength(1)
    expect(r.cards[0].front).toBe('remote version')
  })

  it('treats local as authoritative when it holds far more cards', () => {
    // Guards against a wiped remote: >2x and >50 more than remote.
    const local = Array.from({ length: 200 }, (_, i) => card('c' + i, before))
    const r = mergeData({ cards: local, gameHistory: [] }, { cards: [card('c0', before)], gameHistory: [] }, CUTOFF)
    expect(r.cards).toHaveLength(200)
  })

  // ── The data-loss path ──────────────────────────────────────────────────────
  // A card can be local-only for two very different reasons: it was deleted on
  // another device, or its upload never landed. Using createdAt to tell them apart
  // means any card whose upload failed is silently destroyed on the next login.
  it('keeps a local-only card whose upload previously failed', () => {
    const r = mergeData(
      { cards: [card('never-uploaded', before)], gameHistory: [] },
      { cards: [card('a', before)], gameHistory: [] },
      CUTOFF,
    )
    expect(r.cards.map(c => c.id).sort()).toEqual(['a', 'never-uploaded'])
  })

  it('drops a local card that was genuinely deleted elsewhere', () => {
    const r = mergeData(
      { cards: [card('deleted-on-phone', before)], gameHistory: [] },
      { cards: [card('a', before)], gameHistory: [], tombstones: [{ id: 'deleted-on-phone', deletedAt: after }] },
      CUTOFF,
    )
    expect(r.cards.map(c => c.id)).toEqual(['a'])
  })

  it('honours a local deletion that has not reached remote yet', () => {
    const r = mergeData(
      { cards: [], gameHistory: [], tombstones: [{ id: 'a', deletedAt: after }] },
      { cards: [card('a', before)], gameHistory: [] },
      CUTOFF,
    )
    expect(r.cards).toEqual([])
  })

  it('carries tombstones through so deletions propagate', () => {
    const r = mergeData(
      { cards: [], gameHistory: [], tombstones: [{ id: 'x', deletedAt: after }] },
      { cards: [], gameHistory: [], tombstones: [{ id: 'y', deletedAt: after }] },
      CUTOFF,
    )
    expect((r.tombstones || []).map(t => t.id).sort()).toEqual(['x', 'y'])
  })

  it('lets a re-created card outlive its own tombstone', () => {
    const r = mergeData(
      { cards: [card('a', after)], gameHistory: [] },
      { cards: [], gameHistory: [], tombstones: [{ id: 'a', deletedAt: before }] },
      CUTOFF,
    )
    expect(r.cards.map(c => c.id)).toEqual(['a'])
  })
})

describe('mergeData — game history', () => {
  it('keeps local games newer than the cutoff and lets remote win on conflict', () => {
    const r = mergeData(
      { cards: [], gameHistory: [{ ...game('g1', '2026-05-02'), tag: 'local' }, game('g2', '2026-07-02')] },
      { cards: [], gameHistory: [{ ...game('g1', '2026-05-02'), tag: 'remote' }] },
      CUTOFF,
    )
    expect(r.gameHistory.map(g => g.id).sort()).toEqual(['g1', 'g2'])
    expect(r.gameHistory.find(g => g.id === 'g1').tag).toBe('remote')
  })

  it('sorts newest first', () => {
    const r = mergeData(
      { cards: [], gameHistory: [] },
      { cards: [], gameHistory: [game('old', '2026-01-01'), game('new', '2026-08-01')] },
      CUTOFF,
    )
    expect(r.gameHistory.map(g => g.id)).toEqual(['new', 'old'])
  })
})
