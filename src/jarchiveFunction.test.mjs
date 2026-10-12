import { describe, it, expect, vi, afterEach } from 'vitest'
// Lives in src/, not beside the function: Netlify treats every file in
// netlify/functions/ as a deployable endpoint, so a test file there would ship
// as a function that imports vitest.
import { probeForward, parseFinalJeopardy } from '../netlify/functions/jarchive.mjs'
import { parse } from 'node-html-parser'

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

describe('parseFinalJeopardy', () => {
  // Shaped like game 9539's markup, down to the mismatched tag in a contestant's response.
  const page = (response = 'Who is... M<u>ilton</i>?') => `<html><body><div id="content">
    <div id="double_jeopardy_round"><p>dj</p></div>
    <div id="final_jeopardy_round"><table class="final_round"><tr><td class="category"><div><table>
      <tr><td class="category_name">17th CENTURY AUTHORS</td></tr></table></div></td></tr>
      <tr><td class="clue"><table><tr>
        <td id="clue_FJ" class="clue_text">A Mayo Clinic study regarding this poet&#39;s health afflictions</td>
        <td id="clue_FJ_r" class="clue_text" style="display:none;">(Ken: That is correct.)<table><tr>
          <td class="right">Greg</td><td>${response}</td></tr></table><em class="correct_response">John <i>Milton</i></em></td>
      </tr></table></td></tr></table></div></div></body></html>`
  const expected = {
    category: '17th CENTURY AUTHORS',
    clue: "A Mayo Clinic study regarding this poet's health afflictions",
    answer: 'John Milton',
  }

  it('recovers Final Jeopardy when a broken tag makes the parser drop the round', () => {
    const html = page()
    expect(parse(html).querySelector('#final_jeopardy_round')).toBeNull() // the failure being worked around
    expect(parseFinalJeopardy(parse(html), html)).toEqual(expected)
  })

  it('reads well-formed pages from the DOM as before', () => {
    const html = page('Who is Milton?')
    expect(parseFinalJeopardy(parse(html), html)).toEqual(expected)
  })

  it('returns null when the page has no Final Jeopardy yet', () => {
    const html = '<html><body><div id="double_jeopardy_round"></div></body></html>'
    expect(parseFinalJeopardy(parse(html), html)).toBeNull()
  })
})
