import { createClient, navigatorLock, NavigatorLockAcquireTimeoutError } from '@supabase/supabase-js'
import { normalizeGameDoc } from './savedGames.js'

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

// The signed-in account, from the local session. This used getUser(), which is a network
// call — and when it failed, the result looked exactly like "nobody signed in", so the
// callers quietly did nothing: a push returned as though it had succeeded, and the login
// load handed the merge an empty remote copy. Fail loudly instead, so it reaches the banner.
async function requireUserId() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const id = data?.session?.user?.id
  if (!id) throw Object.assign(new Error('Signed out — sign in again to keep syncing'), { auth: true })
  return id
}

export async function loadRemoteData() {
  // Scope the read explicitly rather than relying on row-level security alone. If RLS
  // is ever disabled or altered during a migration, or a second row appears for the
  // account, .single() would otherwise error or return the wrong row.
  const userId = await requireUserId()

  const { data, error } = await supabase
    .from('user_data')
    .select('*')
    .eq('user_id', userId)
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

/** The server copy's updated_at, without downloading the deck. */
export async function loadRemoteStamp() {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('user_data')
    .select('updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data?.updated_at ?? null
}

/**
 * Write the deck and history, returning the row's new updated_at.
 *
 * With expectedUpdatedAt the write only lands if the server copy is still the one this
 * device last saw. Otherwise another device has saved since, and blindly overwriting would
 * erase its work — which is how a laptop left open during a phone session wiped the phone's
 * ratings when it next saved. That case throws { conflict: true }, so the caller can merge
 * the newer copy in and try again.
 */
export async function saveRemoteData(cards, gameHistory, dailyStats = null, tombstones = null, { expectedUpdatedAt = null } = {}) {
  const userId = await requireUserId()

  const { data: existing, error: lookupError } = await supabase
    .from('user_data')
    .select('id')
    .eq('user_id', userId)
    .single()
  // PGRST116 is "no row yet". Anything else is a failed lookup, not an absent row — falling
  // through to the insert on a dropped connection would try to create a second row.
  if (lookupError && lookupError.code !== 'PGRST116') throw lookupError

  const row = { cards, game_history: gameHistory, ...(dailyStats ? { daily_stats: dailyStats } : {}), ...(tombstones ? { tombstones } : {}), updated_at: new Date().toISOString() }

  if (existing) {
    let query = supabase.from('user_data').update(row).eq('user_id', userId)
    if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt)
    // Ask for updated_at back only: a bare select() would download the whole deck.
    const { data, error } = await query.select('updated_at')
    if (error) {
      // The tombstones column may not exist yet; keep syncing everything else
      // rather than failing the whole save.
      if (tombstones && /tombstones/i.test(error.message || '')) {
        console.warn('[sync] tombstones column missing — run the migration SQL; syncing without it')
        return saveRemoteData(cards, gameHistory, dailyStats, null, { expectedUpdatedAt })
      }
      throw error
    }
    if (!data?.length) throw Object.assign(new Error('Another device saved first'), { conflict: true })
    return data[0].updated_at
  }

  const { data, error } = await supabase.from('user_data').insert({ user_id: userId, ...row }).select('updated_at')
  if (error) throw error
  return data?.[0]?.updated_at ?? row.updated_at
}

/**
 * When a card was last altered, as far as we can tell.
 *
 * lastReviewed covers ratings, which is most changes. modifiedAt is stamped by the
 * paths that change a card without reviewing it — an edit, a suspend, a release, a
 * schedule reset — because those leave lastReviewed untouched or clear it outright.
 * createdAt is the floor, so a brand-new card that has never been touched still has a
 * usable stamp.
 */
export function changedAt(card) {
  return Math.max(card?.modifiedAt || 0, card?.lastReviewed || 0, card?.createdAt || 0)
}

/**
 * Fold another copy of the deck (localStorage, written by a drill or another tab) into
 * the one in memory, never letting an older copy of a card replace a newer one.
 *
 * Ties keep the in-memory copy, and when nothing changes the original array comes back,
 * so an ordinary window focus doesn't re-render the app or queue a full-deck push.
 */
export function reconcileCards(mine, theirs, tombstones = []) {
  const tombs = new Map(tombstones.filter(t => t?.id).map(t => [t.id, t.deletedAt || 0]))
  const buried = c => tombs.has(c.id) && (c.createdAt || 0) <= tombs.get(c.id)

  let changed = false
  const byId = new Map()
  for (const c of mine) {
    if (buried(c)) { changed = true; continue }
    byId.set(c.id, c)
  }
  for (const c of theirs) {
    if (buried(c)) continue
    const current = byId.get(c.id)
    if (!current || changedAt(c) > changedAt(current)) {
      byId.set(c.id, c)
      changed = true
    }
  }
  return changed ? [...byId.values()] : mine
}

/** Add the games another copy has that this one lacks. Returns `mine` when there are none. */
export function reconcileGames(mine, theirs) {
  const have = new Set(mine.map(g => g.id))
  const added = theirs.filter(g => !have.has(g.id))
  if (!added.length) return mine
  return [...mine, ...added].sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt))
}

