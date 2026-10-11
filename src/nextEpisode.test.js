import { describe, it, expect, vi } from 'vitest'
import { seasonForAirDate, findNextEpisode } from './nextEpisode.js'

// Season lists come back newest-first, each episode tagged with its season.
const season = (n, ids) => ids.map(id => ({ gameId: String(id), airDate: `ep-${id}`, season: String(n) })).reverse()
const S42 = season(42, [400, 401, 402, 403]) // current season, 403 newest
const S41 = season(41, [300, 301, 302])
const S40 = season(40, [200, 201])
const lists = { 40: S40, 41: S41, 42: S42 }
const fetchSeason = vi.fn(async n => lists[n] || [])
const at = r => r && r.episodes[r.index].gameId

describe('seasonForAirDate', () => {
  it('maps September–July onto the season that starts that September', () => {
    expect(seasonForAirDate('2025-09-08')).toBe(42)
    expect(seasonForAirDate('2026-06-03')).toBe(42)
    expect(seasonForAirDate('Friday, April 24, 2026')).toBe(42)
    expect(seasonForAirDate('1984-09-10')).toBe(1)
  })
  it('returns null for something that isn\'t a date', () => {
    expect(seasonForAirDate('not a date')).toBeNull()
  })
})

describe('findNextEpisode', () => {
  it('finds the next show within the current season', async () => {
    expect(at(await findNextEpisode({ gameId: '401' }, S42, fetchSeason))).toBe('402')
  })

  it('returns null after the newest show of all, so the caller loads the latest', async () => {
    expect(await findNextEpisode({ gameId: '403' }, S42, fetchSeason)).toBeNull()
  })

  it('finds the next show in an older season — the case that used to fall back to latest', async () => {
    const r = await findNextEpisode({ gameId: '300', airDate: '2025-03-01' }, S42, fetchSeason) // season 41
    expect(at(r)).toBe('301')
    expect(r.episodes).toBe(S41)
  })

  it('carries over from the end of one season into the start of the next', async () => {
    expect(at(await findNextEpisode({ gameId: '201', airDate: '2024-05-01' }, S42, fetchSeason))).toBe('300')
  })

  it('carries over into the current season without refetching it', async () => {
    fetchSeason.mockClear()
    expect(at(await findNextEpisode({ gameId: '302', airDate: '2025-05-01' }, S42, fetchSeason))).toBe('400')
    expect(fetchSeason).not.toHaveBeenCalledWith(42)
  })

  it('gives up cleanly when the game can\'t be placed', async () => {
    expect(await findNextEpisode({ gameId: '999', airDate: '2025-03-01' }, S42, fetchSeason)).toBeNull()
    expect(await findNextEpisode(null, S42, fetchSeason)).toBeNull()
  })
})
