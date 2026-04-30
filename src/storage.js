const CARDS_KEY = 'coryat-flashcards-v1'
const GAMES_KEY = 'coryat-games-v1'

export function loadCards() {
  try { return JSON.parse(localStorage.getItem(CARDS_KEY) || '[]') } catch { return [] }
}
export function saveCards(cards) {
  try { localStorage.setItem(CARDS_KEY, JSON.stringify(cards)) } catch {}
}
export function loadGameHistory() {
  try { return JSON.parse(localStorage.getItem(GAMES_KEY) || '[]') } catch { return [] }
}
export function saveGameHistory(games) {
  try { localStorage.setItem(GAMES_KEY, JSON.stringify(games)) } catch {}
}
