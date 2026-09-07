// ─── Versioning ───────────────────────────────────────────────────────────────
// CalVer: YYYY.MMDD.N — the release date, plus a counter that starts at 1 each day
// and increments for a second release on the same day.
//
// The month and day are run together rather than written YYYY.MM.DD because
// package.json has to stay valid semver or npm rejects it, and semver forbids leading
// zeroes in a numeric identifier — 2026.09.02 is not a legal version, 2026.902.1 is.
// formatVersion puts the padding back for display, so the badge reads as a date.
//
// deploy.sh owns this line: it rewrites both this file and package.json from the
// current date on every deploy. Editing it by hand only risks the two disagreeing.
export const APP_VERSION = '2026.907.1'

/**
 * Render a CalVer string as a plain date: 2026.902.1 → "2026.09.02".
 *
 * Falls back to the raw string for anything that isn't CalVer, which covers the semver
 * releases from before the switch — a stale service worker can still be serving one.
 */
export function formatVersion(version = APP_VERSION) {
  const match = /^(\d{4})\.(\d{1,4})\.(\d+)$/.exec(String(version ?? ''))
  if (!match) return String(version ?? '')

  const [, year, mmdd] = match
  if (Number(year) < 2000) return version // 2.9.0 and friends: three small numbers, not a date

  const padded = mmdd.padStart(4, '0')
  const month = padded.slice(0, 2)
  const day = padded.slice(2)
  if (Number(month) < 1 || Number(month) > 12) return version
  if (Number(day) < 1 || Number(day) > 31) return version

  return `${year}.${month}.${day}`
}

/** What the badge shows. */
export const DISPLAY_VERSION = formatVersion(APP_VERSION)
