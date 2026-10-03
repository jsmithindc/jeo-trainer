import { describe, it, expect } from 'vitest'
import { describeSyncError } from './syncStatus.js'

describe('describeSyncError', () => {
  it('reads each browser\'s dropped-connection error as offline, not fatal', () => {
    for (const message of [
      'TypeError: NetworkError when attempting to fetch resource.',
      'TypeError: Load failed',
      'TypeError: Failed to fetch',
    ]) {
      expect(describeSyncError({ message })).toMatchObject({ offline: true, auth: false })
    }
  })

  it('flags an expired or missing session as needing a sign-in', () => {
    expect(describeSyncError({ message: 'JWT expired' }).auth).toBe(true)
    expect(describeSyncError({ message: 'Invalid Refresh Token: Already Used' }).auth).toBe(true)
    expect(describeSyncError({ message: 'x', status: 401 }).auth).toBe(true)
    expect(describeSyncError({ message: 'Signed out', auth: true }).auth).toBe(true)
  })

  it('keeps anything else as a plain error with its message', () => {
    expect(describeSyncError({ message: 'duplicate key value' })).toEqual({ raw: 'duplicate key value', auth: false, offline: false })
    expect(describeSyncError('plain string').raw).toBe('plain string')
    expect(describeSyncError(undefined).raw).toBe('Unknown sync error')
  })
})
