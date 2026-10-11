import { describe, it, expect, beforeEach, vi } from 'vitest'

// A one-row stand-in for the user_data table, enough to exercise the write paths.
const db = vi.hoisted(() => {
  const state = { row: null, session: { user: { id: 'u1' } }, failLookup: false }
  const pick = (row, cols) => Object.fromEntries(String(cols).split(',').map(c => c.trim()).map(c => [c, row[c]]))
  function run(q) {
    const read = (row, c) => {
      if (!c.includes('->>')) return row[c]
      const [col, key] = c.split('->>')
      const v = row[col]?.[key]
      return v == null ? null : String(v)
    }
    const matches = !!state.row && q.filters.every(([c, v]) => read(state.row, c) === v)
    if (q.op === 'select') {
      if (state.failLookup) return { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }
      if (q.single) return matches ? { data: pick(state.row, q.cols), error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }
      return { data: matches ? pick(state.row, q.cols) : null, error: null }
    }
    if (q.op === 'update') {
      if (!matches) return { data: [], error: null }
      state.row = { ...state.row, ...q.payload }
      return { data: [{ updated_at: state.row.updated_at }], error: null }
    }
    state.row = { ...q.payload }
    return { data: [{ updated_at: state.row.updated_at }], error: null }
  }
  function from() {
    const q = { op: 'select', filters: [] }
    const api = {
      select(cols) { if (q.op === 'select') q.cols = cols; return api },
      eq(col, val) { q.filters.push([col, val]); return api },
      update(p) { q.op = 'update'; q.payload = p; return api },
      insert(p) { q.op = 'insert'; q.payload = p; return api },
      single() { q.single = true; return api },
      maybeSingle() { return api },
      then(resolve, reject) { return Promise.resolve(run(q)).then(resolve, reject) },
    }
    return api
  }
  return { state, from }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: db.state.session }, error: null }) },
    from: db.from,
  }),
  navigatorLock: vi.fn(),
  NavigatorLockAcquireTimeoutError: class extends Error {},
}))

const { saveRemoteData, loadRemoteStamp, loadGameDoc, saveGameDoc } = await import('./supabase.js')

beforeEach(() => {
  db.state.row = { id: 1, user_id: 'u1', cards: ['server copy'], updated_at: 'T1' }
  db.state.session = { user: { id: 'u1' } }
  db.state.failLookup = false
})

describe('saveRemoteData', () => {
  it('writes when the server copy is the one this device last saw, and returns the new stamp', async () => {
    const stamp = await saveRemoteData(['mine'], [], null, null, { expectedUpdatedAt: 'T1' })
    expect(db.state.row.cards).toEqual(['mine'])
    expect(stamp).toBe(db.state.row.updated_at)
    expect(stamp).not.toBe('T1')
  })

  it('refuses to overwrite a copy another device saved since, and leaves it intact', async () => {
    db.state.row.updated_at = 'T2' // the phone uploaded after this device last synced
    await expect(saveRemoteData(['stale laptop deck'], [], null, null, { expectedUpdatedAt: 'T1' }))
      .rejects.toMatchObject({ conflict: true })
    expect(db.state.row.cards).toEqual(['server copy'])
  })

  it('does not treat a failed lookup as a missing row', async () => {
    db.state.failLookup = true
    await expect(saveRemoteData(['mine'], [])).rejects.toMatchObject({ message: 'TypeError: Failed to fetch' })
    expect(db.state.row.cards).toEqual(['server copy']) // and nothing was inserted over it
  })

  it('reports a dead session instead of quietly skipping the upload', async () => {
    db.state.session = null
    await expect(saveRemoteData(['mine'], [])).rejects.toMatchObject({ auth: true })
  })

  it('creates the row on first sync', async () => {
    db.state.row = null
    const stamp = await saveRemoteData(['first'], [])
    expect(db.state.row).toMatchObject({ user_id: 'u1', cards: ['first'] })
    expect(stamp).toBe(db.state.row.updated_at)
  })
})

describe('loadRemoteStamp', () => {
  it('reads updated_at alone', async () => {
    expect(await loadRemoteStamp()).toBe('T1')
  })
})

describe('saveGameDoc — the list of unfinished games', () => {
  const doc = games => ({ games, removed: {} })

  it('writes when nobody else has since, bumping rev', async () => {
    db.state.row.game_state = { games: {}, removed: {}, rev: 3 }
    expect(await saveGameDoc(doc({ A: { tag: 'mine' } }), 3)).toBe(4)
    expect(db.state.row.game_state).toMatchObject({ rev: 4, games: { A: { tag: 'mine' } } })
  })

  it('refuses to overwrite a list another device changed, and leaves it intact', async () => {
    db.state.row.game_state = { games: { B: { tag: 'phone' } }, removed: {}, rev: 5 }
    await expect(saveGameDoc(doc({ A: {} }), 4)).rejects.toMatchObject({ conflict: true })
    expect(db.state.row.game_state.games).toEqual({ B: { tag: 'phone' } })
  })

  it('converts the single-game shape older versions wrote', async () => {
    db.state.row.game_state = { episodeMeta: { episodeId: '9552' }, savedAt: 'x' }
    const read = await loadGameDoc()
    expect(Object.keys(read.games)).toEqual(['9552'])
    expect(read.rev).toBe(0)
    expect(await saveGameDoc(doc(read.games), read.rev)).toBe(1)
    expect(db.state.row.game_state.rev).toBe(1)
  })

  it('creates the row for an account that has none yet', async () => {
    db.state.row = null
    expect(await saveGameDoc(doc({ A: {} }), 0)).toBe(1)
    expect(db.state.row).toMatchObject({ user_id: 'u1', cards: [], game_state: { rev: 1 } })
  })
})
