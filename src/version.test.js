import { describe, it, expect } from 'vitest'
import { formatVersion, APP_VERSION, DISPLAY_VERSION } from './version.js'

describe('formatVersion', () => {
  it('puts the padding back that semver would not allow', () => {
    expect(formatVersion('2026.902.1')).toBe('2026.09.02')
    expect(formatVersion('2026.105.1')).toBe('2026.01.05')
  })

  it('leaves a two-digit month and day alone', () => {
    expect(formatVersion('2026.1231.3')).toBe('2026.12.31')
    expect(formatVersion('2026.1001.1')).toBe('2026.10.01')
  })

  it('ignores the release counter — two builds on one day read as the same date', () => {
    expect(formatVersion('2026.902.1')).toBe(formatVersion('2026.902.7'))
  })

  it('falls back to the raw string for the semver releases before the switch', () => {
    // A stale service worker can still be serving one of these.
    expect(formatVersion('2.9.0')).toBe('2.9.0')
    expect(formatVersion('2.6.5')).toBe('2.6.5')
  })

  it('falls back rather than inventing a date from nonsense', () => {
    expect(formatVersion('2026.1350.1')).toBe('2026.1350.1') // month 13
    expect(formatVersion('2026.932.1')).toBe('2026.932.1')   // day 32
    expect(formatVersion('not-a-version')).toBe('not-a-version')
    expect(formatVersion('')).toBe('')
    expect(formatVersion(null)).toBe('')
  })

  it('formats the app\'s own version when called with nothing', () => {
    // The default parameter is the point of the function's no-arg form, so undefined
    // means "the version we shipped", not "bad input".
    expect(formatVersion()).toBe(DISPLAY_VERSION)
    expect(formatVersion(undefined)).toBe(DISPLAY_VERSION)
  })
})

describe('the shipped version', () => {
  it('is CalVer, so deploy.sh can parse and bump it', () => {
    expect(APP_VERSION).toMatch(/^\d{4}\.\d{1,4}\.\d+$/)
  })

  it('renders as a date on the badge', () => {
    expect(DISPLAY_VERSION).toMatch(/^\d{4}\.\d{2}\.\d{2}$/)
  })

  // npm rejects a version with leading zeroes in any numeric identifier, and the whole
  // reason the date is written MMDD rather than MM.DD is to avoid exactly that.
  it('has no leading zeroes, so it stays valid semver', () => {
    for (const part of APP_VERSION.split('.')) {
      expect(part).not.toMatch(/^0\d/)
    }
  })
})
