import { createClient, navigatorLock, NavigatorLockAcquireTimeoutError } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://uramupgwxuugdcmmklds.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_qJMYyHDRF18PWU6S4nqewA_bi1SDSEM'

// supabase-js schedules its first auto-refresh tick from an unguarded setTimeout while
// initialising (GoTrueClient#_startAutoRefresh). That tick asks for the auth lock with
// acquireTimeout 0 — meaning "skip if another context is already using it" — but the
// library throws instead of returning, and nothing catches it. A deliberately skipped
// refresh therefore surfaces as an uncaught promise rejection on every page load:
//
//   Uncaught (in promise) Error: Acquiring an exclusive Navigator LockManager lock
//   "lock:sb-…-auth-token" immediately failed
//
// Still present in 2.112.4, so turn that one case back into the no-op it was meant to
// be. Every other lock failure still propagates, and the next tick refreshes normally.
// Catching the rejection was not enough. Firefox reports the promise created *inside*
// navigator.locks.request, which no application handler ever sees — the wrapper caught
// it and preventDefault() ran, and the console printed it anyway.
//
// So don't let the library reach its throw. acquireTimeout 0 means "skip if busy", and
// it is the only path that produces this message, so handle that case directly: ask for
// the lock with ifAvailable and return quietly when it isn't free. Every other timeout
// still goes through the library's own implementation.
async function quietNavigatorLock(name, acquireTimeout, fn) {
  if (acquireTimeout === 0) {
    return globalThis.navigator.locks.request(
      name,
      { mode: 'exclusive', ifAvailable: true },
      async lock => (lock ? await fn() : undefined),
    )
  }

  try {
    return await navigatorLock(name, acquireTimeout, fn)
  } catch (err) {
    // Belt and braces for any other acquire-timeout path.
    if (err instanceof NavigatorLockAcquireTimeoutError || err?.isAcquireTimeout === true) return undefined
    throw err
  }
}

// The wrapper above should be enough, but the rejection was still reaching the console
// after it shipped, and a minified async stack was not enough to prove which branch let
// it through. This catches it wherever it originates.
//
// Deliberately narrow: it matches only this one benign message — a token refresh that
// declined to wait for a lock another context already held — and every other rejection
// is left completely untouched so real failures still surface.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('unhandledrejection', event => {
    const message = event?.reason?.message
    if (typeof message === 'string' &&
        message.includes('Navigator LockManager lock') &&
        message.includes('immediately failed')) {
      event.preventDefault()
    }
  })
}

// Only override where the Web Locks API actually exists; elsewhere supabase-js picks
// its own fallback and navigatorLock would throw on a missing navigator.locks.
const supportsWebLocks = typeof globalThis !== 'undefined' && !!globalThis.navigator?.locks

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  supportsWebLocks ? { auth: { lock: quietNavigatorLock } } : undefined,
)

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return data
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  })
  if (error) throw error
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// ── Data sync ─────────────────────────────────────────────────────────────────

export async function loadRemoteData() {
  // Scope the read explicitly rather than relying on row-level security alone. If RLS
  // is ever disabled or altered during a migration, or a second row appears for the
  // account, .single() would otherwise error or return the wrong row.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { cards: [], gameHistory: [], updatedAt: null, tombstones: [] }

  const { data, error } = await supabase
    .from('user_data')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return { cards: [], gameHistory: [], updatedAt: null, tombstones: [] }
    throw error
  }

  return {
    cards: data.cards || [],
    gameHistory: data.game_history || [],
    updatedAt: data.updated_at || null,
    dailyStats: data.daily_stats || null,
    // Absent until the tombstones column is added; treated as "no known deletions",
    // which is the safe direction — it keeps cards rather than removing them.
    tombstones: data.tombstones || [],
  }
}

