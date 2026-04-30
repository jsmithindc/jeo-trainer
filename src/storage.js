const CARDS_KEY = 'coryat-flashcards-v1'
const GAMES_KEY = 'coryat-games-v1'

export function loadCards() {
  try {
    const raw = localStorage.getItem(CARDS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveCards(cards) {
  try {
    localStorage.setItem(CARDS_KEY, JSON.stringify(cards))
  } catch (e) {
    console.warn('Could not save cards:', e)
  }
}

export function loadGames() {
  try {
    const raw = localStorage.getItem(GAMES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveGames(games) {
  try {
    localStorage.setItem(GAMES_KEY, JSON.stringify(games))
  } catch (e) {
    console.warn('Could not save games:', e)
  }
}
