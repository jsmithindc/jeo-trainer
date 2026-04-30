import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://uramupgwxuugdcmmklds.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_qJMYyHDRF18PWU6S4nqewA_bi1SDSEM'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function sendMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin,
    }
  })
  if (error) throw error
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// ── Data sync ─────────────────────────────────────────────────────────────────

// Load user data from Supabase
export async function loadRemoteData() {
  const { data, error } = await supabase
    .from('user_data')
    .select('cards, game_history')
    .single()

  if (error) {
    // No row yet — first time user
    if (error.code === 'PGRST116') return { cards: [], gameHistory: [] }
    throw error
  }

  return {
    cards: data.cards || [],
    gameHistory: data.game_history || [],
  }
}

// Save user data to Supabase (upsert)
export async function saveRemoteData(cards, gameHistory) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { error } = await supabase
    .from('user_data')
    .upsert({
      user_id: user.id,
      cards,
      game_history: gameHistory,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (error) throw error
}

// Merge remote and local data, preferring the most recently updated card
// (by createdAt — remote wins for existing cards, local wins for new ones)
export function mergeData(local, remote) {
  const merged = { ...local }

  // Merge cards: remote wins on conflict (same id), local-only cards are kept
  const remoteCardIds = new Set(remote.cards.map(c => c.id))
  const localOnlyCards = local.cards.filter(c => !remoteCardIds.has(c.id))
  merged.cards = [...remote.cards, ...localOnlyCards]

  // Merge game history: dedupe by episodeId + round, keep all unique games
  const remoteGameKeys = new Set(remote.gameHistory.map(g => `${g.episodeId}-${g.round}`))
  const localOnlyGames = local.gameHistory.filter(g => !remoteGameKeys.has(`${g.episodeId}-${g.round}`))
  merged.gameHistory = [...remote.gameHistory, ...localOnlyGames]
    .sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt))

  return merged
}
