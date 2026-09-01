import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://uramupgwxuugdcmmklds.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_qJMYyHDRF18PWU6S4nqewA_bi1SDSEM'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

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
  const { data, error } = await supabase
    .from('user_data')
    .select('*')
    .single()

  if (error) {
    if (error.code === 'PGRST116') return { cards: [], gameHistory: [], updatedAt: null }
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
      .insert({ user_id: user.id, cards, game_history: gameHistory, ...(dailyStats ? { daily_stats: dailyStats } : {}), updated_at: new Date().toISOString() })
    if (error) throw error
  }
}

const TOMBSTONE_LIMIT = 1000

export function mergeData(local, remote, remoteUpdatedAt = null) {
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

  const syncCutoff = remoteUpdatedAt ? new Date(remoteUpdatedAt).getTime() : 0

  // For game history, merge by unique game ID — remote wins on conflict
  const remoteGameIds = new Set(remote.gameHistory.map(g => g.id))
  const localOnlyGames = local.gameHistory.filter(g =>
    !remoteGameIds.has(g.id) &&
    (new Date(g.playedAt).getTime() || 0) > syncCutoff
  )
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

  const payload = {
    game_state: gameState,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    await supabase.from('user_data').update(payload).eq('user_id', user.id)
  } else {
    await supabase.from('user_data').insert({ user_id: user.id, cards: [], game_history: [], ...payload })
  }
}

export async function loadGameStateRemote() {
  const { data, error } = await supabase
    .from('user_data')
    .select('game_state')
    .single()
  if (error || !data) return null
  return data.game_state || null
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

export async function deleteMediaRemote(filename) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const path = `${user.id}/${filename}`
  await supabase.storage.from('media').remove([path])
}

export async function listMediaRemote() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase.storage
    .from('media')
    .list(user.id)

  if (error) return []
  return data || []
}

export function getMediaPublicUrl(filename, userId) {
  const { data: { publicUrl } } = supabase.storage
    .from('media')
    .getPublicUrl(`${userId}/${filename}`)
  return publicUrl
}
