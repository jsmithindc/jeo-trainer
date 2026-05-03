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
    .select('cards, game_history, updated_at')
    .single()

  if (error) {
    if (error.code === 'PGRST116') return { cards: [], gameHistory: [], updatedAt: null }
    throw error
  }

  return {
    cards: data.cards || [],
    gameHistory: data.game_history || [],
    updatedAt: data.updated_at || null,
  }
}

export async function saveRemoteData(cards, gameHistory) {
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
      .update({ cards, game_history: gameHistory, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('user_data')
      .insert({ user_id: user.id, cards, game_history: gameHistory, updated_at: new Date().toISOString() })
    if (error) throw error
  }
}

export function mergeData(local, remote, remoteUpdatedAt = null) {
  // Strategy: remote is authoritative for deletions.
  // We only add local cards that were created AFTER the last remote sync,
  // meaning they haven't been pushed yet. Cards deleted remotely stay deleted.

  const remoteCardIds = new Set(remote.cards.map(c => c.id))

  // Only add local cards that don't exist remotely AND were created after
  // the last remote sync (so they're genuinely new, not just deleted remotely)
  const syncCutoff = remoteUpdatedAt ? new Date(remoteUpdatedAt).getTime() : 0
  const localOnlyCards = local.cards.filter(c =>
    !remoteCardIds.has(c.id) &&
    (c.createdAt || 0) > syncCutoff
  )
  const cards = [...remote.cards, ...localOnlyCards]

  // For game history, merge by unique game ID — remote wins on conflict
  const remoteGameIds = new Set(remote.gameHistory.map(g => g.id))
  const localOnlyGames = local.gameHistory.filter(g =>
    !remoteGameIds.has(g.id) &&
    (new Date(g.playedAt).getTime() || 0) > syncCutoff
  )
  const gameHistory = [...remote.gameHistory, ...localOnlyGames]
    .sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt))

  return { cards, gameHistory }
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

  const { data, error } = await supabase.storage
    .from('media')
    .upload(path, arrayBuffer, {
      contentType: mimeType,
      upsert: true, // overwrite if exists
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
