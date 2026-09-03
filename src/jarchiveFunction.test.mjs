import { describe, it, expect, vi, afterEach } from 'vitest'
// Lives in src/, not beside the function: Netlify treats every file in
// netlify/functions/ as a deployable endpoint, so a test file there would ship
// as a function that imports vitest.
import { probeForward } from '../netlify/functions/jarchive.mjs'

// The archive is stubbed as "every id up to `top` exists". probeForward has to return the
// same answer the old sequential loop did — the highest unbroken run past maxId — while
// issuing the requests all at once instead of one at a time.
function stubArchive(top, { failIds = new Set() } = {}) {
  const calls = []
  globalThis.fetch = vi.fn(async url => {
    const id = Number(new URL(url).searchParams.get('game_id'))
    calls.push(id)
    return { ok: id <= top && !failIds.has(id) }
  })
  return calls
}

afterEach(() => { vi.restoreAllMocks() })

describe('probeForward', () => {
  it('finds the newest episode past the season page', async () => {
    stubArchive(9475)
    expect(await probeForward(9470)).toBe(9475)
  })

  it('returns maxId when nothing newer exists', async () => {
    stubArchive(9470)
    expect(await probeForward(9470)).toBe(9470)
  })

  it('stops at the first gap, exactly as the sequential loop did', async () => {
    // 9471 and 9472 exist, 9473 is missing, 9474 exists but is unreachable behind the gap.
    stubArchive(9480, { failIds: new Set([9473]) })
    expect(await probeForward(9470)).toBe(9472)
  })

  it('issues the probes concurrently rather than one at a time', async () => {
    const calls = stubArchive(9475)
    await probeForward(9470)
    // All twenty go out; the old version made up to twenty sequential round trips.
    expect(calls).toHaveLength(20)
    expect(globalThis.fetch).toHaveBeenCalledTimes(20)
  })

  it('treats a network failure as the end of the archive, not a crash', async () => {
    globalThis.fetch = vi.fn(async url => {
      const id = Number(new URL(url).searchParams.get('game_id'))
      if (id === 9473) throw new Error('network')
      return { ok: id <= 9480 }
    })
    expect(await probeForward(9470)).toBe(9472)
  })
})
