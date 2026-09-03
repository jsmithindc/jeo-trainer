import { describe, it, expect, beforeEach, vi } from 'vitest'
import { seedFsrsState, rateCard } from './fsrs.js'
import { newCard } from './srs.js'
import { State } from 'ts-fsrs'

const days = c => Math.round((c.dueAt - Date.now()) / 86400000)

// A minimal localStorage that can be told to run out of room, which is the condition
// this helper exists for and the one that used to lose cards silently.
let store, quotaAfterBytes

function installStorage() {
  store = new Map()
  quotaAfterBytes = Infinity
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      const used = [...store.entries()].reduce((n, [key, val]) => (key === k ? n : n + val.length), 0)
      if (used + v.length > quotaAfterBytes) {
        const err = new Error('QuotaExceededError')
        err.name = 'QuotaExceededError'
        throw err
      }
      store.set(k, v)
    },
    removeItem: k => store.delete(k),
  }
}

installStorage()
const { addDrillCards, makeFlashCard } = await import('./drills.jsx')

const CARDS_KEY = 'coryat-flashcards-v1'
const seed = cards => localStorage.setItem(CARDS_KEY, JSON.stringify(cards))
const stored = () => JSON.parse(localStorage.getItem(CARDS_KEY) || '[]')

const card = (front, extra = {}) => ({ id: front, front, back: `back:${front}`, ...extra })
const bigImage = 'data:image/svg+xml;base64,' + 'A'.repeat(4000)

beforeEach(() => { installStorage(); seed([]) })

describe('adding cards', () => {
  it('saves them and tells the app', () => {
    const setCards = vi.fn()
    const result = addDrillCards([card('Peru'), card('Chile')], setCards)

    expect(result).toMatchObject({ added: 2, skipped: 0, imagesDropped: false, failed: false })
    expect(stored().map(c => c.front)).toEqual(['Peru', 'Chile'])
    expect(setCards).toHaveBeenCalledOnce()
    expect(setCards.mock.calls[0][0].map(c => c.front)).toEqual(['Peru', 'Chile'])
  })

  it('appends rather than replacing what is already there', () => {
    seed([card('Existing')])
    addDrillCards([card('Peru')], vi.fn())
    expect(stored().map(c => c.front)).toEqual(['Existing', 'Peru'])
  })

  it('skips fronts already in the deck', () => {
    seed([card('Peru')])
    const result = addDrillCards([card('Peru'), card('Chile')], vi.fn())

    expect(result).toMatchObject({ added: 1, skipped: 1 })
    expect(stored().map(c => c.front)).toEqual(['Peru', 'Chile'])
  })

  it('writes nothing when every candidate is a duplicate', () => {
    seed([card('Peru')])
    const setCards = vi.fn()
    const result = addDrillCards([card('Peru')], setCards)

    expect(result).toMatchObject({ added: 0, skipped: 1, failed: false })
    expect(setCards).not.toHaveBeenCalled()
  })

  // Reads storage fresh on every call rather than trusting a cards prop, so a drill
  // can't clobber edits made elsewhere in the app since it mounted.
  it('reads the current deck rather than a stale copy', () => {
    seed([card('Added elsewhere')])
    addDrillCards([card('Peru')], vi.fn())
    expect(stored().map(c => c.front)).toEqual(['Added elsewhere', 'Peru'])
  })
})

describe('running out of storage', () => {
  it('drops the map images and retries rather than losing the cards', () => {
    const setCards = vi.fn()
    seed([])
    // Room for the cards, but not for the images they carry.
    quotaAfterBytes = 2000

    const result = addDrillCards([card('Peru', { image: bigImage })], setCards)

    expect(result).toMatchObject({ added: 1, imagesDropped: true, failed: false })
    expect(stored()).toHaveLength(1)
    expect(stored()[0].image).toBeUndefined()
    expect(stored()[0].front).toBe('Peru')
    expect(setCards).toHaveBeenCalledOnce()
  })

  it('reports failure instead of claiming success when nothing can be saved', () => {
    const setCards = vi.fn()
    seed([])
    quotaAfterBytes = 10 // no room for anything

    const result = addDrillCards([card('Peru')], setCards)

    // The bug this guards: saveCards stopped throwing and started returning false, so
    // the old try/catch never fired — a failed write was announced as "Added 1 card".
    expect(result.failed).toBe(true)
    expect(result.added).toBe(0)
    expect(setCards).not.toHaveBeenCalled()
    expect(stored()).toEqual([])
  })

  it('does not bother retrying when there were no images to drop', () => {
    seed([])
    quotaAfterBytes = 10
    const result = addDrillCards([card('Peru')], vi.fn())
    expect(result).toMatchObject({ failed: true, imagesDropped: false })
  })
})


describe('cards the drills create', () => {
  it('looks new to the scheduler, not already learned', () => {
    const c = makeFlashCard('Peru', 'Lima', 'Geography')
    // interval was 1, and seedFsrsState reads `interval > 0` as evidence the card has
    // been studied — so a card you had never seen started in Review with a day of
    // stability instead of getting the new-card curve.
    expect(c.interval).toBe(0)
    expect(c.repetitions).toBe(0)

    const seeded = seedFsrsState(c)
    expect(seeded.fsrsState).toBe(State.New)
    expect(seeded.stability).toBe(0)
    expect(seeded.difficulty).toBe(0)
  })

  it('schedules identically to a card made anywhere else in the app', () => {
    expect(days(rateCard(makeFlashCard('Peru', 'Lima'), 2)))
      .toBe(days(rateCard(newCard('Peru', 'Lima'), 2)))
  })

  it('says where it came from, so the study screen stops calling it Manual', () => {
    expect(makeFlashCard('Peru', 'Lima').source).toBe('drill')
  })
})
