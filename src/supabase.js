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
    .select('cards, game_history, daily_stats, updated_at')
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
  }
}

export async function saveRemoteData(cards, gameHistory, dailyStats = null) {
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
      .update({ cards, game_history: gameHistory, ...(dailyStats ? { daily_stats: dailyStats } : {}), updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('user_data')
      .insert({ user_id: user.id, cards, game_history: gameHistory, ...(dailyStats ? { daily_stats: dailyStats } : {}), updated_at: new Date().toISOString() })
    if (error) throw error
  }
}

export function mergeData(local, remote, remoteUpdatedAt = null) {
  // Strategy: remote is authoritative for deletions.
  // Exception: if local has significantly more cards than remote, local wins outright
  // (handles the case where remote was accidentally wiped)
  if (local.cards.length > remote.cards.length * 2 && local.cards.length > remote.cards.length + 50) {
    // Local has way more cards — treat local as authoritative, just merge in any remote-only cards
    const localIds = new Set(local.cards.map(c => c.id))
    const remoteOnlyCards = remote.cards.filter(c => !localIds.has(c.id))
    const cards = [...local.cards, ...remoteOnlyCards]
    const remoteGameIds = new Set(remote.gameHistory.map(g => g.id))
    const localGameIds = new Set(local.gameHistory.map(g => g.id))
    const gameHistory = [...local.gameHistory, ...remote.gameHistory.filter(g => !localGameIds.has(g.id))]
      .sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt))
    return { cards, gameHistory }
  }

  const remoteCardIds = new Set(remote.cards.map(c => c.id))

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