export async function saveRemoteData(cards, gameHistory, dailyStats = null, tombstones = null) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: existing } = await supabase
    .from('user_data')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (existing) {
    const { error } = await supabase
      .from('user_data')
      .update({ cards, game_history: gameHistory, ...(dailyStats ? { daily_stats: dailyStats } : {}), ...(tombstones ? { tombstones } : {}), updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
    if (error) {
      // The tombstones column may not exist yet; keep syncing everything else
      // rather than failing the whole save.
      if (tombstones && /tombstones/i.test(error.message || '')) {
        console.warn('[sync] tombstones column missing — run the migration SQL; syncing without it')
        return saveRemoteData(cards, gameHistory, dailyStats, null)
      }
      throw error
    }
  } else {
    const { error } = await supabase
      .from('user_data')
      .insert({ user_id: user.id, cards, game_history: gameHistory, ...(dailyStats ? { daily_stats: dailyStats } : {}), ...(tombstones ? { tombstones } : {}), updated_at: new Date().toISOString() })
    if (error) throw error
  }
}

const TOMBSTONE_LIMIT = 1000

export function mergeData(local, remote) {
  // Deletions are recorded explicitly. Previously a card missing from remote and
  // created before the last sync was assumed deleted — but that is also exactly what
  // a failed upload looks like, so any card that never made it up was destroyed on
  // the next login. Absence is no longer evidence of deletion; only a tombstone is.
  const tombMap = new Map()
  for (const t of [...(remote.tombstones || []), ...(local.tombstones || [])]) {
    if (!t?.id) continue
    const prev = tombMap.get(t.id)
    if (!prev || (t.deletedAt || 0) > (prev.deletedAt || 0)) tombMap.set(t.id, t)
  }

  // Union by id; remote wins where both sides hold the same card.
  const byId = new Map()
  for (const c of local.cards) byId.set(c.id, c)
  for (const c of remote.cards) byId.set(c.id, c)

  const cards = [...byId.values()].filter(c => {
    const tomb = tombMap.get(c.id)
    if (!tomb) return true
    // A card created after its own tombstone was deliberately re-added.
    return (c.createdAt || 0) > (tomb.deletedAt || 0)
  })

  // Keep the tombstone list bounded; the newest deletions are the ones that still
  // need to propagate to other devices.
  const tombstones = [...tombMap.values()]
    .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
    .slice(0, TOMBSTONE_LIMIT)

  // Game history merges by id, remote winning on conflict. Local-only games are always
  // kept: a game missing from remote is an upload that never landed, never a deletion,
  // because nothing in the app can delete a game.
  //
  // This used to keep a local-only game only if it was played after remote.updated_at,
  // which destroyed exactly the games that most needed rescuing. The timestamp moved for
  // reasons that had nothing to do with game history — saveGameStateRemote wrote it every
  // 30 seconds of board play — so one game finished offline and a second played online
  // was enough to push the cutoff past the first game and delete it on the next login.
  const remoteGameIds = new Set(remote.gameHistory.map(g => g.id))
  const localOnlyGames = local.gameHistory.filter(g => !remoteGameIds.has(g.id))
  const gameHistory = [...remote.gameHistory, ...localOnlyGames]
    .sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt))

  return { cards, gameHistory, tombstones }
}

// ── Game state sync (in-progress games) ──────────────────────────────────────
export async function saveGameStateRemote(gameState) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: existing } = await supabase
    .from('user_data')
    .select('id')
    .eq('user_id', user.id)
    .single()

  // Deliberately does not touch updated_at. That column means "when the deck and game
  // history last changed", and the merge and any future write-conflict check read it
  // that way. An in-progress board is scratch state, saved every 30 seconds; letting it
  // move the timestamp made the column mean "last touched", which is a different claim.
  const payload = { game_state: gameState }

  if (existing) {
    await supabase.from('user_data').update(payload).eq('user_id', user.id)
  } else {
    await supabase.from('user_data').insert({ user_id: user.id, cards: [], game_history: [], ...payload })
  }
}

// Scoped to the signed-in user like every other read here. It was the one query that
// leaned on row-level security alone — and it was also never called, so the game state
// being written every 30 seconds of play had nothing reading it back.
export async function loadGameStateRemote() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('user_data')
    .select('game_state')
    .eq('user_id', user.id)
    .single()
  if (error || !data) return null
  return data.game_state || null
}

/**
 * Drop the remote in-progress game.
 *
 * Without this the column would keep the last unfinished board for ever: clearGameState()
 * only touches localStorage, so a game finished on one device would go on being offered
 * as resumable on every other one.
 */
export async function clearGameStateRemote() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('user_data').update({ game_state: null }).eq('user_id', user.id)
}

// ── Media storage (Supabase Storage bucket) ───────────────────────────────────

export async function uploadMedia(filename, arrayBuffer, mimeType) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Store under user's folder: {userId}/{filename}
  const path = `${user.id}/${filename}`

  // Supabase Storage requires a Blob or File, not a raw ArrayBuffer
  const blob = new Blob([arrayBuffer], { type: mimeType })

  const { data, error } = await supabase.storage
    .from('media')
    .upload(path, blob, {
      contentType: mimeType,
      upsert: true,
    })

  if (error) throw error

  // Return public URL
  const { data: { publicUrl } } = supabase.storage
    .from('media')
    .getPublicUrl(path)

  return publicUrl
}

// deleteMediaRemote / listMediaRemote / getMediaPublicUrl lived here and were never
// called from anywhere. Their absence is a real gap, not just dead weight: media uploaded
// with an Anki deck is never removed, and "Clear" in the deck view only empties IndexedDB,
// so the Supabase bucket grows and never shrinks. Deleting them makes that visible rather
// than leaving code that looks like it handles the problem.
