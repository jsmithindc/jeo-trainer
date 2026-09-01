import { describe, it, expect } from 'vitest'
import { migrateToFsrs } from './migrations.js'
import { hasFsrsState } from './fsrs.js'

describe('migrateToFsrs', () => {
  const legacy = (over = {}) => ({
    id: 'c1', front: 'f', back: 'b',
    interval: 20, easeFactor: 2.4, repetitions: 4, lapses: 1,
    dueAt: Date.now() + 3 * 86400000, lastReviewed: Date.now() - 17 * 86400000,
    ...over,
  })

  it('seeds state without moving the due date', () => {
    const card = legacy()
    const { cards, changed } = migrateToFsrs([card])
    expect(changed).toBe(1)
    expect(hasFsrsState(cards[0])).toBe(true)
    expect(cards[0].dueAt).toBe(card.dueAt) // the whole point — no mass reschedule
  })

  it('preserves review history', () => {
    const { cards } = migrateToFsrs([legacy()])
    expect(cards[0].repetitions).toBe(4)
    expect(cards[0].lapses).toBe(1)
    expect(cards[0].interval).toBe(20)
  })

  it('is idempotent', () => {
    const first = migrateToFsrs([legacy()])
    const second = migrateToFsrs(first.cards)
    const third = migrateToFsrs(second.cards)
    expect(second.changed).toBe(0)
    expect(third.changed).toBe(0)
    expect(third.cards[0].stability).toBe(first.cards[0].stability)
  })

  it('leaves a never-reviewed card as new', () => {
    const { cards } = migrateToFsrs([legacy({ interval: 0, repetitions: 0 })])
    expect(cards[0].stability).toBe(0)
    expect(cards[0].difficulty).toBe(0)
  })

  it('handles an empty deck', () => {
    expect(migrateToFsrs([]).changed).toBe(0)
  })
})