const TOMBSTONE_LIMIT = 1000

/** Union of two tombstone lists, newest deletion per id, bounded. */
export function mergeTombstones(a = [], b = []) {
  const tombMap = new Map()
  for (const t of [...(b || []), ...(a || [])]) {
    if (!t?.id) continue
    const prev = tombMap.get(t.id)
    if (!prev || (t.deletedAt || 0) > (prev.deletedAt || 0)) tombMap.set(t.id, t)
  }
  // Keep the list bounded; the newest deletions are the ones that still need to
  // propagate to other devices.
  return [...tombMap.values()]
    .sort((x, y) => (y.deletedAt || 0) - (x.deletedAt || 0))
    .slice(0, TOMBSTONE_LIMIT)
}

export function mergeData(local, remote) {
  // Deletions are recorded explicitly. Previously a card missing from remote and
  // created before the last sync was assumed deleted — but that is also exactly what
  // a failed upload looks like, so any card that never made it up was destroyed on
  // the next login. Absence is no longer evidence of deletion; only a tombstone is.
  const tombstones = mergeTombstones(local.tombstones, remote.tombstones)
  const tombMap = new Map(tombstones.map(t => [t.id, t]))

  // Union by id, keeping whichever copy changed most recently.
  //
  // Remote used to win unconditionally, which quietly threw away work. The deck is
  // pushed on a 20-second debounce, so at any moment the newest reviews exist only on
  // this device — and the merge does not just run at login, it runs whenever the auth
  // state changes, including the token refresh that happens roughly hourly. Study
  // through one of those and every rating since the last successful push was reverted:
  // the cards went back to being due, and turned up again in the next session.
  const byId = new Map()
  for (const c of local.cards) byId.set(c.id, c)
  for (const c of remote.cards) {
    const mine = byId.get(c.id)
    // Ties go to remote: it is the shared copy, and preferring it keeps the old
    // behaviour for cards neither side has touched since they last agreed.
    if (!mine || changedAt(c) >= changedAt(mine)) byId.set(c.id, c)
  }

  const cards = [...byId.values()].filter(c => {
    const tomb = tombMap.get(c.id)
    if (!tomb) return true
    // A card created after its own tombstone was deliberately re-added.
    return (c.createdAt || 0) > (tomb.deletedAt || 0)
  })

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

// ── Unfinished games (game_state column) ─────────────────────────────────────
// game_state holds every unfinished game (see savedGames.js) plus a `rev` counter. Writes are
// conditional on rev, the same idea as updated_at for the deck: two devices each writing
// their own copy of the list would otherwise erase each other's games.
//
// Deliberately leaves updated_at alone. That column means "when the deck and game history
// last changed"; an in-progress board is scratch state saved every few seconds.

export async function loadGameDoc() {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('user_data')
    .select('game_state')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return normalizeGameDoc(data?.game_state)
}

/** Write the list, returning the new rev. Throws { conflict: true } if someone else wrote since expectedRev. */
export async function saveGameDoc(doc, expectedRev = 0) {
  const userId = await requireUserId()
  const next = { games: doc.games, removed: doc.removed, rev: (expectedRev || 0) + 1 }
  let query = supabase.from('user_data').update({ game_state: next }).eq('user_id', userId)
  // rev 0 covers an empty column and the single-game shape older versions wrote; neither has
  // a rev to compare, so that first write converts it unconditionally.
  if (expectedRev) query = query.eq('game_state->>rev', String(expectedRev))
  const { data, error } = await query.select('user_id')
  if (error) throw error
  if (data?.length) return next.rev
  if (expectedRev) throw Object.assign(new Error('Another device saved its games first'), { conflict: true })
  // No row yet for this account.
  const { error: insertError } = await supabase.from('user_data').insert({ user_id: userId, cards: [], game_history: [], game_state: next })
  if (insertError) throw insertError
  return next.rev
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
