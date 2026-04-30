import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://uramupgwxuugdcmmklds.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_qJMYyHDRF18PWU6S4nqewA_bi1SDSEM'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export async function sendMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin }
  })
  if (error) throw error
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function loadRemoteData() {
  const { data, error } = await supabase
    .from('user_data')
    .select('cards, game_history')
    .single()

  if (error) {
    if (error.code === 'PGRST116') return { cards: [], gameHistory: [] }
    throw error
  }

  return {
    cards: data.cards || [],
    gameHistory: data.game_history || [],
  }
}

export async function saveRemoteData(cards, gameHistory) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  // First check if a row exists
  const { data: existing } = await supabase
    .from('user_data')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (existing) {
    // Update existing row
    const { error } = await supabase
      .from('user_data')
      .update({
        cards,
        game_history: gameHistory,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
    if (error) throw error
  } else {
    // Insert new row
    const { error } = await supabase
      .from('user_data')
      .insert({
        user_id: user.id,
        cards,
        game_history: gameHistory,
        updated_at: new Date().toISOString(),
      })
    if (error) throw error
  }
}

export function mergeData(local, remote) {
  // Merge cards: use remote as base, add local-only cards
  const remoteCardIds = new Set(remote.cards.map(c => c.id))
  const localOnlyCards = local.cards.filter(c => !remoteCardIds.has(c.id))
  const cards = [...remote.cards, ...localOnlyCards]

  // Merge game history: dedupe by episodeId, keep all unique
  const remoteGameKeys = new Set(remote.gameHistory.map(g => `${g.episodeId}-${g.airDate}`))
  const localOnlyGames = local.gameHistory.filter(g => !remoteGameKeys.has(`${g.episodeId}-${g.airDate}`))
  const gameHistory = [...remote.gameHistory, ...localOnlyGames]
    .sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt))

  return { cards, gameHistory }
}
