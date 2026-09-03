import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import { shuffled } from './shuffle.js'
import { newCard, formatRelative } from './srs.js'
import { rateCard, nextDueLabel, resetSchedule } from './fsrs.js'
import { loadCards, saveCards, loadGameHistory, saveGameHistory } from './storage.js'
import { parseApkg, migrateLocalMediaToSupabase } from './ankiImport.js'
import { SAMPLE_BOARD } from './boardData.js'
import { migrateFJWagers, backfillDdNet, migrateToFsrs } from './migrations.js'
import { buildPlayedIndex, findPlayed, normalizeAirDate } from './played.js'
import { matchesAnswer } from './fuzzy.js'
import { recallMs, suggestGrade, formatRecall, summariseRecall } from './recall.js'
import { isSuspended, shouldQuarantine, suspendCard, releaseCard, releaseRewritten, partitionByHealth, LEECH_LAPSES, QUARANTINE_LAPSES } from './leech.js'
import { saveDeckSnapshot, getDeckSnapshots, restoreSnapshot, ensureSnapshotsMigrated } from './snapshotStore.js'
import { fetchEpisode, episodeToBoard, searchEpisodesByCategory } from './jarchive.js'
import { supabase, signIn, signUp, resetPassword, signOut, loadRemoteData, saveRemoteData, mergeData, saveGameStateRemote, loadGameStateRemote, clearGameStateRemote, uploadMedia } from './supabase.js'
import { buildCategoryHeatMap, buildValueBreakdown, predictCoryat, exportToApkg, getMetaCategory, META_CATEGORY_NAMES, buildDailyDoubleStats, buildRetentionSeries, buildDeckHealth, buildStudyStreak } from './analytics.js'
import { CardContent, cardIsHtml } from './CardContent.jsx'
import { getMediaStats, clearAllMedia, getMedia } from './mediaStore.js'
import { loadGameState, saveGameState, clearGameState, loadEpisodeCache, saveEpisodeToCache, getEpisodeFromCache, pinEpisode, unpinEpisode, removeEpisodeFromCache, getCacheStats, getDailyStats, incrementDailyCards, addToTrash, getTrash, restoreFromTrash, setStorageErrorHandler, logReview, removeLastReview, getReviewLog, getTombstones, addTombstones, saveTombstones, removeTombstone } from './storage.js'
import { WeaknessTracker, SpeedTracker, WagerTrainer, TournamentSetup as TournamentSetupModal, OpponentScoreBar, OpponentCoryatResult, calcStreak, generateOpponent } from './training.jsx'
// drills.jsx pulls in the Natural Earth water-body polygons; together they are more
// than half the bundle, and none of it is needed unless the Drills tab is opened.
const DrillsView = lazy(() => import('./drills.jsx').then(m => ({ default: m.DrillsView })))

const APP_VERSION = '2.9.0'

const CLUE_STATES = { UNANSWERED: 'unanswered', CORRECT: 'correct', INCORRECT: 'incorrect', PASS: 'pass' }
const CORYAT_VAL = { correct: v => v, incorrect: v => -v, pass: () => 0, unanswered: () => 0 }

// A saved game is only worth resuming if it never reached Final Jeopardy — that is
// the point at which saveGame() records the result and the game is over.
function isResumable(state) {
  return !!(state && state.episodeMeta && !state.fjAnswered)
}

// Merge only the font overrides that are actually switched on.
//
// The board and clue modals used to inline `fontSize: largeFont && fontSettings?.size ? N
// : undefined` on top of a style that already set fontSize. Spreading `undefined` over a
// real value deletes the key — React then sets no font-size at all and the element
// inherits from its parent. With Large font off, category headers rendered at the
// inherited 16px instead of their designed 12px and tile values at 16px instead of 18px,
// so the setting's only visible effect was putting the defaults back.
function fontOverride(largeFont, fontSettings, { size, weight, lineHeight } = {}) {
  if (!largeFont) return null
  const out = {}
  if (size != null && fontSettings?.size) out.fontSize = size
  if (weight != null && fontSettings?.weight) out.fontWeight = weight
  if (lineHeight != null && fontSettings?.lineHeight) out.lineHeight = lineHeight
  return out
}

function initClueStates(board) {
  const s = {}
  board.categories.forEach((cat, ci) =>
    cat.clues.forEach((_, ri) => { s[`${ci}-${ri}`] = CLUE_STATES.UNANSWERED })
  )
  return s
}

// Per-category Coryat for one round. Two identical copies of this existed — one inside
// saveGame, one inside SummaryView — so a change to how a breakdown is scored had to be
// made twice or the saved record and the on-screen summary would disagree.
function categoryBreakdown(board, states) {
  if (!board) return []
  return board.categories.map((cat, ci) => {
    let score = 0
    cat.clues.forEach((clue, ri) => {
      const state = (states || {})[`${ci}-${ri}`] || 'unanswered'
      if (!clue.isDailyDouble) score += CORYAT_VAL[state](clue.value)
    })
    return { name: cat.name, score }
  })
}

function calcCoryat(states, board) {
  if (!board) return 0
  return Object.entries(states).reduce((sum, [key, state]) => {
    const [ci, ri] = key.split('-').map(Number)
    const clue = board?.categories?.[ci]?.clues?.[ri]
    if (!clue || clue.isDailyDouble) return sum
    return sum + CORYAT_VAL[state](clue.value)
  }, 0)
}

export default function App() {
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState(null)

  const [view, setView] = useState('board')
  const [board, setBoard] = useState(null) // null = loading, SAMPLE_BOARD = fallback
  const [episodeMeta, setEpisodeMeta] = useState(null)
  const [episodeData, setEpisodeData] = useState(null)
  const [round, setRound] = useState('single')
  const [episodeList, setEpisodeList] = useState([]) // current season, for prev/next nav
  const [currentEpIndex, setCurrentEpIndex] = useState(-1)
  const [seasons, setSeasons] = useState([])            // all seasons, for cross-season nav
  const [seasonNavLoading, setSeasonNavLoading] = useState(false)
  const [boardLoading, setBoardLoading] = useState(true)
  const [boardError, setBoardError] = useState(null)

  const [singleClueStates, setSingleClueStates] = useState({})
  const [doubleClueStates, setDoubleClueStates] = useState({})

  const [activeClue, setActiveClue] = useState(null)
  const [showAnswer, setShowAnswer] = useState(false)
  const [showFJ, setShowFJ] = useState(false)
  const [fjAnswered, setFjAnswered] = useState(null)
  const [timedMode, setTimedMode] = useState(false)
  const [autoMode, setAutoMode] = useState(false)
  const autoModeRef = useRef(false)
  const [tournamentMode, setTournamentMode] = useState(false)
  const tournamentModeRef = useRef(false)
  const [tournamentState, setTournamentState] = useState(null) // { position, opponents }
  const [showTournamentSetup, setShowTournamentSetup] = useState(false)
  const [showConfidence, setShowConfidence] = useState(false)
  const [confidenceRatings, setConfidenceRatings] = useState(null)
  const [wagerState, setWagerState] = useState(null) // { type, resolve }
  const [dailyDoubles, setDailyDoubles] = useState([]) // per-DD wager log for this game
  // Reaction times from Timed Mode, in ms from the buzz window opening to the buzz.
  // TimedClueModal measured these and threw them away; the Speed tab filtered game
  // history on a timedStats field that nothing ever wrote, so it could never show data.
  const [buzzTimes, setBuzzTimes] = useState([])

  const [cards, setCards] = useState([])
  // Re-sync cards from storage when window regains focus (catches drill updates)
  useEffect(() => {
    const sync = () => setCards(loadCards())
    window.addEventListener('focus', sync)
    return () => window.removeEventListener('focus', sync)
  }, [])
  const [gameHistory, setGameHistory] = useState([])
  const [storageReady, setStorageReady] = useState(false)
  const [showBrowser, setShowBrowser] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [gameStarted, setGameStarted] = useState(false) // true after Start button tapped
  const [showStartScreen, setShowStartScreen] = useState(false)
  const [actualScore, setActualScore] = useState(0) // real show score including wagers
  const [wagerAmount, setWagerAmount] = useState(null) // pending wager
  const [lastClueResult, setLastClueResult] = useState(null) // 'correct' | 'incorrect' | 'pass'
  const [boardControl, setBoardControl] = useState('player') // 'player' | 'opponent'
  const boardControlRef = useRef('player')
  const opponentCategoryRef = useRef(null)
  const boardRef = useRef(null)
  const dailyDoublesRef = useRef([])
  const clueStatesRef = useRef({})
  const singleClueStatesRef = useRef({})
  const doubleClueStatesRef = useRef({})
  const episodeMetaRef = useRef(null)
  const gameStartedRef = useRef(false)
  const roundRef = useRef('single')
  const gameCompleteRef = useRef(false)
  const triggerOpponentPickRef = useRef(null)
  const [showDJPrompt, setShowDJPrompt] = useState(false)
  const [resumePrompt, setResumePrompt] = useState(null) // saved game state to restore
  const [pendingOpponentPick, setPendingOpponentPick] = useState(null)
  const [predictionBaseDate, setPredictionBaseDate] = useState(() => localStorage.getItem('jeo-prediction-base') || null)
  const [fontSettings, setFontSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem('jeo-font-settings') || 'null') || { enabled: false, size: true, weight: true, lineHeight: true } }
    catch { return { enabled: false, size: true, weight: true, lineHeight: true } }
  })
  const [showFontPanel, setShowFontPanel] = useState(false)
  const largeFont = fontSettings.enabled
  function updateFontSettings(key, val) {
    const next = { ...fontSettings, [key]: val }
    setFontSettings(next)
    localStorage.setItem('jeo-font-settings', JSON.stringify(next))
  }
  const [showCache, setShowCache] = useState(false)
  const [showCategorySearch, setShowCategorySearch] = useState(false)

  const syncTimeout = useRef(null)
  const lastRemoteGameSave = useRef(0)

  const clueStates = round === 'single' ? singleClueStates : doubleClueStates
  const setClueStates = round === 'single' ? setSingleClueStates : setDoubleClueStates

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthChecked(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Tells boot.js not to reload the page when a new service worker takes over: a board
  // autosaves and would survive it, but a study session lives only in memory.
  const [studying, setStudying] = useState(false)
  useEffect(() => {
    const busy = studying || gameStarted
    window.__jeoBusy = busy
    // boot.js defers a service-worker reload while busy rather than dropping a session.
    // Take it as soon as we are idle again, so an update lands promptly instead of the
    // app running superseded code until the next manual navigation. Going idle means a
    // session just ended, so there is nothing in memory left to lose.
    if (!busy && window.__jeoUpdatePending) {
      window.__jeoUpdatePending = false
      window.location.reload()
    }
    return () => { window.__jeoBusy = false }
  }, [studying, gameStarted])

  // Surface failed local writes through the same banner as sync errors, rather
  // than letting the app show cards that were never actually saved.
  useEffect(() => {
    setStorageErrorHandler(msg => setSyncError(msg))
    return () => setStorageErrorHandler(null)
  }, [])

  // Move deck snapshots out of localStorage (~2.3 MB) into IndexedDB.
  useEffect(() => {
    ensureSnapshotsMigrated()
      .then(n => { if (n > 0) console.info(`[migration] moved ${n} deck snapshot(s) to IndexedDB`) })
      .catch(() => {})
  }, [])

  // ── Load local data ───────────────────────────────────────────────────────
  useEffect(() => {
    const fsrsPass = migrateToFsrs(loadCards())
    if (fsrsPass.changed) console.info(`[migration] seeded FSRS state on ${fsrsPass.changed} card(s)`)
    setCards(fsrsPass.cards)
    const fjPass = migrateFJWagers(loadGameHistory())
    if (fjPass.changed) console.info(`[migration] repaired FJ wager on ${fjPass.changed} game(s)`)
    const ddPass = backfillDdNet(fjPass.games)
    if (ddPass.changed) console.info(`[migration] derived ddNet for ${ddPass.changed} game(s)`)
    setGameHistory(ddPass.games)
    setStorageReady(true)
    setHistoryReady(true)
  }, [])

  // ── Check for saved game state to resume ────────────────────────────────
  useEffect(() => {
    if (!authChecked) return
    const saved = loadGameState()
    // Defensive: stale finished states may already be on disk from before the guard
    // above existed, so judge the record itself rather than trusting it was cleared.
    if (isResumable(saved)) setResumePrompt(saved)
  }, [authChecked])

  // The remote half of that. An in-progress board has been pushed to Supabase every 30
  // seconds of play since the feature was written, and nothing ever read it back — so the
  // cross-device resume it exists for never actually worked. Offer it when it is genuinely
  // ahead of whatever is on this device; savedAt is what decides, since both sides stamp it.
  useEffect(() => {
    if (!user || !authChecked) return
    let cancelled = false
    loadGameStateRemote()
      .then(remote => {
        if (cancelled || !isResumable(remote)) return
        const local = loadGameState()
        const newer = new Date(remote.savedAt || 0) > new Date(local?.savedAt || 0)
        if (!isResumable(local) || newer) setResumePrompt(remote)
      })
      .catch(() => {}) // a missing remote game is not worth surfacing
    return () => { cancelled = true }
  }, [user, authChecked])

  const [dailyCards, setDailyCards] = useState(() => getDailyStats().cardsReviewed)
  const _todayCheck = new Date().toDateString()
  useEffect(() => { setDailyCards(getDailyStats().cardsReviewed) }, [_todayCheck])

  // ── Auto-load latest episode + episode list on mount ────────────────────
  const [historyReady, setHistoryReady] = useState(false)

  const startupLoaded = useRef(false)

  useEffect(() => {
    // Wait for both. The effect re-runs as each flips, and it used to act on the first
    // one — so a cold start fetched the list twice and, worse, kicked off two competing
    // loadEpisode calls: the first with an empty history (landing on the latest episode)
    // and the second with the real history (landing on the next unplayed one). Whichever
    // resolved last won, so which board you got was a race.
    if (!authChecked || !historyReady || startupLoaded.current) return
    startupLoaded.current = true

    // gameHistory[0] is the most recent game. gameId is the numeric j-archive id;
    // older records only have episodeId (the show number) and an air date.
    const lastEntry = gameHistory.length > 0 ? gameHistory[0] : null
    const lastGameId = lastEntry?.gameId || null

    const loadLatestFallback = () => {
      loadEpisode('latest', true).catch(() => {
        const tryIds = ['9470', '9469', '9468', '9467', '9466']
        const tryNext = (ids) => {
          if (!ids.length) return
          loadEpisode(ids[0], true).catch(() => tryNext(ids.slice(1)))
        }
        tryNext(tryIds)
      })
    }

    // One request serves both consumers: populating prev/next, and finding the next
    // unplayed episode.
    fetch('/.netlify/functions/episodes')
      .then(r => r.json())
      .then(data => {
        if (data.seasons?.length) setSeasons(data.seasons)
        if (!data.episodes?.length) { loadLatestFallback(); return }
        setEpisodeList(data.episodes)
        setCurrentEpIndex(0) // provisional; corrected below once the episode loads

        // Find the last played episode in the list
        // Match by gameId first, then airDate (most reliable since showNumber may be stale)
        let lastIdx = -1
        if (lastGameId) {
          lastIdx = data.episodes.findIndex(e => e.gameId === lastGameId)
        }
        if (lastIdx === -1 && lastEntry?.airDate) {
          // Air date is the one field both sides have always carried. Uses the same
          // normaliser as the played-episode index rather than a second copy of it.
          const lastAir = normalizeAirDate(lastEntry.airDate)
          lastIdx = data.episodes.findIndex(e => normalizeAirDate(e.airDate) === lastAir)
        }

        if (lastIdx > 0) {
          // Episodes are newest-first, so "next" is at index lastIdx - 1
          const nextEp = data.episodes[lastIdx - 1]
          loadEpisode(nextEp.gameId, true)
            .then(() => setCurrentEpIndex(lastIdx - 1))
            .catch(() => {
              // Next episode not parsed yet, stay on latest
              loadEpisode(data.episodes[0].gameId, true)
                .then(() => setCurrentEpIndex(0))
                .catch(loadLatestFallback)
            })
        } else if (lastIdx === 0) {
          // Already on the most recent episode
          loadEpisode(data.episodes[0].gameId, true)
            .then(() => setCurrentEpIndex(0))
            .catch(loadLatestFallback)
        } else {
          // Not found in list — load latest
          loadEpisode(data.episodes[0].gameId, true)
            .then(() => setCurrentEpIndex(0))
            .catch(loadLatestFallback)
        }
      })
      .catch(loadLatestFallback)
  }, [authChecked, historyReady])

  // ── Sync from Supabase when user logs in ──────────────────────────────────
  useEffect(() => {
    if (!user || !storageReady) return
    setSyncing(true)
    setSyncError(null)
    loadRemoteData()
      .then(remote => {
        const local = { cards, gameHistory, tombstones: getTombstones() }
        const merged = mergeData(local, remote)
        // Run after the merge, not before: remote wins on conflict for games that
        // already exist there, so repairing local first would just be overwritten.
        // Repairing the merged result means the fix propagates back up on the next save.
        const fjPass = migrateFJWagers(merged.gameHistory)
        if (fjPass.changed) console.info(`[migration] repaired FJ wager on ${fjPass.changed} game(s)`)
        const ddPass = backfillDdNet(fjPass.games)
        if (ddPass.changed) console.info(`[migration] derived ddNet for ${ddPass.changed} game(s)`)
        const repairedHistory = ddPass.games
        if (merged.tombstones) saveTombstones(merged.tombstones)
        const fsrsPass = migrateToFsrs(merged.cards)
        if (fsrsPass.changed) console.info(`[migration] seeded FSRS state on ${fsrsPass.changed} card(s)`)
        setCards(fsrsPass.cards)
        setGameHistory(repairedHistory)
        saveCards(fsrsPass.cards)
        saveGameHistory(repairedHistory)
        // Merge daily stats: take the max across devices for today
        if (remote.dailyStats) {
          const today = new Date().toLocaleDateString()
          const remoteToday = remote.dailyStats[today] || 0
          const localToday = getDailyStats().cardsReviewed
          if (remoteToday > localToday) {
            incrementDailyCards(remoteToday - localToday)
            setDailyCards(remoteToday)
          }
        }
      })
      .catch(err => setSyncError(err.message))
      .finally(() => setSyncing(false))

    // Migrate any local IndexedDB media to Supabase Storage
    migrateLocalMediaToSupabase(user)
      .then(count => { if (count > 0) console.log(`Migrated ${count} media files to Supabase`) })
      .catch(console.warn)
  }, [user, storageReady])

  // ── Save locally + debounced remote sync ─────────────────────────────────
  useEffect(() => {
    if (!storageReady) return
    saveCards(cards)
    if (cards.length > 10) saveDeckSnapshot(cards).catch(() => {})
    saveGameHistory(gameHistory)
    if (user) {
      // Every push sends the whole deck (1-2 MB). At a 2s debounce a 100-card study
      // session re-uploaded it dozens of times. 20s coalesces a session into a
      // handful of pushes; the flush below covers leaving before the timer fires.
      clearTimeout(syncTimeout.current)
      syncTimeout.current = setTimeout(() => { pushRemote() }, 20000)
    }
  }, [cards, gameHistory, storageReady, user])

  // Keep the latest values for the flush, which runs outside the render cycle.
  const pushPayloadRef = useRef({ cards, gameHistory })
  useEffect(() => { pushPayloadRef.current = { cards, gameHistory } }, [cards, gameHistory])

  const pushRemote = useCallback(() => {
    const { cards: c, gameHistory: g } = pushPayloadRef.current
    setSyncing(true)
    return saveRemoteData(c, g, { [new Date().toLocaleDateString()]: getDailyStats().cardsReviewed }, getTombstones())
      .catch(err => setSyncError(err.message))
      .finally(() => setSyncing(false))
  }, [])

  // Flush pending work when the tab is backgrounded or closed — on mobile this is
  // usually how a study session ends, and it is where a long debounce would lose data.
  useEffect(() => {
    if (!user) return
    const flush = () => {
      if (document.visibilityState === 'hidden' && syncTimeout.current) {
        clearTimeout(syncTimeout.current)
        syncTimeout.current = null
        pushRemote()
      }
    }
    document.addEventListener('visibilitychange', flush)
    return () => document.removeEventListener('visibilitychange', flush)
  }, [user, pushRemote])

  // ── Card helpers ──────────────────────────────────────────────────────────
  const addMissedAsCard = useCallback((clue, category) => {
    setCards(prev => {
      if (prev.some(c => c.front === clue.answer)) return prev
      const card = newCard(clue.answer, clue.question, category, clue.value, 'missed')
      // Tag with episode number so we can filter by episode in study
      if (episodeMeta?.episodeNumber) card.episodeId = episodeMeta.episodeNumber
      return [...prev, card]
    })
  }, [episodeMeta])

  // ── Episode loading ───────────────────────────────────────────────────────
  // Auto-save current game state before loading new episode
  function autoSaveCurrentGame() {
    // Use refs to get current values (avoids stale closure issues)
    const meta = episodeMetaRef.current || episodeMeta
    const started = gameStartedRef.current || gameStarted
    if (!meta || !started) return
    const state = {
      episodeData,
      episodeMeta: meta,
      round: roundRef.current || round,
      board: boardRef.current || board,
      singleClueStates: singleClueStatesRef.current || singleClueStates,
      doubleClueStates: doubleClueStatesRef.current || doubleClueStates,
      fjAnswered,
      coryatScore: singleCoryat + doubleCoryat,
      actualScore: actualScore,
      confidenceRatings,
      dailyDoubles,
      buzzTimes,
      tournamentState,
      savedAt: new Date().toISOString(),
    }
    saveGameState(state)
    // The local copy is cheap and guards against a crash mid-game. The remote copy
    // only has to be good enough to resume on another device, so throttle it — this
    // used to fire a network write carrying the whole episode on every clue answered.
    if (user && Date.now() - lastRemoteGameSave.current > 30000) {
      lastRemoteGameSave.current = Date.now()
      saveGameStateRemote(state).catch(console.error)
    }
  }

  async function loadRandomUnplayed() {
    // Matches on air date as well as id, so the 30-odd games recorded before gameId
    // existed aren't offered up again as "unplayed".
    const playedIdx = buildPlayedIndex(gameHistory)
    try {
      // Fetch all seasons to pick from the full archive
      const res = await fetch('/.netlify/functions/episodes')
      const data = await res.json()
      const allSeasons = data.seasons || []
      if (!allSeasons.length) {
        // Fallback to current episodeList
        const pool = episodeList.filter(ep => !findPlayed(playedIdx, ep))
        const pick = (pool.length ? pool : episodeList)[Math.floor(Math.random() * (pool.length || episodeList.length))]
        if (pick) loadEpisode(pick.gameId)
        return
      }
      // Pick a random season, then a random episode from it
      const randomSeason = allSeasons[Math.floor(Math.random() * allSeasons.length)]
      const res2 = await fetch(`/.netlify/functions/episodes?season=${randomSeason.id}`)
      const data2 = await res2.json()
      const eps = data2.episodes || []
      const unplayed = eps.filter(ep => !findPlayed(playedIdx, ep))
      const pool = unplayed.length > 0 ? unplayed : eps
      const pick = pool[Math.floor(Math.random() * pool.length)]
      if (pick) {
        // Adopt this season as the nav context so prev/next work from here
        setEpisodeList(eps)
        loadEpisode(pick.gameId)
      }
    } catch {
      // Fallback to episodeList
      const pick = episodeList[Math.floor(Math.random() * episodeList.length)]
      if (pick) loadEpisode(pick.gameId)
    }
  }

  async function loadEpisode(gameId, silent = false) {
    // Auto-save current game if one is in progress.
    // The completion check matters: saveGame clears the saved state when a game ends,
    // but navigating away afterwards used to write it straight back, so returning to
    // a finished game offered to resume it.
    if (gameStarted && episodeMeta && !fjAnswered && !gameCompleteRef.current) {
      const state = {
        episodeData,
        episodeMeta,
        round,
        board,
        singleClueStates,
        doubleClueStates,
        fjAnswered,
        coryatScore: singleCoryat + doubleCoryat,
        actualScore: actualScore,
        confidenceRatings,
        dailyDoubles,
        buzzTimes,
        tournamentState,
        savedAt: new Date().toISOString(),
      }
      saveGameState(state)
      if (user) saveGameStateRemote(state).catch(console.error)
    }

    // Reset game complete flag
    gameCompleteRef.current = false

    // Turn off auto mode when loading a new episode
    if (autoModeRef.current) {
      setAutoMode(false)
      autoModeRef.current = false
    }

    // Turn off tournament mode when loading a new episode
    if (tournamentModeRef.current) {
      setTournamentMode(false)
      tournamentModeRef.current = false
      setTournamentState(null)
      setBoardControl('player')
      boardControlRef.current = 'player'
      if (triggerOpponentPickRef.current) clearTimeout(triggerOpponentPickRef.current)
    }

    setBoardLoading(true)
    setBoardError(null)
    setGameStarted(false)
    setActualScore(0)
    try {
      // Check cache first
      const cached = getEpisodeFromCache(gameId === 'latest' ? gameId : gameId)
      const episode = cached || await fetchEpisode(gameId)
      // Cache the fetched episode
      if (!cached) saveEpisodeToCache(episode.episodeId || gameId, episode)
      const { board: newBoard, meta } = episodeToBoard(episode, 'single')
      setEpisodeData(episode)
      setBoard(newBoard)
      setEpisodeMeta(meta)
      setRound('single')
      setSingleClueStates(initClueStates(newBoard))

      // Check if there's a saved partial game for this episode
      const savedState = loadGameState()
      if (isResumable(savedState) &&
          (savedState.episodeMeta.episodeId === episode.episodeId ||
           savedState.episodeMeta.episodeNumber === episode.episodeNumber)) {
        setResumePrompt(savedState)
      }
      if (episode.doubleJeopardy) {
        const { board: djBoard } = episodeToBoard(episode, 'double')
        setDoubleClueStates(initClueStates(djBoard))
      } else {
        setDoubleClueStates({})
      }
      setFjAnswered(null)
      setActiveClue(null)
      setConfidenceRatings(null)
      setDailyDoubles([])
      setBuzzTimes([])
      // Start screen shown when user taps START button on board, not automatically
    } catch (err) {
      setBoardError(err.message)
      // Seed clue states alongside the fallback board. Without them every lookup returns
      // undefined, which is !== 'unanswered', so the whole board drew as already played —
      // thirty grey tiles that opened with the answer showing. The fallback matters most
      // when the episode fetch is failing, which is exactly when it was broken.
      if (!board) { setBoard(SAMPLE_BOARD); setSingleClueStates(initClueStates(SAMPLE_BOARD)) }
      throw err // re-throw so callers can catch and fallback
    } finally {
      setBoardLoading(false)
    }
  }

  function switchRound(newRound) {
    if (!episodeData) return
    const { board: newBoard } = episodeToBoard(episodeData, newRound)
    setBoard(newBoard)
    setRound(newRound)
    setActiveClue(null)
  }

  // Keep ref in sync so callbacks always see current tournamentMode
  useEffect(() => { tournamentModeRef.current = tournamentMode }, [tournamentMode])

  useEffect(() => { boardControlRef.current = boardControl }, [boardControl])
  useEffect(() => { boardRef.current = board }, [board])
  useEffect(() => { clueStatesRef.current = clueStates }, [clueStates])
  useEffect(() => { singleClueStatesRef.current = singleClueStates }, [singleClueStates])
  useEffect(() => { doubleClueStatesRef.current = doubleClueStates }, [doubleClueStates])
  useEffect(() => { episodeMetaRef.current = episodeMeta }, [episodeMeta])
  useEffect(() => { gameStartedRef.current = gameStarted }, [gameStarted])
  useEffect(() => { gameCompleteRef.current = !!fjAnswered }, [fjAnswered])
  useEffect(() => { autoModeRef.current = autoMode }, [autoMode])
  useEffect(() => { roundRef.current = round }, [round])
  useEffect(() => { dailyDoublesRef.current = dailyDoubles }, [dailyDoubles])

  // Auto-save whenever clue states change during an active game
  useEffect(() => {
    if (!gameStarted || !episodeMeta) return
    // Don't save if game is complete
    if (gameCompleteRef.current || fjAnswered) return
    const t = setTimeout(() => autoSaveCurrentGame(), 600)
    return () => clearTimeout(t)
  }, [singleClueStates, doubleClueStates, fjAnswered, gameStarted])

  // Opponent clue selection logic
  function selectOpponentClue(board, clueStates) {
    if (!board?.categories) return null
    const unanswered = []
    board.categories.forEach((cat, ci) => {
      cat.clues.forEach((clue, ri) => {
        if ((clueStates[`${ci}-${ri}`] || 'unanswered') === 'unanswered') {
          unanswered.push({ ci, ri, value: clue.value, categoryName: cat.name })
        }
      })
    })
    if (unanswered.length === 0) return null

    // 70% chance: continue in current category (or pick lowest available in a category)
    // 30% chance: switch to a new category
    const currentCat = opponentCategoryRef.current
    const inCurrentCat = currentCat !== null
      ? unanswered.filter(c => c.ci === currentCat)
      : []

    let pick = null
    if (inCurrentCat.length > 0 && Math.random() < 0.7) {
      // Continue in current category, pick lowest value
      pick = inCurrentCat.sort((a, b) => a.value - b.value)[0]
    } else {
      // Pick a new category — prefer ones with multiple unanswered clues
      const categories = [...new Set(unanswered.map(c => c.ci))]
      // Weight categories by number of remaining clues
      const weights = categories.map(ci => unanswered.filter(c => c.ci === ci).length)
      const totalWeight = weights.reduce((a, b) => a + b, 0)
      let rand = Math.random() * totalWeight
      let chosenCat = categories[0]
      for (let i = 0; i < categories.length; i++) {
        rand -= weights[i]
        if (rand <= 0) { chosenCat = categories[i]; break }
      }
      opponentCategoryRef.current = chosenCat
      const catClues = unanswered.filter(c => c.ci === chosenCat).sort((a, b) => a.value - b.value)
      pick = catClues[0]
    }

    if (pick) opponentCategoryRef.current = pick.ci
    return pick
  }

  function triggerOpponentPick() {
    if (!tournamentModeRef.current) return
    if (boardControlRef.current !== 'opponent') return
    if (triggerOpponentPickRef.current) clearTimeout(triggerOpponentPickRef.current)
    const timeout = setTimeout(() => {
      if (!tournamentModeRef.current) return
      if (boardControlRef.current !== 'opponent') return
      const pick = selectOpponentClue(boardRef.current, clueStatesRef.current)
      if (pick) setPendingOpponentPick({ ci: pick.ci, ri: pick.ri })
    }, 1500 + Math.random() * 1000)
    triggerOpponentPickRef.current = timeout
  }

  // When opponent pick is ready, open via React render cycle (avoids stale closure)
  useEffect(() => {
    if (!pendingOpponentPick) return
    setPendingOpponentPick(null)
    const { ci, ri } = pendingOpponentPick
    console.log('[Tournament] Opponent opening clue:', ci, ri)
    openClue(ci, ri, true) // true = isOpponentPick, bypasses guard
  }, [pendingOpponentPick])

  // Safety valve: if opponent has control for >6s and no pick fired, return to player
  useEffect(() => {
    if (!tournamentMode || boardControl !== 'opponent') return
    const safety = setTimeout(() => {
      if (boardControlRef.current === 'opponent') {
        console.warn('[Tournament] Safety valve triggered - returning control to player')
        setBoardControl('player')
        boardControlRef.current = 'player'
      }
    }, 6000)
    return () => clearTimeout(safety)
  }, [boardControl, tournamentMode])

  // Clean up timeout on unmount
  useEffect(() => () => { if (triggerOpponentPickRef.current) clearTimeout(triggerOpponentPickRef.current) }, [])

  function openClue(ci, ri, isOpponentPick = false) {
    // Use refs so this works correctly from timeout callbacks too
    const currentBoard = boardRef.current || board
    const currentClueStates = clueStatesRef.current || clueStates
    if (!currentBoard?.categories?.[ci]?.clues?.[ri]) return
    const clue = currentBoard.categories[ci].clues[ri]
    const category = currentBoard.categories[ci].name
    const currentState = currentClueStates[`${ci}-${ri}`]

    // In tournament mode, block PLAYER from picking when opponent has control
    // but allow the opponent's own programmatic pick through
    if (!isOpponentPick && tournamentModeRef.current && boardControlRef.current === 'opponent' && currentState === CLUE_STATES.UNANSWERED) {
      return // player tap blocked while opponent is selecting
    }

    // Allow re-answering already-answered clues (shows answer immediately)
    if (currentState !== CLUE_STATES.UNANSWERED) {
      // A re-answered Daily Double has to carry its original wager. Without it
      // markClue reverses the old result and applies the new one at face value,
      // so actualScore drifts by the wager/value gap — twice.
      const prior = clue.isDailyDouble
        ? (dailyDoublesRef.current || dailyDoubles).find(d => d.key === `${roundRef.current || round}-${ci}-${ri}`)
        : null
      setActiveClue({
        ci, ri,
        clue: prior?.wagered ? { ...clue, wager: prior.wager } : clue,
        category, isReanswer: true, previousResult: currentState,
      })
      setShowAnswer(true) // show answer immediately since they've seen it
      return
    }

    // Always intercept Daily Doubles for wagering
    if (clue.isDailyDouble) {
      setWagerState({ type: 'daily_double', ci, ri, clue, category })
      return
    }
    setActiveClue({ ci, ri, clue, category })
    setShowAnswer(false)
  }

  function markClue(result, skipDeck = false, meta = null) {
    const { ci, ri, clue, category, isReanswer, previousResult } = activeClue

    // Only present when the clue was played in Timed Mode and actually buzzed in on.
    // A missed buzz says nothing about reaction speed, so it records nothing.
    if (typeof meta?.buzzMs === 'number') setBuzzTimes(prev => [...prev, meta.buzzMs])
    setClueStates(prev => ({ ...prev, [`${ci}-${ri}`]: result }))

    if (!skipDeck && (result === CLUE_STATES.INCORRECT || result === CLUE_STATES.PASS)) {
      addMissedAsCard(clue, category)
    }

    // Track actual show score (with wagers for DD)
    const effectiveValue = clue.wager || clue.value

    // Record Daily Doubles so wagering can be analysed later. Only the effect on
    // actualScore used to survive the clue closing, which made DD play invisible.
    if (clue.isDailyDouble) {
      const key = `${round}-${ci}-${ri}`
      const entry = {
        key,
        round,
        category,
        value: clue.value,          // face value of the square
        wager: effectiveValue,      // what was actually risked
        wagered: !!clue.wager,      // false when the wager prompt was skipped
        result,
      }
      // Re-answering a clue replaces its entry rather than adding a second one.
      setDailyDoubles(prev => [...prev.filter(d => d.key !== key), entry])
    }

    if (isReanswer && previousResult) {
      // Reverse the old score effect first
      if (previousResult === CLUE_STATES.CORRECT) setActualScore(s => s - effectiveValue)
      else if (previousResult === CLUE_STATES.INCORRECT) setActualScore(s => s + effectiveValue)
    }

    // Apply new result
    if (result === CLUE_STATES.CORRECT) setActualScore(s => s + effectiveValue)
    else if (result === CLUE_STATES.INCORRECT) setActualScore(s => s - effectiveValue)

    setLastClueResult(result)
    setActiveClue(null)

    // Auto mode: pick next clue automatically
    if (autoModeRef.current) {
      setTimeout(() => {
        const currentBoard = boardRef.current
        const currentStates = clueStatesRef.current
        if (!currentBoard?.categories) return
        // Find next unanswered clue: go down each category before moving to next
        for (let col = 0; col < 6; col++) {
          for (let row = 0; row < 5; row++) {
            const key = `${col}-${row}`
            if ((currentStates[key] || 'unanswered') === 'unanswered') {
              if (currentBoard.categories[col]?.clues?.[row]) {
                setPendingOpponentPick({ ci: col, ri: row })
                return
              }
            }
          }
        }
      }, 300)
    }

    // Board control transfer in tournament mode
    if (tournamentModeRef.current) {
      if (result === 'correct') {
        setBoardControl('player')
        boardControlRef.current = 'player'
      } else {
        // Wrong or pass — opponent gets control
        setBoardControl('opponent')
        boardControlRef.current = 'opponent'
        // Schedule opponent pick after short delay
        setTimeout(() => triggerOpponentPick(), 100)
      }
    }

    // Check if Single Jeopardy just completed — prompt for Double Jeopardy
    if (round === 'single' && episodeData?.doubleJeopardy) {
      const updatedStates = { ...clueStates, [`${ci}-${ri}`]: result }
      const allDone = Object.values(updatedStates).every(s => s !== CLUE_STATES.UNANSWERED)
      if (allDone) setShowDJPrompt(true)
    }
  }

  // ── Scores ────────────────────────────────────────────────────────────────
  // Rebuilt only when the episode changes, not on every render. episodeToBoard throws
  // when a round is missing, and this sits in the render body — an episode restored
  // from an older saved game used to take the whole app down here.
  const singleBoard = useMemo(() => {
    if (!episodeData) return null
    try { return episodeToBoard(episodeData, 'single').board } catch { return null }
  }, [episodeData])
  const doubleBoard = useMemo(() => {
    if (!episodeData?.doubleJeopardy) return null
    try { return episodeToBoard(episodeData, 'double').board } catch { return null }
  }, [episodeData])
  const singleCoryat = calcCoryat(singleClueStates, singleBoard)
  const doubleCoryat = doubleBoard ? calcCoryat(doubleClueStates, doubleBoard) : 0
  const coryatScore = singleCoryat + doubleCoryat

  const totalClues = board?.categories?.length * 5 || 0

  // Check if current episode has been played before
  // Uses the same index the episode browser does. This was a third way of asking "have I
  // played this?", and the loosest one: it compared ids without coercing to string and
  // knew nothing about air dates, so it missed the games recorded before gameId existed.
  const playedIndex = useMemo(() => buildPlayedIndex(gameHistory), [gameHistory])
  const previousGame = episodeMeta
    ? findPlayed(playedIndex, { gameId: episodeMeta.episodeId, airDate: episodeMeta.airDate })
    : null

  // All-time totals: one pass over the history when it changes, rather than six on
  // every render (this component holds ~50 pieces of state, so it re-renders often).
  const { allTimeCorrect, allTimeIncorrect, allTimePass } = useMemo(() => {
    let c = 0, i = 0, p = 0
    for (const g of gameHistory) {
      c += g.totalCorrect || 0
      i += g.totalIncorrect || 0
      p += g.totalPass || 0
    }
    return { allTimeCorrect: c, allTimeIncorrect: i, allTimePass: p }
  }, [gameHistory])
  const allTimeAnswered = allTimeCorrect + allTimeIncorrect + allTimePass
  const pctCorrect = allTimeAnswered > 0 ? Math.round(allTimeCorrect / allTimeAnswered * 100) : null
  const pctIncorrect = allTimeAnswered > 0 ? Math.round(allTimeIncorrect / allTimeAnswered * 100) : null
  const pctPass = allTimeAnswered > 0 ? Math.round(allTimePass / allTimeAnswered * 100) : null
  const gamesWithDJ = gameHistory.filter(g => g.doubleCoryat !== undefined && g.doubleCoryat !== null)
  const avgSJ = gameHistory.length > 0 ? Math.round(gameHistory.reduce((s, g) => s + (g.singleCoryat || 0), 0) / gameHistory.length) : null
  const avgDJ = gamesWithDJ.length > 0 ? Math.round(gamesWithDJ.reduce((s, g) => s + (g.doubleCoryat || 0), 0) / gamesWithDJ.length) : null
  const gamesWithFJ = gameHistory.filter(g => g.finalJeopardy?.result)
  const fjCorrect = gamesWithFJ.filter(g => g.finalJeopardy.result === 'correct').length
  const pctFJ = gamesWithFJ.length > 0 ? Math.round(fjCorrect / gamesWithFJ.length * 100) : null

  // Calculate remaining board value for wager trainer
  const remainingBoardValue = board?.categories?.reduce((sum, cat, ci) => {
    return sum + cat.clues.reduce((s, clue, ri) => {
      const state = clueStates[`${ci}-${ri}`]
      return s + (state === 'unanswered' && !clue.isDailyDouble ? clue.value : 0)
    }, 0)
  }, 0) || 0
  // Highest clue value on the board — the Daily Double wager ceiling when it beats your
  // score. Read from the board rather than assumed, so Double Jeopardy and vintage
  // episodes with different value ladders both come out right.
  const maxClueValue = board?.categories?.reduce(
    (max, cat) => cat.clues.reduce((m, c) => Math.max(m, c.value || 0), max), 0) || 1000
  // Drawn once when the Final Jeopardy wager prompt opens. generateOpponent was being
  // called inline in the render, so the scores you were wagering against changed on every
  // re-render — and App re-renders constantly.
  const fjOpponents = useMemo(
    () => wagerState?.type !== 'final_jeopardy'
      ? undefined
      : (tournamentState?.opponents || [generateOpponent('second'), generateOpponent('third')]),
    [wagerState, tournamentState],
  )
  const answeredCount = Object.values(clueStates).filter(s => s !== CLUE_STATES.UNANSWERED).length
  const correctCount = Object.values(clueStates).filter(s => s === CLUE_STATES.CORRECT).length
  const incorrectCount = Object.values(clueStates).filter(s => s === CLUE_STATES.INCORRECT).length
  const passCount = Object.values(clueStates).filter(s => s === CLUE_STATES.PASS).length
  const todayStart = new Date().setHours(0, 0, 0, 0) // midnight today
  const dueCount = cards.filter(c => !isSuspended(c) && c.dueAt <= todayStart + 86400000).length // due by end of today

  // ── Save game ─────────────────────────────────────────────────────────────
  function saveGame(fjResult, finalActualScore = null) {
    if (!episodeMeta) return
    const totalCorrect = Object.values(singleClueStates).filter(s => s === 'correct').length + Object.values(doubleClueStates).filter(s => s === 'correct').length
    const totalIncorrect = Object.values(singleClueStates).filter(s => s === 'incorrect').length + Object.values(doubleClueStates).filter(s => s === 'incorrect').length
    const totalPass = Object.values(singleClueStates).filter(s => s === 'pass').length + Object.values(doubleClueStates).filter(s => s === 'pass').length

    // Build value breakdown for analytics
    function buildValueBreakdownForGame(board, states) {
      const tiers = {}
      board?.categories?.forEach((cat, ci) => {
        cat.clues.forEach((clue, ri) => {
          const state = (states || {})[`${ci}-${ri}`] || 'unanswered'
          const tier = clue.value
          if (!tiers[tier]) tiers[tier] = { correct: 0, incorrect: 0, pass: 0 }
          if (state === 'correct') tiers[tier].correct++
          else if (state === 'incorrect') tiers[tier].incorrect++
          else if (state === 'pass') tiers[tier].pass++
        })
      })
      return tiers
    }

    const singleValueBreakdown = buildValueBreakdownForGame(singleBoard, singleClueStates)
    const doubleValueBreakdown = buildValueBreakdownForGame(doubleBoard, doubleClueStates)
    const valueBreakdown = {}
    // Merge single and double, normalizing double values to single equivalents
    Object.entries(singleValueBreakdown).forEach(([v, s]) => {
      valueBreakdown[v] = { ...(valueBreakdown[v] || { correct:0, incorrect:0, pass:0 }) }
      valueBreakdown[v].correct += s.correct
      valueBreakdown[v].incorrect += s.incorrect
      valueBreakdown[v].pass += s.pass
    })
    Object.entries(doubleValueBreakdown).forEach(([v, s]) => {
      const normV = parseInt(v) / 2 // normalize DJ values to SJ equivalent
      valueBreakdown[normV] = { ...(valueBreakdown[normV] || { correct:0, incorrect:0, pass:0 }) }
      valueBreakdown[normV].correct += s.correct
      valueBreakdown[normV].incorrect += s.incorrect
      valueBreakdown[normV].pass += s.pass
    })

    const game = {
      id: `game-${Date.now()}`,
      episodeId: episodeMeta.episodeNumber,
      gameId: episodeMeta.episodeId, // numeric j-archive game_id e.g. "9465"
      airDate: episodeMeta.airDate,
      playedAt: new Date().toISOString(),
      singleCoryat,
      doubleCoryat,
      coryatScore,
      // finalActualScore includes the FJ wager; actualScore state is still pre-wager here
      actualScore: finalActualScore ?? actualScore,
      totalCorrect,
      totalIncorrect,
      totalPass,
      finalJeopardy: fjResult || null,
      singleBreakdown: categoryBreakdown(singleBoard, singleClueStates),
      doubleBreakdown: categoryBreakdown(doubleBoard, doubleClueStates),
      valueBreakdown,
      dailyDoubles,
      // Net effect of DD wagering on the show score. Coryat excludes Daily Doubles
      // entirely, so this is exactly what wagering added or cost versus a flat Coryat.
      ddNet: dailyDoubles.reduce((sum, d) =>
        sum + (d.result === 'correct' ? d.wager : d.result === 'incorrect' ? -d.wager : 0), 0),
      confidenceRatings: confidenceRatings || null,
      // Feeds the Speed tab. Null rather than an empty list when the game wasn't played
      // in Timed Mode — "not measured" and "measured nothing" are different claims.
      timedStats: buzzTimes.length ? { buzzTimes } : null,
      contestants: episodeMeta.contestants || null,
      tournamentResult: tournamentState ? {
        position: tournamentState.position,
        opponents: tournamentState.opponents,
        finalRank: [coryatScore, ...tournamentState.opponents].sort((a,b)=>b-a).indexOf(coryatScore) + 1,
      } : null,
    }
    setGameHistory(prev => {
      // Answering Final Jeopardy twice in one sitting saves twice; that should replace.
      // Playing the same episode again another day should not — losing the earlier
      // attempt removes the only way to see whether you improved.
      const DOUBLE_SAVE_WINDOW = 10 * 60 * 1000
      const now = Date.now()
      const kept = prev.filter(g => !(
        g.episodeId === game.episodeId &&
        now - new Date(g.playedAt).getTime() < DOUBLE_SAVE_WINDOW
      ))
      const attempt = kept.filter(g => g.episodeId === game.episodeId).length + 1
      return [{ ...game, attempt }, ...kept]
    })
    gameCompleteRef.current = true // mark complete before async updates
    clearGameState() // game complete, clear saved state
    // …and the remote copy, or every other device goes on offering this finished game.
    if (user) clearGameStateRemote().catch(console.error)
  }

  function handleFJAnswer(result) {
    setFjAnswered(result)
    // Calculate final actual score synchronously so saveGame gets the right value
    const fjWager = wagerAmount || 0
    const finalActualScore = result === 'correct'
      ? actualScore + fjWager
      : actualScore - fjWager
    setActualScore(finalActualScore)
    saveGame(
      { result, category: episodeData?.finalJeopardy?.category, clue: episodeData?.finalJeopardy?.clue, answer: episodeData?.finalJeopardy?.answer, wager: fjWager },
      finalActualScore // pass final score explicitly
    )
    clearGameState()
    setWagerAmount(null)
    setShowFJ(false)
  }

  // ── Prev/next episode, rolling across season boundaries ───────────────────
  // episodeList holds one season, newest-first. dir = +1 goes back in time.
  // Dedupe defensively: j-archive lists the newest two seasons twice, and a
  // duplicate here would make a season look adjacent to itself.
  const orderedSeasons = [...new Map(seasons.map(s => [String(s.id), s])).values()]
    .sort((a, b) => parseInt(b.id) - parseInt(a.id))
  const currentSeasonId = episodeList[0]?.season ?? null
  const seasonIdx = currentSeasonId == null
    ? -1
    : orderedSeasons.findIndex(s => String(s.id) === String(currentSeasonId))
  const olderSeason = seasonIdx >= 0 ? orderedSeasons[seasonIdx + 1] : null
  const newerSeason = seasonIdx > 0 ? orderedSeasons[seasonIdx - 1] : null

  const navAnchored = currentEpIndex >= 0 && episodeList.length > 0
  const canGoPrev = navAnchored && !seasonNavLoading &&
    (currentEpIndex < episodeList.length - 1 || !!olderSeason)
  const canGoNext = navAnchored && !seasonNavLoading &&
    (currentEpIndex > 0 || !!newerSeason)

  async function navigateEpisode(dir) {
    if (!navAnchored || seasonNavLoading) return

    const newIndex = currentEpIndex + dir
    if (newIndex >= 0 && newIndex < episodeList.length) {
      setCurrentEpIndex(newIndex)
      loadEpisode(episodeList[newIndex].gameId)
      return
    }

    // Walked off an edge — pull in the adjacent season and continue into it.
    const target = dir === 1 ? olderSeason : newerSeason
    if (!target) return // start or end of the archive

    setSeasonNavLoading(true)
    try {
      const res = await fetch(`/.netlify/functions/episodes?season=${target.id}`)
      const data = await res.json()
      const eps = data.episodes || []
      if (!eps.length) return
      // Entering an older season lands on its newest show; a newer season on its oldest.
      const entryIdx = dir === 1 ? 0 : eps.length - 1
      setEpisodeList(eps)
      setCurrentEpIndex(entryIdx)
      await loadEpisode(eps[entryIdx].gameId)
    } catch {
      // Leave the user where they are; the season didn't load.
    } finally {
      setSeasonNavLoading(false)
    }
  }

  // Keep the prev/next anchor pointing at whatever episode is actually loaded.
  // Without this, loading a game from category search or Random leaves the index
  // pointing into a stale list and prev/next jump somewhere unrelated.
  useEffect(() => {
    const id = episodeMeta?.episodeId
    if (!id || episodeList.length === 0) return
    setCurrentEpIndex(episodeList.findIndex(ep => String(ep.gameId) === String(id)))
  }, [episodeMeta, episodeList])

  if (!authChecked || (boardLoading && !board)) {
    return (
      <div style={{ background: '#060b1a', minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f5c518', fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 4, flexDirection: 'column', gap: 12 }}>
        <div>JEO TRAINER</div>
        <div style={{ fontSize: 12, color: '#4060a0', letterSpacing: 3 }}>LOADING LATEST EPISODE...</div>
      </div>
    )
  }

  return (
    <div style={{ ...S.app, ...fontOverride(largeFont, fontSettings, { size: 17, weight: 500, lineHeight: 1.5 }) }}>
      <Header
        largeFont={largeFont}
        onToggleFontPanel={() => setShowFontPanel(p => !p)}
        coryatScore={coryatScore}
        actualScore={actualScore}
        correctCount={correctCount}
        incorrectCount={incorrectCount}
        passCount={passCount}
        answeredCount={answeredCount}
        totalClues={totalClues}
        episodeMeta={episodeMeta}
        user={user}
        syncing={syncing}
        syncError={syncError}
        onAuthClick={() => setShowAuth(true)}
      />
      <NavBar view={view} setView={setView} dueCount={dueCount} />
      {showFontPanel && (
        <div style={{ background: '#0a0f2e', borderBottom: '1px solid #1a2460', padding: '10px 16px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 9, color: '#4060a0', letterSpacing: 2, flexShrink: 0 }}>FONT</div>
          {[
            { key: 'enabled', label: 'Large' },
            { key: 'size', label: 'Size' },
            { key: 'weight', label: 'Weight' },
            { key: 'lineHeight', label: 'Spacing' },
          ].map(({ key, label }) => {
            const active = key === 'enabled' ? fontSettings.enabled : (fontSettings.enabled && fontSettings[key])
            const disabled = key !== 'enabled' && !fontSettings.enabled
            return (
              <button key={key} onClick={() => updateFontSettings(key, !fontSettings[key])}
                style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, border: `1px solid ${active ? '#f5c518' : '#2a3460'}`, background: active ? 'rgba(245,197,24,0.1)' : 'transparent', color: disabled ? '#2a3460' : active ? '#f5c518' : '#6070a0', cursor: disabled ? 'default' : 'pointer', letterSpacing: 1 }}
              >{label}</button>
            )
          })}
          <button onClick={() => setShowFontPanel(false)} style={{ marginLeft: 'auto', fontSize: 10, color: '#2a3460', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      <main style={S.main}>
        {view === 'board' && board && (
          <BoardView
            board={board}
            clueStates={clueStates}
            onOpen={openClue}
            episodeMeta={episodeMeta}
            episodeData={episodeData}
            round={round}
            hasDouble={!!episodeData?.doubleJeopardy}
            onSwitchRound={switchRound}
            onBrowse={() => setShowBrowser(true)}
            singleCoryat={singleCoryat}
            doubleCoryat={doubleCoryat}
            fjAnswered={fjAnswered}
            onShowFJ={() => {
              // Always show wager trainer before FJ
              setWagerState({ type: 'final_jeopardy', ci: null, ri: null, clue: null, category: null })
            }}
            boardLoading={boardLoading}
            boardError={boardError}
            onLoadEpisode={loadEpisode}
            onRandomGame={loadRandomUnplayed}
            canGoPrev={canGoPrev}
            canGoNext={canGoNext}
            onPrev={() => navigateEpisode(1)}
            onNext={() => navigateEpisode(-1)}
            timedMode={timedMode}
            onToggleTimedMode={() => setTimedMode(m => !m)}
            autoMode={autoMode}
            onToggleAutoMode={() => setAutoMode(m => !m)}
            largeFont={largeFont}
            fontSettings={fontSettings}
            tournamentMode={tournamentMode}
            tournamentState={tournamentState}
            boardControl={boardControl}
            coryatScore={coryatScore}
            onShowCache={() => setShowCache(true)}
            onShowCategorySearch={() => setShowCategorySearch(true)}
            gameStarted={gameStarted}
            previousGame={previousGame}
            onShowStartScreen={() => setShowStartScreen(true)}
            onToggleTournament={() => {
              if (tournamentModeRef.current) {
                setTournamentMode(false)
                tournamentModeRef.current = false
                setTournamentState(null)
                setBoardControl('player')
                boardControlRef.current = 'player'
                if (triggerOpponentPickRef.current) clearTimeout(triggerOpponentPickRef.current)
              } else {
                setShowTournamentSetup(true)
              }
            }}
          />
        )}
        {view === 'study' && <StudyTabView cards={cards} setCards={setCards} user={user} dueCount={dueCount} dailyCards={dailyCards} setDailyCards={setDailyCards} gameHistory={gameHistory} onSessionChange={setStudying} />}

        {view === 'summary' && (
          <SummaryView
            cards={cards}
            predictionBaseDate={predictionBaseDate}
            onResetPredictionBase={() => {
              const base = new Date().toISOString()
              setPredictionBaseDate(base)
              localStorage.setItem('jeo-prediction-base', base)
            }}
            coryatScore={coryatScore}
            actualScore={actualScore}
            fjAnswered={fjAnswered}
            singleBoard={singleBoard}
            doubleBoard={doubleBoard}
            singleClueStates={singleClueStates}
            doubleClueStates={doubleClueStates}
            gameHistory={gameHistory}
            episodeMeta={episodeMeta}
            tournamentState={tournamentState}
            confidenceRatings={confidenceRatings}
            allTimeCorrect={allTimeCorrect}
            allTimeIncorrect={allTimeIncorrect}
            allTimePass={allTimePass}
            allTimeAnswered={allTimeAnswered}
            pctCorrect={pctCorrect}
            pctIncorrect={pctIncorrect}
            pctPass={pctPass}
            avgSJ={avgSJ}
            avgDJ={avgDJ}
            gamesWithFJ={gamesWithFJ}
            fjCorrect={fjCorrect}
            pctFJ={pctFJ}
          />
        )}
      </main>

      {activeClue && !timedMode && (
        <ClueModal
          clue={activeClue.clue}
          category={activeClue.category}
          showAnswer={showAnswer}
          onReveal={() => setShowAnswer(true)}
          onMark={markClue}
          onClose={() => setActiveClue(null)}
          isReanswer={activeClue.isReanswer}
          previousResult={activeClue.previousResult}
          largeFont={largeFont}
          fontSettings={fontSettings}
        />
      )}
      {activeClue && timedMode && !activeClue.isReanswer && (
        <TimedClueModal
          clue={activeClue.clue}
          category={activeClue.category}
          onMark={markClue}
          onClose={() => setActiveClue(null)}
          largeFont={largeFont}
          fontSettings={fontSettings}
        />
      )}
      {activeClue && timedMode && activeClue.isReanswer && (
        <ClueModal
          clue={activeClue.clue}
          category={activeClue.category}
          showAnswer={true}
          onReveal={() => {}}
          onMark={(result, skipDeck) => markClue(result, skipDeck)}
          onClose={() => setActiveClue(null)}
          isReanswer={true}
          previousResult={activeClue.previousResult}
          largeFont={largeFont}
          fontSettings={fontSettings}
        />
      )}

      {showFJ && episodeData?.finalJeopardy && (
        <FinalJeopardyModal
          fj={episodeData.finalJeopardy}
          onAnswer={handleFJAnswer}
          // Closing without answering abandons the wager too. It used to survive, so
          // reopening Final Jeopardy and skipping the wager silently applied the amount
          // from the previous attempt to a round you meant to play flat.
          onClose={() => { setShowFJ(false); setWagerAmount(null) }}
        />
      )}

      {showBrowser && (
        <EpisodeBrowser
          currentEpisodeId={episodeMeta?.episodeId}
          playedIndex={playedIndex}
          lastPlayedGameId={gameHistory.length > 0 ? String(gameHistory[0].gameId) : null}
          onSelect={(gameId, episodes, index) => {
            setShowBrowser(false)
            setEpisodeList(episodes)
            setCurrentEpIndex(index)
            loadEpisode(gameId)
          }}
          onClose={() => setShowBrowser(false)}
        />
      )}

      {showStartScreen && board && board !== SAMPLE_BOARD && (
        <StartScreen
          board={board}
          episodeMeta={episodeMeta}
          gameHistory={gameHistory}
          predictionBaseDate={predictionBaseDate}
          onResetPredictionBase={() => {
            const b = new Date().toISOString()
            setPredictionBaseDate(b)
            localStorage.setItem('jeo-prediction-base', b)
          }}
          onStart={ratings => {
            setConfidenceRatings(ratings)
            setShowStartScreen(false)
            setGameStarted(true)
          }}
          onSkip={() => {
            setConfidenceRatings(null)
            setShowStartScreen(false)
            setGameStarted(true)
          }}
        />
      )}
      {resumePrompt && (
        <ResumePrompt
          resumeData={resumePrompt}
          onResume={() => {
            const r = resumePrompt
            setEpisodeData(r.episodeData)
            setEpisodeMeta(r.episodeMeta)
            setBoard(r.board)
            setRound(r.round)
            setSingleClueStates(r.singleClueStates)
            setDoubleClueStates(r.doubleClueStates)
            setFjAnswered(r.fjAnswered)
            setActualScore(r.actualScore || 0)
            setDailyDoubles(r.dailyDoubles || [])
            setBuzzTimes(r.buzzTimes || [])
            // These two were saved by autoSaveCurrentGame and then dropped on the way
            // back in, so a resumed game recorded confidenceRatings: null and lost its
            // tournament standings — "Confidence vs actual" simply never appeared.
            setConfidenceRatings(r.confidenceRatings || null)
            setTournamentState(r.tournamentState || null)
            if (r.tournamentState) {
              setTournamentMode(true)
              tournamentModeRef.current = true
              setBoardControl('player')
              boardControlRef.current = 'player'
            }
            setGameStarted(true)
            setResumePrompt(null)
            clearGameState()
          }}
          onRestart={() => {
            const epId = resumePrompt.episodeMeta?.episodeId
            clearGameState()
            setResumePrompt(null)
            if (epId) loadEpisode(epId, false)
          }}
          onDiscard={() => {
            clearGameState()
            if (user) clearGameStateRemote().catch(console.error)
            setResumePrompt(null)
          }}
        />
      )}

      {showTournamentSetup && (
        <TournamentSetupModal
          onStart={({ position, opponents }) => {
            setTournamentState({ position, opponents })
            setTournamentMode(true)
            tournamentModeRef.current = true
            // Player starts with control if in 1st position, otherwise opponent goes first
            const startsWithControl = position === 1
            setBoardControl(startsWithControl ? 'player' : 'opponent')
            boardControlRef.current = startsWithControl ? 'player' : 'opponent'
            opponentCategoryRef.current = null
            setShowTournamentSetup(false)
            // If opponent starts, trigger their first pick after board loads
            if (!startsWithControl) {
              setTimeout(() => triggerOpponentPick(), 2000)
            }
          }}
          onClose={() => setShowTournamentSetup(false)}
        />
      )}

      {wagerState && (
        <WagerTrainer
          type={wagerState.type}
          coryatScore={actualScore || coryatScore}
          boardValue={remainingBoardValue}
          maxClueValue={maxClueValue}
          lastClueResult={lastClueResult}
          answeredCount={answeredCount}
          opponentScores={fjOpponents}
          onWager={amount => {
            if (wagerState.type === 'final_jeopardy') {
              setWagerAmount(amount)
              setWagerState(null)
              setShowFJ(true)
            } else {
              setActiveClue({ ci: wagerState.ci, ri: wagerState.ri, clue: { ...wagerState.clue, wager: amount }, category: wagerState.category })
              setShowAnswer(false)
              setWagerState(null)
            }
          }}
          onSkip={() => {
            if (wagerState.type === 'final_jeopardy') {
              setWagerAmount(null) // skipping means no wager, not "keep the last one"
              setWagerState(null)
              setShowFJ(true)
            } else {
              setActiveClue({ ci: wagerState.ci, ri: wagerState.ri, clue: wagerState.clue, category: wagerState.category })
              setShowAnswer(false)
              setWagerState(null)
            }
          }}
        />
      )}

      {showAuth && (
        <AuthModal
          user={user}
          syncError={syncError}
          onClose={() => setShowAuth(false)}
          onSignOut={() => { signOut(); setShowAuth(false) }}
        />
      )}

      {showDJPrompt && (
        <DJPrompt
          singleCoryat={singleCoryat}
          doubleBoard={doubleBoard}
          onStart={(djRatings) => {
            // Merge DJ confidence ratings with existing SJ ratings
            if (djRatings) setConfidenceRatings(prev => ({ ...(prev || {}), ...djRatings }))
            switchRound('double')
            setShowDJPrompt(false)
          }}
          onSkip={() => setShowDJPrompt(false)}
        />
      )}

      {showCache && (
        <EpisodeCacheManager
          onLoadEpisode={loadEpisode}
          onClose={() => setShowCache(false)}
        />
      )}

      {showCategorySearch && (
        <CategorySearch
          onSelect={gameId => { setShowCategorySearch(false); loadEpisode(gameId) }}
          onClose={() => setShowCategorySearch(false)}
        />
      )}

      <style>{globalCSS}</style>
    </div>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────────
function Header({ coryatScore, actualScore, correctCount, incorrectCount, passCount, answeredCount, totalClues, episodeMeta, user, syncing, syncError, onAuthClick, largeFont, onToggleFontPanel }) {
  const color = coryatScore >= 0 ? '#f5c518' : '#e74c3c'
  const showActual = actualScore !== 0 || coryatScore !== actualScore
  return (
    <header style={S.header}>
      <div>
        <div style={S.logoMain}>JEO TRAINER</div>
        {episodeMeta
          ? <div style={S.logoSub}>#{episodeMeta.episodeNumber} · {episodeMeta.airDate}</div>
          : <div style={S.logoSub}>CORYAT & FLASHCARDS</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <div style={{ fontSize: 11, color: '#5060a0', letterSpacing: 1 }}>v{APP_VERSION}</div>
          <button
            onClick={onToggleFontPanel}
            style={{ fontSize: 9, color: largeFont ? '#f5c518' : '#4060a0', background: 'none', border: `1px solid ${largeFont ? '#f5c518' : '#2a3460'}`, borderRadius: 4, padding: '2px 6px', cursor: 'pointer', letterSpacing: 1 }}
            title="Font settings"
          >Aa</button>
        </div>
      </div>
      <div style={S.scoreBox}>
        <div style={S.scoreLbl}>CORYAT</div>
        <div style={{ ...S.scoreVal, color }}>{coryatScore >= 0 ? '+' : ''}{coryatScore.toLocaleString()}</div>
        {answeredCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
            <div style={{ fontSize: 9, color: '#4060a0', letterSpacing: 1 }}>SHOW</div>
            <div style={{ fontSize: 12, fontFamily: "'Bebas Neue', sans-serif", color: actualScore !== coryatScore ? '#4dd0e1' : '#4060a0' }}>
              {actualScore >= 0 ? '+' : ''}{actualScore.toLocaleString()}
            </div>
          </div>
        )}
      </div>
      <div style={{ ...S.headerStats, justifyContent: 'flex-end' }}>
        <div style={S.pill}>{correctCount}✓ {incorrectCount}✗ {passCount}—</div>
        <div style={S.pill}>{answeredCount}/{totalClues}</div>
        <button style={{ ...S.authBtn, color: syncError ? '#e57373' : user ? '#7cd992' : '#8890c0' }} onClick={onAuthClick} title={syncError ? `Sync error: ${syncError}` : user ? 'Synced' : 'Sign in to sync'}>
          {syncing ? '⏳' : syncError ? '⚠️' : user ? '☁️' : '🔓'}
        </button>
      </div>
    </header>
  )
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
// ─── Study Tab View ──────────────────────────────────────────────────────────
// Quarantined cards are invisible in study by design, so they need somewhere to be
// seen — otherwise they are just silently gone.
function QuarantineNotice({ cards, setCards }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')

  const { suspended } = useMemo(() => partitionByHealth(cards), [cards])
  if (!suspended.length) return null

  const release = card => setCards(prev => prev.map(c => (c.id === card.id ? releaseCard(c) : c)))
  const remove = card => {
    addToTrash(card)
    addTombstones(card.id)
    setCards(prev => prev.filter(c => c.id !== card.id))
  }
  const startRewrite = card => { setEditing(card); setFront(card.front); setBack(card.back) }
  const saveRewrite = () => {
    setCards(prev => prev.map(c => (c.id === editing.id ? releaseRewritten({ ...c, front, back }) : c)))
    setEditing(null)
  }

  return (
    <div style={{ background: '#0a0f2e', border: '1px solid #5c2a2a', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 17, color: '#e07070', letterSpacing: 2 }}>
            🚫 {suspended.length} CARD{suspended.length !== 1 ? 'S' : ''} QUARANTINED
          </div>
          <div style={{ fontSize: 10, color: '#8890c0', marginTop: 2, lineHeight: 1.5 }}>
            Failed {QUARANTINE_LAPSES}+ times, so they're out of your sessions. Usually the
            card needs rewriting, not more repetition.
          </div>
        </div>
        <button onClick={() => setOpen(o => !o)} style={{ fontSize: 11, color: '#f5c518', background: 'none', border: '1px solid #3a3010', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', flexShrink: 0 }}>
          {open ? 'Close' : 'Review'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {suspended.map(card => (
            <div key={card.id} style={{ background: '#060b1a', border: '1px solid #1a2040', borderRadius: 8, padding: '10px 12px' }}>
              {editing?.id === card.id ? (
                <>
                  <div style={S.formLabel}>CLUE</div>
                  <textarea style={{ ...S.textarea, marginBottom: 6 }} rows={2} value={front} onChange={e => setFront(e.target.value)} />
                  <div style={S.formLabel}>ANSWER</div>
                  <textarea style={{ ...S.textarea, marginBottom: 8 }} rows={2} value={back} onChange={e => setBack(e.target.value)} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={{ ...S.markBtn, background: '#1e2456', color: '#8890d0', border: '1px solid #2e3476', flex: 1 }} onClick={() => setEditing(null)}>Cancel</button>
                    <button style={{ ...S.revealBtn, flex: 2 }} onClick={saveRewrite} disabled={!front.trim() || !back.trim()}>
                      Save &amp; return to study
                    </button>
                  </div>
                  <div style={{ fontSize: 9, color: '#4060a0', marginTop: 6, letterSpacing: 1 }}>
                    Saving clears the lapse count — a rewritten card starts fresh.
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: '#c0c8e8', lineHeight: 1.45 }}>{card.front.replace(/<[^>]+>/g, '').slice(0, 140)}</div>
                  <div style={{ fontSize: 11, color: '#7cd992', marginTop: 3 }}>{card.back.replace(/<[^>]+>/g, '').slice(0, 100)}</div>
                  <div style={{ fontSize: 9, color: '#e07070', marginTop: 5, letterSpacing: 1 }}>
                    {card.lapses} lapses{card.category ? ` · ${card.category}` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button style={{ ...S.chip, color: '#f5c518', borderColor: '#3a3010', cursor: 'pointer' }} onClick={() => startRewrite(card)}>✏️ Rewrite</button>
                    <button style={{ ...S.chip, color: '#8890d0', cursor: 'pointer' }} onClick={() => release(card)}>↩ Release as-is</button>
                    <button style={{ ...S.chip, color: '#e07070', borderColor: '#5c2a2a', cursor: 'pointer' }} onClick={() => remove(card)}>🗑 Delete</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const DAILY_GOAL_KEY = 'jeo-daily-goal'
const GOAL_CHOICES = [20, 50, 100, 200]

// A visible target and an unbroken streak are the cheapest retention mechanics there
// are, and both numbers were already being tracked without driving anything.
function DailyGoalCard({ dailyCards }) {
  const [goal, setGoal] = useState(() => {
    const stored = parseInt(localStorage.getItem(DAILY_GOAL_KEY) || '', 10)
    return Number.isFinite(stored) && stored > 0 ? stored : 50
  })
  const [editing, setEditing] = useState(false)

  // Recompute when the day's count moves, so finishing a session updates the streak.
  const streak = useMemo(() => buildStudyStreak(getReviewLog()), [dailyCards])

  const pct = Math.min(100, Math.round((dailyCards / goal) * 100))
  const met = dailyCards >= goal
  const remaining = Math.max(0, goal - dailyCards)

  const chooseGoal = n => {
    setGoal(n)
    try { localStorage.setItem(DAILY_GOAL_KEY, String(n)) } catch {}
    setEditing(false)
  }

  return (
    <div style={{ background: '#0a0f2e', border: `1px solid ${met ? '#2e8c50' : '#1a2460'}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 9, letterSpacing: 3, color: '#6070a0' }}>TODAY</span>
        {streak.current > 0 && (
          <span style={{ fontSize: 11, color: streak.studiedToday ? '#f5c518' : '#8890c0', letterSpacing: 1 }}>
            🔥 {streak.current} day{streak.current !== 1 ? 's' : ''}
            {!streak.studiedToday && <span style={{ color: '#4060a0' }}> · study to keep it</span>}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 34, lineHeight: 1, color: met ? '#4caf7d' : '#f5c518' }}>
          {dailyCards}
        </span>
        <span style={{ fontSize: 12, color: '#8890c0' }}>of {goal} cards</span>
        <button
          onClick={() => setEditing(e => !e)}
          style={{ marginLeft: 'auto', fontSize: 10, color: '#4060a0', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: 1 }}
        >{editing ? 'close' : 'change goal'}</button>
      </div>

      <div style={S.progressOuter}>
        <div style={{ ...S.progressInner, width: `${pct}%`, background: met ? '#4caf7d' : '#f5c518' }} />
      </div>
      <div style={{ fontSize: 10, color: met ? '#4caf7d' : '#4060a0', marginTop: 5, letterSpacing: 1 }}>
        {met
          ? `✓ goal met${streak.longest > streak.current ? ` · best streak ${streak.longest} days` : ''}`
          : `${remaining} to go`}
      </div>

      {editing && (
        <div style={{ ...S.toggleGroup, marginTop: 10 }}>
          {GOAL_CHOICES.map(n => (
            <button key={n} style={{ ...S.toggleBtn, ...(goal === n ? S.toggleActive : {}) }} onClick={() => chooseGoal(n)}>{n}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function StudyTabView({ cards, setCards, user, dueCount, dailyCards, setDailyCards, gameHistory = [], onSessionChange }) {
  const [subTab, setSubTab] = useState('flashcards')
  const [flashcardView, setFlashcardView] = useState('menu') // menu | study | deck

  const subTabs = [
    { id: 'flashcards', label: `📖 FLASHCARDS${dueCount > 0 ? ` (${dueCount})` : ''}` },
    { id: 'drills', label: '⚡ DRILLS' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, width: '100%' }}>
      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 2, background: '#05081a', borderBottom: '1px solid #1a2040', padding: '6px 8px', overflowX: 'auto' }}>
        {subTabs.map(t => (
          <button
            key={t.id}
            onClick={() => { setSubTab(t.id); if (t.id === 'flashcards') setFlashcardView('menu') }}
            style={{
              flex: 1, padding: '6px 4px', borderRadius: 8, border: 'none',
              background: subTab === t.id ? '#1a2460' : 'transparent',
              color: subTab === t.id ? '#f5c518' : '#4060a0',
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: 1.5,
              cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding: '8px 0 0 0' }}>
        {subTab === 'flashcards' && (
          <>
            {flashcardView === 'menu' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480, margin: '0 auto', width: '100%' }}>
                <div style={{ background: 'linear-gradient(135deg, #0a0f2e 0%, #0f1e6e 100%)', borderRadius: 12, padding: '16px 16px', textAlign: 'center', border: '1px solid #2a3480' }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: '#f5c518', letterSpacing: 4 }}>FLASHCARDS</div>
                  <div style={{ fontSize: 11, color: '#4060a0', letterSpacing: 2, marginTop: 2 }}>SPACED REPETITION STUDY</div>
                </div>
                <QuarantineNotice cards={cards} setCards={setCards} />
                <DailyGoalCard dailyCards={dailyCards} />
                <button
                  style={{ background: '#0a0f2e', border: '1px solid #1a2460', borderRadius: 12, padding: '18px 20px', textAlign: 'left', cursor: 'pointer', width: '100%' }}
                  onClick={() => setFlashcardView('study')}
                >
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: '#f5c518', letterSpacing: 2 }}>🔁 STUDY SESSION</div>
                  <div style={{ fontSize: 11, color: '#4060a0', marginTop: 2 }}>{dueCount > 0 ? `${dueCount} cards due` : 'Review your flashcards'}</div>
                </button>
                <button
                  style={{ background: '#0a0f2e', border: '1px solid #1a2460', borderRadius: 12, padding: '18px 20px', textAlign: 'left', cursor: 'pointer', width: '100%' }}
                  onClick={() => setFlashcardView('deck')}
                >
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: '#f5c518', letterSpacing: 2 }}>🗂 MY DECK</div>
                  <div style={{ fontSize: 11, color: '#4060a0', marginTop: 2 }}>{cards.length} cards · browse, search & edit</div>
                </button>
              </div>
            )}
            {flashcardView === 'study' && <StudyView cards={cards} setCards={setCards} onBack={() => setFlashcardView('menu')} dailyCards={dailyCards} setDailyCards={setDailyCards} gameHistory={gameHistory} onSessionChange={onSessionChange} />}
            {flashcardView === 'deck' && <DeckView cards={cards} setCards={setCards} user={user} onBack={() => setFlashcardView('menu')} />}
          </>
        )}
        {subTab === 'drills' && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: '#4060a0', fontSize: 12, letterSpacing: 2 }}>LOADING DRILLS…</div>}>
            <DrillsView cards={cards} setCards={setCards} />
          </Suspense>
        )}
      </div>
    </div>
  )
}

function NavBar({ view, setView, dueCount }) {
  const tabs = [
    { id: 'board',   label: '📋 BOARD' },
    { id: 'study',   label: `📚 STUDY${dueCount > 0 ? ` (${dueCount})` : ''}` },
    { id: 'summary', label: '📊 STATS' },
  ]
  return (
    <nav style={S.nav}>
      {tabs.map(t => (
        <button key={t.id} style={{ ...S.navBtn, ...(view === t.id ? S.navActive : {}) }} onClick={() => setView(t.id)}>
          {t.label}
        </button>
      ))}
    </nav>
  )
}

// ─── Auth Modal ───────────────────────────────────────────────────────────────
function AuthModal({ user, syncError, onClose, onSignOut }) {
  const [authView, setAuthView] = useState('signin') // signin | signup | reset
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  async function handleSignIn() {
    if (!email.trim() || !password) return
    setLoading(true); setError(null)
    try {
      await signIn(email.trim(), password)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  async function handleSignUp() {
    if (!email.trim() || !password) return
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true); setError(null)
    try {
      await signUp(email.trim(), password)
      setSuccess('Account created! You are now signed in.')
      setTimeout(onClose, 1500)
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  async function handleReset() {
    if (!email.trim()) return
    setLoading(true); setError(null)
    try {
      await resetPassword(email.trim())
      setSuccess('Password reset email sent! Check your inbox.')
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 360 }} onClick={e => e.stopPropagation()}>
        <button style={S.closeX} onClick={onClose}>✕</button>
        <div style={S.browserTitle}>☁️ SYNC & BACKUP</div>

        {user ? (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, color: '#7cd992', marginBottom: 6 }}>✅ Signed in as</div>
            <div style={{ fontSize: 13, color: '#c0c8e8', marginBottom: 12, wordBreak: 'break-all' }}>{user.email}</div>
            <div style={{ fontSize: 12, color: '#6070a0', marginBottom: 16, lineHeight: 1.6 }}>
              Cards and game history sync automatically across all your devices.
            </div>
            {syncError && (
              <div style={{ fontSize: 12, color: '#e07070', marginBottom: 12, padding: 8, background: 'rgba(224,112,112,0.08)', borderRadius: 6 }}>
                ⚠️ Sync error: {syncError}
              </div>
            )}
            <button style={{ ...S.startBtn, background: '#1e2456', color: '#8890d0', border: '1px solid #2e3476' }} onClick={onSignOut}>
              Sign Out
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            {/* Tab switcher */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
              {[['signin', 'Sign In'], ['signup', 'Create Account']].map(([v, l]) => (
                <button key={v} style={{ ...S.toggleBtn, flex: 1, ...(authView === v ? S.toggleActive : {}) }} onClick={() => { setAuthView(v); setError(null); setSuccess(null) }}>
                  {l}
                </button>
              ))}
            </div>

            {authView !== 'reset' && (
              <>
                <div style={S.formLabel}>EMAIL</div>
                <input
                  style={{ ...S.input, marginBottom: 10 }}
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
                <div style={S.formLabel}>PASSWORD</div>
                <input
                  style={{ ...S.input, marginBottom: 4 }}
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (authView === 'signin' ? handleSignIn() : handleSignUp())}
                  placeholder={authView === 'signup' ? 'At least 6 characters' : '••••••••'}
                  autoComplete={authView === 'signin' ? 'current-password' : 'new-password'}
                />
                {authView === 'signin' && (
                  <button style={{ fontSize: 11, color: '#4060a0', letterSpacing: 1, marginBottom: 12, textAlign: 'right', width: '100%' }} onClick={() => { setAuthView('reset'); setError(null) }}>
                    Forgot password?
                  </button>
                )}
              </>
            )}

            {authView === 'reset' && (
              <>
                <div style={{ fontSize: 13, color: '#8890c0', lineHeight: 1.6, marginBottom: 12 }}>
                  Enter your email and we'll send a reset link.
                </div>
                <div style={S.formLabel}>EMAIL</div>
                <input style={{ ...S.input, marginBottom: 12 }} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
                <button style={{ fontSize: 11, color: '#4060a0', letterSpacing: 1, marginBottom: 12 }} onClick={() => { setAuthView('signin'); setError(null) }}>
                  ← Back to sign in
                </button>
              </>
            )}

            {error && <div style={{ fontSize: 12, color: '#e07070', marginBottom: 10, padding: '6px 8px', background: 'rgba(224,112,112,0.08)', borderRadius: 6 }}>{error}</div>}
            {success && <div style={{ fontSize: 12, color: '#7cd992', marginBottom: 10, padding: '6px 8px', background: 'rgba(124,217,146,0.08)', borderRadius: 6 }}>{success}</div>}

            <button
              style={{ ...S.startBtn, width: '100%', opacity: loading || !email.trim() ? 0.5 : 1 }}
              onClick={authView === 'signin' ? handleSignIn : authView === 'signup' ? handleSignUp : handleReset}
              disabled={loading || !email.trim()}
            >
              {loading ? 'Please wait...' : authView === 'signin' ? 'Sign In →' : authView === 'signup' ? 'Create Account →' : 'Send Reset Email →'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Board View ───────────────────────────────────────────────────────────────
function BoardView({ board, clueStates, onOpen, episodeMeta, episodeData, round, hasDouble, onSwitchRound, onBrowse, singleCoryat, doubleCoryat, fjAnswered, onShowFJ, boardLoading, boardError, onLoadEpisode, canGoPrev, canGoNext, onPrev, onNext, timedMode, onToggleTimedMode, autoMode, onToggleAutoMode, tournamentMode, tournamentState, boardControl, coryatScore, onToggleTournament, onShowCache, onShowCategorySearch, gameStarted, previousGame, onShowStartScreen, largeFont, fontSettings, onRandomGame }) {
  const tileBg = { unanswered: '#0f1e6e', correct: '#1a5c2e', incorrect: '#5c1a1a', pass: '#2a2a4a' }

  return (
    <div>
      {/* Top bar */}
      <div style={S.loaderBar}>
        <button style={{ ...S.loaderBtn, opacity: canGoPrev ? 1 : 0.3 }} onClick={onPrev} disabled={!canGoPrev}>← Prev</button>
        <button style={{ ...S.loaderBtn, flex: 1 }} onClick={onBrowse}>
          {boardLoading ? '⏳' : '📺'}
        </button>
        <button style={S.loaderBtn} onClick={onShowCategorySearch} title="Search by category">🔍</button>
        <button style={S.loaderBtn} onClick={onShowCache} title="Offline cache">📥</button>
        <button style={S.loaderBtn} onClick={onRandomGame} title="Random unplayed game">🎲</button>
        <button style={{ ...S.loaderBtn, opacity: canGoNext ? 1 : 0.3 }} onClick={onNext} disabled={!canGoNext}>Next →</button>
      </div>
      {/* Mode toggles */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, letterSpacing: 1, color: tournamentMode ? '#4caf7d' : '#4060a0' }}>🏆</span>
          <button onClick={onToggleTournament} style={{ width: 36, height: 20, borderRadius: 10, border: 'none', background: tournamentMode ? '#4caf7d' : '#1a2460', position: 'relative', transition: 'background 0.2s', cursor: 'pointer' }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: tournamentMode ? 19 : 3, transition: 'left 0.2s' }} />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, letterSpacing: 1, color: timedMode ? '#f5c518' : '#4060a0' }}>⏱</span>
          <button onClick={onToggleTimedMode} style={{ width: 36, height: 20, borderRadius: 10, border: 'none', background: timedMode ? '#f5c518' : '#1a2460', position: 'relative', transition: 'background 0.2s', cursor: 'pointer' }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: timedMode ? 19 : 3, transition: 'left 0.2s' }} />
          </button>
          <span style={{ fontSize: 10, letterSpacing: 1, color: autoMode ? '#4dd0e1' : '#4060a0', marginLeft: 6 }}>AUTO</span>
          <button onClick={onToggleAutoMode} style={{ width: 36, height: 20, borderRadius: 10, border: 'none', background: autoMode ? '#4dd0e1' : '#1a2460', position: 'relative', transition: 'background 0.2s', cursor: 'pointer' }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: autoMode ? 19 : 3, transition: 'left 0.2s' }} />
          </button>
        </div>
      </div>
      {/* Tournament opponent bar */}
      {tournamentMode && tournamentState && (
        <OpponentScoreBar tournamentState={tournamentState} coryatScore={coryatScore} />
      )}

      {/* Previously played banner */}
      {previousGame && !gameStarted && (
        <div style={{ background: 'rgba(245,197,24,0.06)', border: '1px solid rgba(245,197,24,0.2)', borderRadius: 8, padding: '8px 14px', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: '#f5c518', letterSpacing: 1 }}>⚠️ ALREADY PLAYED</div>
            <div style={{ fontSize: 10, color: '#6070a0', letterSpacing: 1 }}>
              Coryat: {previousGame.coryatScore >= 0 ? '+' : ''}{previousGame.coryatScore?.toLocaleString()}
            </div>
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: '#f5c518' }}>
            {previousGame.coryatScore >= 0 ? '+' : ''}{previousGame.coryatScore?.toLocaleString()}
          </div>
        </div>
      )}

      {/* Board control indicator */}
      {tournamentMode && gameStarted && (
        <div style={{
          textAlign: 'center', padding: '6px 14px', borderRadius: 8, marginBottom: 6,
          background: boardControl === 'player' ? 'rgba(76,175,77,0.1)' : 'rgba(229,115,115,0.1)',
          border: `1px solid ${boardControl === 'player' ? 'rgba(76,175,77,0.3)' : 'rgba(229,115,115,0.3)'}`,
          fontSize: 11, letterSpacing: 2,
          color: boardControl === 'player' ? '#4caf7d' : '#e57373',
        }}>
          {boardControl === 'player' ? '✓ YOU HAVE BOARD CONTROL' : '⏳ OPPONENT IS SELECTING...'}
        </div>
      )}

      {/* Start game bar — always visible when episode loaded but not started */}
      {episodeMeta && !gameStarted && (
        <div style={{
          background: 'linear-gradient(135deg, #0f1e6e, #060b1a)',
          border: '1px solid #f5c518',
          borderRadius: 10,
          padding: '10px 14px',
          marginBottom: 8,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
        }}>
          <div>
            <div style={{ fontSize: 11, color: '#f5c518', letterSpacing: 2, fontFamily: "'Bebas Neue', sans-serif" }}>
              READY TO PLAY?
            </div>
            <div style={{ fontSize: 10, color: '#6070a0', letterSpacing: 1 }}>
              #{episodeMeta.episodeNumber} · {episodeMeta.airDate}
            </div>
          </div>
          <button
            style={{
              background: '#f5c518', color: '#060b1a', borderRadius: 8,
              padding: '10px 20px', fontSize: 14, fontWeight: 700,
              letterSpacing: 2, fontFamily: "'Barlow Condensed', sans-serif",
              border: 'none', cursor: 'pointer',
            }}
            onClick={onShowStartScreen}
          >
            START →
          </button>
        </div>
      )}

      {boardError && <div style={S.loadError}>⚠️ {boardError}</div>}

      {hasDouble && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={S.roundTabs}>
            <button style={{ ...S.roundTab, ...(round === 'single' ? S.roundTabActive : {}) }} onClick={() => onSwitchRound('single')}>Single J!</button>
            <button style={{ ...S.roundTab, ...(round === 'double' ? S.roundTabActive : {}) }} onClick={() => onSwitchRound('double')}>Double J!</button>
          </div>
          <div style={S.roundScores}>
            <span style={S.roundScore}>SJ: <b style={{ color: singleCoryat >= 0 ? '#f5c518' : '#e74c3c' }}>{singleCoryat >= 0 ? '+' : ''}{singleCoryat.toLocaleString()}</b></span>
            <span style={S.roundScore}>DJ: <b style={{ color: doubleCoryat >= 0 ? '#f5c518' : '#e74c3c' }}>{doubleCoryat >= 0 ? '+' : ''}{doubleCoryat.toLocaleString()}</b></span>
          </div>
        </div>
      )}

      {episodeMeta?.url && (
        <div style={S.episodeLink}>
          <a href={episodeMeta.url} target="_blank" rel="noopener noreferrer" style={{ color: '#4060a0', fontSize: 10, letterSpacing: 1 }}>View on j-archive ↗</a>
        </div>
      )}

      <div style={S.board}>
        {board.categories.map((cat, ci) => (
          <div key={ci} style={{ ...S.catHeader, ...fontOverride(largeFont, fontSettings, { size: 13, weight: 700 }) }}>{cat.name}</div>
        ))}
        {board.categories.length < 6 && Array.from({ length: 6 - board.categories.length }).map((_, i) => (
          <div key={`missing-${i}`} style={{ ...S.catHeader, color: '#2a3460', fontStyle: 'italic' }}>UNAVAILABLE</div>
        ))}
        {board.categories[0].clues.map((_, ri) => {
          // Always render 6 columns, padding missing categories with empty tiles
          const numCols = 6
          return Array.from({ length: numCols }).map((__, ci) => {
            const cat = board.categories[ci]
            const key = `${ci}-${ri}`
            if (!cat) {
              // Missing category — render empty dark tile
              return <div key={key} style={{ ...S.tile, background: '#060b1a', cursor: 'default' }} />
            }
            const state = clueStates[key]
            const clue = cat.clues[ri]
            if (!clue) return <div key={key} style={{ ...S.tile, background: '#060b1a', cursor: 'default' }} />
            return (
              <div key={key} onClick={() => onOpen(ci, ri)} style={{ ...S.tile, background: tileBg[state], cursor: 'pointer', opacity: state !== 'unanswered' ? 0.65 : 1 }}>
                {state !== 'unanswered'
                  ? <span style={S.tileIcon}>{state === 'correct' ? '✓' : state === 'incorrect' ? '✗' : '—'}</span>
                  : <span style={{ ...S.tileVal, ...fontOverride(largeFont, fontSettings, { size: 20, weight: 600 }) }}>{clue.isDailyDouble && !tournamentMode && <span style={S.ddTag}>DD</span>}${clue.value.toLocaleString()}</span>}
              </div>
            )
          })
        })}
      </div>

      {episodeData?.finalJeopardy && (
        <div style={S.fjBar}>
          <div style={S.fjLabel}>FINAL JEOPARDY · <span style={{ color: '#f5c518' }}>{episodeData.finalJeopardy.category}</span></div>
          {fjAnswered
            ? <div style={{ fontSize: 12, color: fjAnswered === 'correct' ? '#7cd992' : '#e07070' }}>{fjAnswered === 'correct' ? '✓ Got it' : '✗ Missed'} <span style={{ color: '#4060a0' }}>(not in Coryat)</span></div>
            : <button style={S.fjBtn} onClick={onShowFJ}>⭐ Wager + Play Final J! →</button>}
        </div>
      )}

      <div style={S.legend}>
        {[['#4caf7d','Correct'],['#e57373','Incorrect'],['#7986cb','Pass'],['#f5c518','DD = excluded from Coryat']].map(([c,l]) => (
          <span key={l} style={S.legendItem}><span style={{ color: c }}>■</span> {l}</span>
        ))}
      </div>
    </div>
  )
}

// ─── Final Jeopardy Modal ─────────────────────────────────────────────────────
function FinalJeopardyModal({ fj, onAnswer, onClose }) {
  const [showAnswer, setShowAnswer] = useState(false)
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, borderColor: '#4dd0e1', boxShadow: '0 20px 60px rgba(77,208,225,0.15)' }} onClick={e => e.stopPropagation()}>
        <button style={S.closeX} onClick={onClose}>✕</button>
        <div style={{ fontSize: 10, letterSpacing: 4, color: '#4dd0e1', marginBottom: 4 }}>FINAL JEOPARDY</div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: '#4dd0e1', letterSpacing: 2, marginBottom: 16 }}>{fj.category}</div>
        <ClueText text={fj.clue} style={S.modalText} />
        <div style={{ fontSize: 11, color: '#6070a0', marginBottom: 12, letterSpacing: 1 }}>Not counted in Coryat score</div>
        {!showAnswer
          ? <button style={{ ...S.revealBtn, background: '#4dd0e1' }} onClick={() => setShowAnswer(true)}>Reveal Answer</button>
          : <>
              <div style={{ ...S.modalQ, borderColor: 'rgba(77,208,225,0.2)', background: 'rgba(77,208,225,0.06)', color: '#4dd0e1' }}>{fj.answer}</div>
              <div style={S.markRow}>
                <button style={{ ...S.markBtn, background: '#1a5c2e', color: '#7cd992', border: '1px solid #2e8c50' }} onClick={() => onAnswer('correct')}>✓ Got It</button>
                <button style={{ ...S.markBtn, background: '#5c1a1a', color: '#e07070', border: '1px solid #8c2e2e' }} onClick={() => onAnswer('incorrect')}>✗ Wrong</button>
              </div>
            </>}
      </div>
    </div>
  )
}

// ─── Resume Prompt ───────────────────────────────────────────────────────────
function ResumePrompt({ resumeData, onResume, onRestart, onDiscard }) {
  const meta = resumeData?.episodeMeta
  const savedAt = resumeData?.savedAt
    ? new Date(resumeData.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div style={S.overlay}>
      <div style={{ ...S.modal, maxWidth: 360 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: '#f5c518', letterSpacing: 3, marginBottom: 4 }}>
          RESUME GAME?
        </div>
        <div style={{ fontSize: 13, color: '#8890c0', lineHeight: 1.6, marginBottom: 16 }}>
          You have an unfinished game:
        </div>
        <div style={{ background: '#060b1a', borderRadius: 10, padding: '12px 14px', marginBottom: 20, border: '1px solid #1a2460' }}>
          <div style={{ fontSize: 14, color: '#c0c8e8', marginBottom: 4 }}>
            #{meta?.episodeNumber} · {meta?.airDate}
          </div>
          {savedAt && (
            <div style={{ fontSize: 11, color: '#4060a0', letterSpacing: 1 }}>
              Saved {savedAt}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button
            style={{ ...S.revealBtn, flex: 1 }}
            onClick={onResume}
          >
            Resume →
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            style={{ ...S.markBtn, background: '#1e2456', color: '#8890d0', border: '1px solid #2e3476', flex: 1 }}
            onClick={onRestart}
          >
            Restart
          </button>
          <button
            style={{ ...S.markBtn, background: '#1e1e1e', color: '#6070a0', border: '1px solid #2a2a2a', flex: 1 }}
            onClick={onDiscard}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Start Screen ────────────────────────────────────────────────────────────
function StartScreen({ board, episodeMeta, gameHistory, predictionBaseDate, onResetPredictionBase, onStart, onSkip }) {
  const [ratings, setRatings] = useState({})
  const [showConfidence, setShowConfidence] = useState(false)
  const categories = board?.categories?.map(c => c.name) || []
  const predictionHistory = predictionBaseDate
    ? gameHistory.filter(g => g.playedAt >= predictionBaseDate)
    : gameHistory
  const prediction = predictCoryat(predictionHistory, board)
  const LABELS = ['😬', '😐', '🙂', '😎']
  const LABEL_TEXT = ['Weak', 'OK', 'Good', 'Strong']

  return (
    <div style={S.overlay}>
      <div style={{ ...S.modal, maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: '#f5c518', letterSpacing: 3, marginBottom: 2 }}>
          READY TO PLAY?
        </div>
        <div style={{ fontSize: 11, color: '#6070a0', letterSpacing: 2, marginBottom: 16 }}>
          #{episodeMeta?.episodeNumber} · {episodeMeta?.airDate}
        </div>

        {/* Predicted Coryat */}
        {prediction && (
          <div style={{ background: '#060b1a', borderRadius: 10, padding: '12px 16px', marginBottom: 16, border: '1px solid #1a2040' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: '#6070a0' }}>PREDICTED CORYAT RANGE</div>
              <button
                style={{ fontSize: 9, color: '#4060a0', letterSpacing: 1 }}
                onClick={onResetPredictionBase}
                title="Reset prediction baseline to today"
              >
                Reset baseline
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 14, color: '#4060a0' }}>{prediction.low >= 0 ? '+' : ''}{prediction.low.toLocaleString()}</span>
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: '#f5c518' }}>{prediction.mid >= 0 ? '+' : ''}{prediction.mid.toLocaleString()}</span>
              <span style={{ fontSize: 14, color: '#4060a0' }}>{prediction.high >= 0 ? '+' : ''}{prediction.high.toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 10, color: '#4060a0', letterSpacing: 1, marginTop: 4 }}>Based on {gameHistory.length} games</div>
          </div>
        )}

        {/* Categories preview */}
        <div style={{ marginBottom: 16 }}>
          <button
            style={{ fontSize: 11, color: showConfidence ? '#f5c518' : '#4060a0', letterSpacing: 1, marginBottom: showConfidence ? 10 : 0, width: '100%', textAlign: 'left' }}
            onClick={() => setShowConfidence(!showConfidence)}
          >
            {showConfidence ? '▼' : '▶'} Rate your category confidence (optional)
          </button>

          {showConfidence && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {categories.map(cat => (
                <div key={cat}>
                  <div style={{ fontSize: 11, color: '#a0acd0', marginBottom: 4, letterSpacing: 1 }}>
                    {cat} <span style={{ color: '#4060a0', fontSize: 9 }}>· {getMetaCategory(cat)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {LABELS.map((emoji, i) => (
                      <button
                        key={i}
                        onClick={() => setRatings(r => ({ ...r, [cat]: i }))}
                        style={{
                          flex: 1, padding: '6px 2px', borderRadius: 6, fontSize: 16,
                          background: ratings[cat] === i ? 'rgba(245,197,24,0.15)' : 'rgba(255,255,255,0.04)',
                          border: ratings[cat] === i ? '1px solid #f5c518' : '1px solid #1a2460',
                          cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                        }}
                      >
                        <span>{emoji}</span>
                        <span style={{ fontSize: 7, color: ratings[cat] === i ? '#f5c518' : '#4060a0' }}>{LABEL_TEXT[i]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...S.markBtn, background: '#1e2456', color: '#8890d0', border: '1px solid #2e3476', flex: 1 }} onClick={onSkip}>
            Skip →
          </button>
          <button style={{ ...S.revealBtn, flex: 2, fontSize: 16 }} onClick={() => onStart(Object.keys(ratings).length > 0 ? ratings : null)}>
            Start Game! →
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Double Jeopardy Prompt ──────────────────────────────────────────────────
function DJPrompt({ singleCoryat, doubleBoard, onStart, onSkip }) {
  const [ratings, setRatings] = useState({})
  const [showConfidence, setShowConfidence] = useState(false)
  const categories = doubleBoard?.categories?.map(c => c.name) || []
  const LABELS = ['😬','😐','🙂','😎']
  const LABEL_TEXT = ['Weak','OK','Good','Strong']

  return (
    <div style={S.overlay}>
      <div style={{ ...S.modal, maxWidth: 420, maxHeight: '90vh', overflowY: 'auto', textAlign: 'center' }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: '#f5c518', letterSpacing: 3, marginBottom: 4 }}>
          SINGLE JEOPARDY COMPLETE!
        </div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: singleCoryat >= 0 ? '#4caf7d' : '#e57373', marginBottom: 16 }}>
          SJ Coryat: {singleCoryat >= 0 ? '+' : ''}{singleCoryat.toLocaleString()}
        </div>
        <div style={{ fontSize: 13, color: '#8890c0', lineHeight: 1.6, marginBottom: 16 }}>
          Ready for Double Jeopardy? Values double and there are two Daily Doubles.
        </div>

        {/* Optional DJ category confidence */}
        {categories.length > 0 && (
          <div style={{ marginBottom: 16, textAlign: 'left' }}>
            <button
              style={{ fontSize: 11, color: showConfidence ? '#f5c518' : '#4060a0', letterSpacing: 1, width: '100%', textAlign: 'left', marginBottom: showConfidence ? 10 : 0 }}
              onClick={() => setShowConfidence(!showConfidence)}
            >
              {showConfidence ? '▼' : '▶'} Rate your DJ category confidence (optional)
            </button>
            {showConfidence && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {categories.map(cat => (
                  <div key={cat}>
                    <div style={{ fontSize: 11, color: '#a0acd0', marginBottom: 4, letterSpacing: 1 }}>
                      {cat} <span style={{ color: '#4060a0', fontSize: 9 }}>· {getMetaCategory(cat)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {LABELS.map((emoji, i) => (
                        <button key={i} onClick={() => setRatings(r => ({ ...r, [cat]: i }))}
                          style={{ flex: 1, padding: '5px 2px', borderRadius: 6, fontSize: 14,
                            background: ratings[cat] === i ? 'rgba(245,197,24,0.15)' : 'rgba(255,255,255,0.04)',
                            border: ratings[cat] === i ? '1px solid #f5c518' : '1px solid #1a2460',
                            cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                          <span>{emoji}</span>
                          <span style={{ fontSize: 7, color: ratings[cat] === i ? '#f5c518' : '#4060a0' }}>{LABEL_TEXT[i]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...S.markBtn, background: '#1e2456', color: '#8890d0', border: '1px solid #2e3476', flex: 1 }} onClick={onSkip}>
            Skip DJ
          </button>
          <button style={{ ...S.revealBtn, flex: 2, fontSize: 16 }} onClick={() => onStart(Object.keys(ratings).length > 0 ? ratings : null)}>
            Play Double J! →
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Episode Cache Manager ────────────────────────────────────────────────────
function EpisodeCacheManager({ onLoadEpisode, onClose }) {
  const [stats, setStats] = useState(() => getCacheStats())
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [caching, setCaching] = useState(false)
  const [cacheProgress, setCacheProgress] = useState('')

  // Asking for a range is an explicit request to keep those episodes, so they are pinned.
  // Unpinned entries are capped at ten and evicted oldest-first, so the old unpinned save
  // meant a range of fifty fetched fifty episodes, discarded forty, and kept whichever ten
  // happened to finish last — while telling the user it had cached the range.
  const MAX_RANGE = 60
  const cancelCache = useRef(false)

  async function cacheRange() {
    const start = parseInt(rangeStart)
    const end = parseInt(rangeEnd)
    if (!start || !end || start > end) return
    if (end - start + 1 > MAX_RANGE) {
      alert(`That's ${end - start + 1} episodes. Cache at most ${MAX_RANGE} at a time — each one is a separate request to j-archive.`)
      return
    }
    cancelCache.current = false
    setCaching(true)
    let saved = 0, failed = 0
    for (let id = start; id <= end; id++) {
      if (cancelCache.current) break
      setCacheProgress(`Caching ${id}… (${saved} saved${failed ? `, ${failed} unavailable` : ''})`)
      try {
        const episode = await fetchEpisode(String(id))
        saveEpisodeToCache(String(id), episode, true) // pinned — this was asked for
        saved++
      } catch { failed++ }
      await new Promise(r => setTimeout(r, 300)) // be polite to j-archive
    }
    setCaching(false)
    setCacheProgress('')
    setStats(getCacheStats())
    alert(cancelCache.current
      ? `Stopped. ${saved} episode${saved !== 1 ? 's' : ''} cached.`
      : `Cached ${saved} episode${saved !== 1 ? 's' : ''}${failed ? `, ${failed} unavailable` : ''}.`)
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 440, maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <button style={S.closeX} onClick={onClose}>✕</button>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: '#f5c518', letterSpacing: 2, marginBottom: 4 }}>
          📥 OFFLINE CACHE
        </div>
        <div style={{ fontSize: 11, color: '#6070a0', marginBottom: 16 }}>
          {stats.total} episodes cached · {stats.sizeKB}KB · {stats.pinned} pinned
        </div>

        {/* Cache range */}
        <div style={{ fontSize: 9, color: '#6070a0', letterSpacing: 3, marginBottom: 6 }}>
          CACHE EPISODE RANGE <span style={{ letterSpacing: 1, textTransform: 'none' }}>· up to {MAX_RANGE}, kept until you remove them</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input style={{ ...S.input, flex: 1 }} value={rangeStart} onChange={e => setRangeStart(e.target.value)} placeholder="From (e.g. 9150)" type="number" disabled={caching} />
          <input style={{ ...S.input, flex: 1 }} value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} placeholder="To (e.g. 9160)" type="number" disabled={caching} />
          {caching
            ? <button style={{ ...S.loaderBtn, color: '#e57373', borderColor: 'rgba(229,115,115,0.3)', background: 'rgba(229,115,115,0.08)' }} onClick={() => { cancelCache.current = true }}>Stop</button>
            : <button style={S.loaderBtn} onClick={cacheRange}>Cache</button>}
        </div>
        {cacheProgress && <div style={{ fontSize: 12, color: '#f5c518', marginBottom: 8 }}>{cacheProgress}</div>}

        {/* Episode list */}
        {stats.episodes.length === 0 ? (
          <div style={{ color: '#6070a0', fontSize: 13, textAlign: 'center', padding: 20 }}>No cached episodes yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stats.episodes.map(ep => (
              <div key={ep.episodeId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #1a2040' }}>
                <button onClick={() => { onLoadEpisode(ep.episodeId); onClose() }} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}>
                  <div style={{ fontSize: 13, color: '#c0c8e8' }}>#{ep.episodeNumber || ep.episodeId} · {ep.airDate}</div>
                </button>
                <button
                  style={{ fontSize: 14, color: ep.pinned ? '#f5c518' : '#4060a0' }}
                  onClick={() => { ep.pinned ? unpinEpisode(ep.episodeId) : pinEpisode(ep.episodeId); setStats(getCacheStats()) }}
                  title={ep.pinned ? 'Unpin' : 'Pin (won&apos;t be auto-removed)'}
                >
                  {ep.pinned ? '📌' : '📍'}
                </button>
                <button style={{ fontSize: 14, color: '#e57373' }} onClick={() => { removeEpisodeFromCache(ep.episodeId); setStats(getCacheStats()) }}>🗑</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Category Search ──────────────────────────────────────────────────────────
function CategorySearch({ onSelect, onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function search() {
    if (!query.trim()) return
    setLoading(true); setError(null)
    try {
      const episodes = await searchEpisodesByCategory(query.trim())
      setResults(episodes)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={S.browserHeader}>
          <div style={S.browserTitle}>🔍 SEARCH BY CATEGORY</div>
          <button style={S.closeX} onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #1a2040', display: 'flex', gap: 8 }}>
          <input
            style={{ ...S.loaderInput, flex: 1 }}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="e.g. Opera, Potent Potables, Nonfiction..."
            autoFocus
          />
          <button style={S.loaderBtn} onClick={search} disabled={loading}>
            {loading ? '⏳' : 'Search'}
          </button>
        </div>
        <div style={S.browserList}>
          {error && <div style={{ ...S.loadError, margin: 12 }}>{error}</div>}
          {!loading && results.length === 0 && query && !error && (
            <div style={S.browserLoading}>No episodes found for "{query}"</div>
          )}
          {!loading && results.length === 0 && !query && (
            <div style={S.browserLoading}>Search for any Jeopardy category name to find episodes that featured it.</div>
          )}
          {results.map((ep, i) => (
            <button key={`${ep.gameId}-${i}`} style={S.episodeRow} onClick={() => onSelect(ep.gameId)}>
              <span style={S.epDate}>{ep.airDate}</span>
              <span style={{ fontSize: 10, color: '#4060a0' }}>#{ep.gameId}</span>
              <span style={S.epArrow}>▶</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Episode Browser Modal ────────────────────────────────────────────────────
function EpisodeBrowser({ onSelect, onClose, currentEpisodeId, playedIndex, lastPlayedGameId }) {
  const [episodes, setEpisodes] = useState([])
  const [seasons, setSeasons] = useState([])
  const [selectedSeason, setSelectedSeason] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const searchTimeout = useRef(null)

  useEffect(() => { fetchEps() }, [])
  // No truthiness guard: "Latest season" is the empty string, and fetchEps already reads
  // that as "latest". Guarding on it meant picking Latest after choosing a season was a
  // no-op, leaving the old season's episodes on screen under the new label.
  const firstLoad = useRef(true)
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return } // the mount effect covers this
    fetchEps(selectedSeason, search)
  }, [selectedSeason])

  async function fetchEps(season = '', q = '') {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams()
      if (season) params.set('season', season)
      if (q) params.set('search', q)
      const res = await fetch(`/.netlify/functions/episodes?${params}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setEpisodes(data.episodes || [])
      if (data.seasons?.length && !seasons.length) setSeasons(data.seasons)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleSearch(val) {
    setSearch(val)
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => fetchEps(selectedSeason, val), 500)
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={S.browserHeader}>
          <div style={S.browserTitle}>📺 BROWSE EPISODES</div>
          <button style={S.closeX} onClick={onClose}>✕</button>
        </div>
        <div style={S.browserControls}>
          <input style={{ ...S.loaderInput, flex: 1 }} value={search} onChange={e => handleSearch(e.target.value)} placeholder="Search by show # or date..." />
          <select style={S.seasonSelect} value={selectedSeason} onChange={e => setSelectedSeason(e.target.value)}>
            <option value="">Latest season</option>
            {seasons.filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        {!loading && !error && episodes.length > 0 && (() => {
          const playedHere = episodes.filter(ep => findPlayed(playedIndex, ep)).length
          return (
            <div style={S.browserCount}>
              <span>{episodes.length} episode{episodes.length !== 1 ? 's' : ''}</span>
              <span style={{ color: playedHere ? '#4caf7d' : '#3a4570' }}>
                ✓ {playedHere} played
              </span>
            </div>
          )
        })()}
        <div style={S.browserList}>
          {loading && <div style={S.browserLoading}>⏳ Loading episodes...</div>}
          {error && <div style={{ ...S.loadError, margin: 12 }}>{error}</div>}
          {!loading && !error && episodes.length === 0 && <div style={S.browserLoading}>No episodes found</div>}
          {!loading && episodes.map((ep, i) => {
            const id = String(ep.gameId)
            const isCurrent = id === String(currentEpisodeId)
            const played = findPlayed(playedIndex, ep)
            const isLastPlayed = id === lastPlayedGameId
            return (
              <button key={ep.gameId} style={{
                ...S.episodeRow,
                background: isCurrent ? 'rgba(245,197,24,0.08)' : played ? 'rgba(76,175,125,0.045)' : undefined,
                borderLeft: isCurrent ? '2px solid #f5c518' : isLastPlayed ? '2px solid #4caf7d' : '2px solid transparent',
              }} onClick={() => onSelect(ep.gameId, episodes, i)}>
                <span style={{ width: 16, textAlign: 'center', fontSize: 11, flexShrink: 0, color: isCurrent ? '#f5c518' : '#4caf7d' }}>
                  {isCurrent ? '▶' : played ? '✓' : ''}
                </span>
                <span style={{ ...S.epDate, color: played && !isCurrent ? '#7a89b4' : S.epDate.color }}>{ep.airDate}</span>
                {played && (
                  <span style={S.epScore} title={`Coryat ${played.coryatScore?.toLocaleString() ?? '—'}`}>
                    ${played.coryatScore?.toLocaleString() ?? '—'}
                  </span>
                )}
                <span style={{ fontSize: 10, color: '#4060a0' }}>#{ep.gameId}</span>
                <span style={S.epArrow}>▶</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Clue Text renderer ──────────────────────────────────────────────────────
// Replaces j-archive media links with inline images
function ClueText({ text, style }) {
  if (!text) return null

  // Check for j-archive media links: <a href="...j-archive.com/media/...">here</a>
  const mediaRegex = /https:\/\/(?:www\.)?j-archive\.com\/media\/[^\s"'>]+\.(jpg|jpeg|png|gif|mp4|mp3)/gi
  const hasMedia = mediaRegex.test(text)
  // Also check for plain anchor tags wrapping media URLs
  const hasAnchor = text.includes('j-archive.com/media/')

  if (!hasAnchor) {
    return <div style={style}>{text}</div>
  }

  // Extract all media URLs from anchor tags
  const parts = []
  let remaining = text
  const anchorRegex = /<a[^>]+href="(https?:\/\/(?:www\.)?j-archive\.com\/media\/[^"]+)"[^>]*>[^<]*<\/a>/gi
  let match
  let lastIndex = 0
  const plainText = text.replace(/<[^>]+>/g, '') // strip all HTML for plain display

  // Parse anchor tags and replace with images
  const anchorPattern = /<a[^>]+href="(https?:\/\/(?:www\.)?j-archive\.com\/media\/([^"]+))"[^>]*>([^<]*)<\/a>/gi
  const segments = []
  let lastEnd = 0
  let m

  // Use a simpler approach - regex on the raw text
  const urlPattern = /https?:\/\/(?:www\.)?j-archive\.com\/media\/\S+\.(?:jpg|jpeg|png|gif)/gi
  const urls = []
  let urlMatch
  while ((urlMatch = urlPattern.exec(text)) !== null) {
    urls.push(urlMatch[0])
  }

  // Strip HTML tags to get clean clue text
  const cleanText = text
    .replace(/<a[^>]+href="(https?:\/\/j-archive[^"]+)"[^>]*>[^<]*<\/a>/gi, '') // remove media links
    .replace(/<a[^>]+href="(https?:\/\/www\.j-archive[^"]+)"[^>]*>[^<]*<\/a>/gi, '')
    .replace(/<[^>]+>/g, '') // strip remaining HTML
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .trim()

  return (
    <div style={style}>
      {urls.length > 0 && (
        <div style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
          {urls.map((url, i) => (
            <ImageWithFallback key={i} url={url} />
          ))}
        </div>
      )}
      <span>{cleanText}</span>
    </div>
  )
}

function ImageWithFallback({ url }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={url}
      alt="Clue image"
      style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8, objectFit: 'contain' }}
      onError={() => setFailed(true)}
    />
  )
}

// ─── Timed Clue Modal ────────────────────────────────────────────────────────
// Phases: reading → buzzing → answering → reveal
// largeFont/fontSettings are read in the clue text style below. They were used there
// without being declared, which threw a ReferenceError on every render — and since the
// only error boundary is at the root, opening a clue in Timed Mode took the whole app
// down rather than just the modal.
function TimedClueModal({ clue, category, onMark, onClose, largeFont, fontSettings }) {
  // Calculate reading time: ~200ms per word, min 3s max 8s
  const wordCount = clue.answer.split(/\s+/).length
  const readingMs = Math.min(Math.max(wordCount * 200, 3000), 8000)
  const buzzMs = 5000
  const answerMs = 5000

  const [phase, setPhase] = useState('reading') // reading | buzzing | answering | committed | reveal
  const [result, setResult] = useState(null) // correct | incorrect | pass | timeout
  const [committed, setCommitted] = useState(null) // 'know' | 'dontknow' — what player claimed before seeing answer
  const [elapsed, setElapsed] = useState(0)
  const [phaseStart, setPhaseStart] = useState(Date.now())
  const intervalRef = useRef(null)
  const phaseRef = useRef('reading')
  const phaseStartRef = useRef(Date.now())
  // Time from the buzz window opening to the buzz. Stays null when the window was
  // missed or skipped — that is not a reaction time, and averaging it in would be a lie.
  const buzzMsRef = useRef(null)

  const phaseDuration = phase === 'reading' ? readingMs : phase === 'buzzing' ? buzzMs : phase === 'answering' ? answerMs : 1

  useEffect(() => {
    phaseRef.current = phase
    phaseStartRef.current = Date.now()
    setPhaseStart(Date.now())
    setElapsed(0)

    intervalRef.current = setInterval(() => {
      const now = Date.now()
      const el = now - phaseStartRef.current
      setElapsed(el)

      const dur = phaseRef.current === 'reading' ? readingMs
                : phaseRef.current === 'buzzing' ? buzzMs
                : answerMs

      if (el >= dur) {
        clearInterval(intervalRef.current)
        if (phaseRef.current === 'reading') {
          phaseRef.current = 'buzzing'
          setPhase('buzzing')
        } else if (phaseRef.current === 'buzzing') {
          // Missed buzz — auto pass
          phaseRef.current = 'reveal'
          setResult('pass')
          setPhase('reveal')
        } else if (phaseRef.current === 'answering') {
          // Ran out of answer time — wrong
          phaseRef.current = 'reveal'
          setResult('incorrect')
          setPhase('reveal')
        }
      }
    }, 50)

    return () => clearInterval(intervalRef.current)
  }, [phase])

  // When we hit reveal phase, call onMark after a short delay
  useEffect(() => {
    if (phase === 'reveal' && result) {
      // Don't auto-close — let user see the answer and tap Done
    }
  }, [phase, result])

  function buzzIn() {
    if (phase !== 'buzzing') return
    buzzMsRef.current = Date.now() - phaseStartRef.current
    // Haptic feedback via Vibration API (works on iOS Safari PWA)
    if (navigator.vibrate) navigator.vibrate(60)
    clearInterval(intervalRef.current)
    setPhase('answering')
  }

  // Listen for keyboard / Bluetooth clicker events during buzz window
  // Bluetooth selfie remotes typically send Space, Enter, or ArrowUp/VolumeUp
  useEffect(() => {
    function handleKey(e) {
      const buzzKeys = [' ', 'Enter', 'ArrowUp', 'ArrowDown', 'MediaPlayPause']
      if (buzzKeys.includes(e.key) && phase === 'buzzing') {
        e.preventDefault()
        buzzIn()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [phase])

  function submitResult(r) {
    // Short buzz for correct, double buzz for wrong
    if (navigator.vibrate) {
      navigator.vibrate(r === 'correct' ? 40 : [40, 60, 40])
    }
    setResult(r)
    setPhase('reveal')
    clearInterval(intervalRef.current)
  }

  function handleDone() {
    onMark(result, false, buzzMsRef.current == null ? null : { buzzMs: buzzMsRef.current })
  }

  const progress = Math.min(elapsed / phaseDuration, 1)
  const timeLeft = Math.max(0, Math.ceil((phaseDuration - elapsed) / 1000))

  const phaseColor = phase === 'reading' ? '#4060a0'
                   : phase === 'buzzing' ? '#f5c518'
                   : phase === 'answering' ? '#4caf7d'
                   : '#8890c0'

  const phasLabel = phase === 'reading' ? 'READ THE CLUE'
                  : phase === 'buzzing' ? `BUZZ IN — ${timeLeft}s`
                  : phase === 'answering' ? `ANSWER — ${timeLeft}s`
                  : phase === 'committed' ? 'REVEAL'
                  : 'RESULT'

  return (
    <div style={S.overlay} onClick={phase === 'reveal' ? undefined : undefined}>
      <div style={{ ...S.modal, borderColor: phaseColor, boxShadow: `0 20px 60px ${phaseColor}22` }} onClick={e => e.stopPropagation()}>

        {/* Phase label + timer bar */}
        <div style={{ fontSize: 10, letterSpacing: 3, color: phaseColor, marginBottom: 8 }}>{phasLabel}</div>
        {phase !== 'reveal' && phase !== 'committed' && (
          <div style={{ width: '100%', height: 4, background: '#1a2040', borderRadius: 99, marginBottom: 16, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 99,
              background: phaseColor,
              width: `${(1 - progress) * 100}%`,
              transition: 'width 0.05s linear',
              ...(phase === 'buzzing' ? { animation: 'pulse 0.5s ease-in-out infinite alternate' } : {})
            }} />
          </div>
        )}

        {/* Category + value */}
        <div style={S.modalCat}>{category}</div>
        <div style={S.modalVal}>${clue.value.toLocaleString()}</div>
        {clue.isDailyDouble && <div style={S.ddBadge}>⭐ DAILY DOUBLE</div>}

        {/* Clue text */}
        <ClueText text={clue.answer} style={{ ...S.modalText, ...fontOverride(largeFont, fontSettings, { size: 22, weight: 600, lineHeight: 1.5 }) }} />

        {/* Phase-specific controls */}
        {phase === 'reading' && (
          <div style={{ fontSize: 12, color: '#4060a0', letterSpacing: 2, marginTop: 8 }}>
            Buzz window opens in {timeLeft}s...
          </div>
        )}

        {phase === 'buzzing' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <button
              style={{ ...S.revealBtn, background: '#f5c518', fontSize: 18, padding: '16px 40px', letterSpacing: 3 }}
              onClick={buzzIn}
            >
              BUZZ IN!
            </button>
            <button
              style={{ fontSize: 11, color: '#4060a0', letterSpacing: 2 }}
              onClick={() => {
                clearInterval(intervalRef.current)
                setResult('pass')
                setPhase('reveal')
              }}
            >
              Skip (I don&apos;t know)
            </button>
          </div>
        )}

        {phase === 'answering' && (
          <>
            <div style={{ fontSize: 12, color: '#7cd992', letterSpacing: 2, marginBottom: 16 }}>
              Do you have the answer?
            </div>
            <div style={S.markRow}>
              <button
                style={{ ...S.markBtn, background: '#1a5c2e', color: '#7cd992', border: '1px solid #2e8c50', fontSize: 15, padding: '14px 0' }}
                onClick={() => {
                  clearInterval(intervalRef.current)
                  setCommitted('know')
                  setPhase('committed')
                }}
              >
                ✓ I know it
              </button>
              <button
                style={{ ...S.markBtn, background: '#5c1a1a', color: '#e07070', border: '1px solid #8c2e2e', fontSize: 15, padding: '14px 0' }}
                onClick={() => {
                  clearInterval(intervalRef.current)
                  setCommitted('dontknow')
                  submitResult('incorrect')
                }}
              >
                ✗ I don&apos;t know
              </button>
            </div>
          </>
        )}

        {/* Committed — reveal the answer, then confirm */}
        {phase === 'committed' && (
          <>
            <div style={{ fontSize: 11, color: committed === 'know' ? '#7cd992' : '#8890c0', letterSpacing: 2, marginBottom: 10 }}>
              {committed === 'know' ? 'You said you know it. The answer was:' : 'You passed. The answer was:'}
            </div>
            <div style={S.modalQ}>{clue.question}</div>
            {committed === 'know' ? (
              <>
                <div style={{ fontSize: 11, color: '#6070a0', marginBottom: 16, letterSpacing: 1 }}>
                  Were you right?
                </div>
                <div style={S.markRow}>
                  <button
                    style={{ ...S.markBtn, background: '#1a5c2e', color: '#7cd992', border: '1px solid #2e8c50', fontSize: 15, padding: '14px 0' }}
                    onClick={() => submitResult('correct')}
                  >
                    ✓ Got it right
                  </button>
                  <button
                    style={{ ...S.markBtn, background: '#5c1a1a', color: '#e07070', border: '1px solid #8c2e2e', fontSize: 15, padding: '14px 0' }}
                    onClick={() => submitResult('incorrect')}
                  >
                    ✗ Got it wrong
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 11, color: '#6070a0', marginBottom: 16, letterSpacing: 1 }}>Added to your flashcard deck</div>
                <button style={S.revealBtn} onClick={() => submitResult('incorrect')}>Done</button>
              </>
            )}
          </>
        )}

        {phase === 'reveal' && (
          <>
            {/* Result banner */}
            <div style={{
              fontSize: 13, fontWeight: 700, letterSpacing: 2, padding: '8px 16px', borderRadius: 8, marginBottom: 12,
              color: result === 'correct' ? '#7cd992' : result === 'pass' ? '#8890d0' : '#e07070',
              background: result === 'correct' ? 'rgba(124,217,146,0.1)' : result === 'pass' ? 'rgba(136,144,208,0.1)' : 'rgba(224,112,112,0.1)',
            }}>
              {result === 'correct' ? '✓ CORRECT' : result === 'pass' ? '— MISSED BUZZ' : '✗ INCORRECT'}
              {committed === 'dontknow' && result === 'incorrect' && (
                <span style={{ fontSize: 10, color: '#6070a0', marginLeft: 8 }}>(didn&apos;t know)</span>
              )}
            </div>

            {/* Always show the answer */}
            {(result === 'pass' || committed === 'dontknow') && (
              <div style={{ fontSize: 11, color: '#8890c0', marginBottom: 8 }}>The correct response was:</div>
            )}
            <div style={S.modalQ}>{clue.question}</div>
            {(result === 'incorrect' || result === 'pass') && (
              <div style={{ fontSize: 11, color: '#6070a0', marginBottom: 12, letterSpacing: 1 }}>Added to your flashcard deck</div>
            )}

            <button style={S.revealBtn} onClick={handleDone}>Done</button>
          </>
        )}
      </div>
      <style>{`@keyframes pulse { from { opacity: 1; } to { opacity: 0.5; } }`}</style>
    </div>
  )
}

// ─── Clue Modal ───────────────────────────────────────────────────────────────
function ClueModal({ clue, category, showAnswer, onReveal, onMark, onClose, isReanswer, previousResult, largeFont, fontSettings }) {
  const [skipDeck, setSkipDeck] = useState(false)
  const prevColors = { correct: '#4caf7d', incorrect: '#e57373', pass: '#7986cb' }
  const prevLabels = { correct: '✓ Correct', incorrect: '✗ Wrong', pass: '— Pass' }
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <button style={S.closeX} onClick={onClose}>✕</button>
        <div style={S.modalCat}>{category}</div>
        <div style={S.modalVal}>${clue.value.toLocaleString()}</div>
        {clue.isDailyDouble && <div style={S.ddBadge}>⭐ DAILY DOUBLE</div>}
        {isReanswer && previousResult && (
          <div style={{ fontSize: 10, letterSpacing: 2, color: prevColors[previousResult], marginBottom: 4, background: `${prevColors[previousResult]}18`, borderRadius: 6, padding: '3px 10px', display: 'inline-block' }}>
            Previously: {prevLabels[previousResult]} — change answer?
          </div>
        )}
        <ClueText text={clue.answer} style={{ ...S.modalText, ...fontOverride(largeFont, fontSettings, { size: 22, weight: 600, lineHeight: 1.5 }) }} />
        {!showAnswer
          ? <button style={S.revealBtn} onClick={onReveal}>Reveal Answer</button>
          : <>
              <div style={{ ...S.modalQ, ...fontOverride(largeFont, fontSettings, { size: 20, weight: 600 }) }}>{clue.question}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 8 }}>
                <button
                  onClick={() => setSkipDeck(s => !s)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 11, color: skipDeck ? '#e57373' : '#4060a0',
                    background: 'none', border: 'none', cursor: 'pointer', letterSpacing: 1,
                  }}
                >
                  <div style={{
                    width: 14, height: 14, borderRadius: 3,
                    border: `1px solid ${skipDeck ? '#e57373' : '#2a3460'}`,
                    background: skipDeck ? '#e57373' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: '#fff',
                  }}>
                    {skipDeck ? '✓' : ''}
                  </div>
                  Don't add to deck
                </button>
              </div>
              <div style={S.markRow}>
                <button style={{ ...S.markBtn, background: '#1a5c2e', color: '#7cd992', border: '1px solid #2e8c50' }} onClick={() => onMark('correct', skipDeck)}>✓ Got It</button>
                <button style={{ ...S.markBtn, background: '#5c1a1a', color: '#e07070', border: '1px solid #8c2e2e' }} onClick={() => onMark('incorrect', skipDeck)}>✗ Wrong</button>
                <button style={{ ...S.markBtn, background: '#1e2456', color: '#8890d0', border: '1px solid #2e3476' }} onClick={() => onMark('pass', skipDeck)}>— Pass</button>
              </div>
            </>}
      </div>
    </div>
  )
}

// ─── Study View ───────────────────────────────────────────────────────────────
function StudyView({ cards, setCards, onBack, dailyCards, setDailyCards, gameHistory = [], onSessionChange }) {
  const CHUNK_PRESETS = { quick: 10, standard: 20, long: 40, marathon: 100 }
  const DEFAULT_CHUNK = 'marathon'

  const [phase, setPhase] = useState('configure') // configure | session | chunkdone
  const [sessionCards, setSessionCards] = useState([])   // all cards for this run
  const [allChunks, setAllChunks] = useState([])         // pre-split chunks
  const [chunkIdx, setChunkIdx] = useState(0)            // which chunk we're on
  const [cardIdx, setCardIdx] = useState(0)              // card within current chunk
  const [flipped, setFlipped] = useState(false)
  const [sessionStats, setSessionStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 })
  const [chunkStats, setChunkStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 })
  const [chunkPreset, setChunkPreset] = useState(DEFAULT_CHUNK)
  const [customChunk, setCustomChunk] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [editingCard, setEditingCard] = useState(null) // card being edited in-session
  const [confirmDeleteStudy, setConfirmDeleteStudy] = useState(null) // card id pending delete
  const [lastRating, setLastRating] = useState(null) // one level of undo for a misgrade
  // Typed answers: self-grading quietly inflates retention, because recognising an
  // answer feels like recalling it. Typing removes that bias.
  const [typedMode, setTypedMode] = useState(() => localStorage.getItem('jeo-typed-answers') === '1')
  const [typed, setTyped] = useState('')
  const [typedResult, setTypedResult] = useState(null) // 'correct' | 'incorrect'
  const answerInputRef = useRef(null)
  // Retrieval timing, measured silently. Starts when the card appears; the reading
  // grace is subtracted in recallMs so this is recall speed, not reading speed.
  const [shownAt, setShownAt] = useState(() => Date.now())
  const [elapsedMs, setElapsedMs] = useState(null)
  const [editFront, setEditFront] = useState('')
  const [editBack, setEditBack] = useState('')

  // Filter state
  const [dueFilter, setDueFilter] = useState('due') // 'all' | 'due' | 'today' | 'overdue'
  const [sourceFilter, setSourceFilter] = useState('all') // 'all' | 'drills' | 'board'
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [strugglingOnly, setStrugglingOnly] = useState(false)

  const now = Date.now()

  // A session in progress is entirely in-memory state, so an automatic reload loses it.
  useEffect(() => {
    onSessionChange?.(phase === 'session')
    return () => onSessionChange?.(false)
  }, [phase, onSessionChange])

  // Every count on this screen must describe the same set the session will actually draw
  // from. getFilteredCards drops quarantined cards; the forecast and the filter labels
  // did not, so with cards in quarantine the screen promised more than it delivered.
  const studiable = useMemo(() => cards.filter(c => !isSuspended(c)), [cards])

  const allMetaCategories = [...new Set(cards
    .filter(c => c.category)
    .map(c => getMetaCategory(c.category.split(' · ')[0] || c.category))
  )].sort()

  function getFilteredCards() {
    // Quarantined cards are excluded from every session until released or rewritten.
    let filtered = studiable
    const todayStartF = new Date().setHours(0, 0, 0, 0)
    const todayEndF = new Date().setHours(23, 59, 59, 999)
    if (dueFilter === 'due') filtered = filtered.filter(c => c.dueAt <= todayEndF)
    else if (dueFilter === 'today') filtered = filtered.filter(c => c.dueAt >= todayStartF && c.dueAt <= todayEndF)
    else if (dueFilter === 'overdue') filtered = filtered.filter(c => c.dueAt < todayStartF)
    const DRILL_CATS = ['US Presidents','US States','Geography','Astronomy','Shakespeare','Famous Authors','Famous Painters','Classical Composers','Famous Ballets','Greek & Latin Roots','US Vice Presidents']
    if (sourceFilter === 'drills') filtered = filtered.filter(c => c.id?.startsWith('drill-') || DRILL_CATS.some(cat => c.category?.includes(cat)))
    else if (sourceFilter === 'leeches') filtered = filtered.filter(c => (c.lapses || 0) >= LEECH_LAPSES)
    else if (sourceFilter === 'board') filtered = filtered.filter(c => !c.id?.startsWith('drill-') && c.source !== 'manual' && c.source !== 'anki')
    else if (sourceFilter !== 'all') filtered = filtered.filter(c => c.source === sourceFilter)
    // lapses is a lifetime count, so >= 2 keeps this meaning "actively problematic"
    // rather than "missed once at some point".
    if (strugglingOnly === true) filtered = filtered.filter(c => c.repetitions === 0 || (c.lapses || 0) >= 2)
    if (strugglingOnly === 'hard') filtered = filtered.filter(c => c.easeFactor < 2.0 && c.repetitions > 0)
    if (categoryFilter !== 'all') filtered = filtered.filter(c => getMetaCategory(c.category?.split(' · ')[0] || c.category || '') === categoryFilter)
    return filtered
  }

  // The heat map already knows where board play is weakest; this closes the loop by
  // turning that into a session. Only categories with cards are offered — pointing at
  // a weak category with nothing to review would be a dead end.
  const weakest = useMemo(() => {
    if (gameHistory.length < 3) return null
    const withCards = new Set(allMetaCategories)
    const ranked = buildCategoryHeatMap(gameHistory).filter(m => withCards.has(m.meta))
    return ranked.length ? ranked[0] : null // heat map is sorted worst-average first
  }, [gameHistory, allMetaCategories.join('|')])

  const matchingCards = getFilteredCards()
  const todayEndSv = new Date().setHours(23, 59, 59, 999)
  const dueCount = studiable.filter(c => c.dueAt <= todayEndSv).length

  function getChunkSize() {
    if (showCustom && customChunk) return Math.max(1, parseInt(customChunk) || 20)
    if (chunkPreset === 'adaptive') return matchingCards.length || 1
    return CHUNK_PRESETS[chunkPreset] || 100
  }

  function buildChunks(cardList, size) {
    const chunks = []
    for (let i = 0; i < cardList.length; i += size) {
      chunks.push(cardList.slice(i, i + size))
    }
    return chunks
  }

  function startSession() {
    const sessionOrder = shuffled(matchingCards)
    const size = getChunkSize()
    const chunks = buildChunks(sessionOrder, size)
    setAllChunks(chunks)
    setSessionCards(sessionOrder)
    setChunkIdx(0)
    setCardIdx(0)
    setFlipped(false)
    setSessionStats({ again: 0, hard: 0, good: 0, easy: 0 })
    setChunkStats({ again: 0, hard: 0, good: 0, easy: 0 })
    setLastRating(null)
    setTyped('')
    setTypedResult(null)
    setElapsedMs(null)
    setShownAt(Date.now())
    setPhase('session')
  }

  function rate(quality, label) {
    const currentChunk = allChunks[chunkIdx] || []
    const card = currentChunk[cardIdx]
    if (!card) return
    // Snapshot the card's schedule before sm2 rewrites it. A misgrade otherwise costs
    // that card's interval permanently, with no way back.
    setLastRating({ card, label, cardIdx, chunkIdx, phaseBefore: phase })
    // Judge "was this already learned" from the card as it stands, before sm2
    // rewrites repetitions — afterwards the answer is always yes.
    logReview(quality, (card.repetitions || 0) > 0, elapsedMs)
    setCards(prev => prev.map(c => {
      if (c.id !== card.id) return c
      const rated = rateCard(card, quality)
      // Eight failures is a bad card, not a hard one. Suspend it here rather than
      // letting it keep resurfacing every day and crowding out learnable material.
      return shouldQuarantine(rated) ? suspendCard(rated) : rated
    }))
    setSessionStats(prev => ({ ...prev, [label]: prev[label] + 1 }))
    setChunkStats(prev => ({ ...prev, [label]: prev[label] + 1 }))
    const nextCard = cardIdx + 1
    setDailyCards(incrementDailyCards(1))
    if (nextCard >= currentChunk.length) {
      setPhase('chunkdone')
    } else {
      setCardIdx(nextCard)
      setFlipped(false)
      setTyped('')
      setTypedResult(null)
      setElapsedMs(null)
      setShownAt(Date.now())
    }
  }

  function submitTyped() {
    const card = (allChunks[chunkIdx] || [])[cardIdx]
    if (!card || !typed.trim()) return
    if (elapsedMs == null) setElapsedMs(recallMs(shownAt))
    setTypedResult(matchesAnswer(typed, card.back) ? 'correct' : 'incorrect')
    setFlipped(true) // reveal so the grade is made against the real answer
  }

  // Tapping the card reveals it; that tap is the end of the retrieval attempt.
  function toggleFlip() {
    if (!flipped && elapsedMs == null) setElapsedMs(recallMs(shownAt))
    setFlipped(f => !f)
  }

  // Restore the card exactly as it was, rewind the counters, and return to it.
  function undoLastRating() {
    if (!lastRating) return
    const { card, label, cardIdx: idx, chunkIdx: cidx, phaseBefore } = lastRating
    setCards(prev => prev.map(c => (c.id === card.id ? card : c)))
    removeLastReview() // keep the retention log honest about what actually happened
    setSessionStats(prev => ({ ...prev, [label]: Math.max(0, prev[label] - 1) }))
    setChunkStats(prev => ({ ...prev, [label]: Math.max(0, prev[label] - 1) }))
    setDailyCards(incrementDailyCards(-1))
    setChunkIdx(cidx)
    setCardIdx(idx)
    setPhase(phaseBefore)
    setFlipped(true) // they were looking at the answer when they graded it
    setTyped('')
    setTypedResult(null)
    setElapsedMs(null)
    setLastRating(null)
  }

  const currentChunk = allChunks[chunkIdx] || []
  const totalChunks = allChunks.length
  const chunksRemaining = totalChunks - chunkIdx - 1
  const totalDone = allChunks.slice(0, chunkIdx).reduce((s, c) => s + c.length, 0) + (phase === 'chunkdone' ? currentChunk.length : cardIdx)

  // ── Configure screen ──────────────────────────────────────────────────────
  if (phase === 'configure') return (
    <div style={S.studyLanding}>
      {onBack && <button style={{ fontSize: 12, color: '#4060a0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', marginBottom: 8, display: 'block' }} onClick={onBack}>← Back</button>}
      <div style={S.studyIcon}>🔁</div>
      <div style={S.studyTitle}>STUDY SESSION</div>

      {/* 3-day forecast */}
      {cards.length > 0 && (() => {
        const todayStart = new Date().setHours(0, 0, 0, 0)
        const todayEnd = new Date().setHours(23, 59, 59, 999)
        const overdueCount = studiable.filter(c => c.dueAt < todayStart).length
        const dueTodayCount = studiable.filter(c => c.dueAt >= todayStart && c.dueAt <= todayEnd).length
        const days = [0, 1, 2].map(offset => {
          const d = new Date()
          d.setDate(d.getDate() + offset)
          const end = new Date(d).setHours(23, 59, 59, 999)
          // Today includes all overdue cards; future days only count cards due that specific day
          const count = offset === 0
            ? studiable.filter(c => c.dueAt <= todayEnd).length
            : studiable.filter(c => {
                const dayStart = new Date(d).setHours(0, 0, 0, 0)
                return c.dueAt >= dayStart && c.dueAt <= end
              }).length
          const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short' })
          return { label, count, isToday: offset === 0 }
        })
        const totalToday = dueTodayCount + overdueCount
        const max = Math.max(...days.map(d => d.count), totalToday, 1)
        return (
          <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 480, marginBottom: 16 }}>
            {days.map(({ label, count, isToday }) => {
              const displayCount = isToday ? totalToday : count
              return (
                <div key={label} style={{ flex: 1, background: '#0a0f2e', border: `1px solid ${isToday ? '#f5c518' : '#1a2460'}`, borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: isToday ? '#f5c518' : '#4060a0', letterSpacing: 2, marginBottom: 6 }}>{label.toUpperCase()}</div>
                  <div style={{ height: 36, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', marginBottom: 6 }}>
                    <div style={{ width: '60%', background: isToday ? '#f5c518' : '#1a3070', borderRadius: 3, height: `${Math.max(displayCount / max * 100, 4)}%`, minHeight: 3 }} />
                  </div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: isToday ? '#f5c518' : '#c0c8e8' }}>{displayCount}</div>
                  {isToday && overdueCount > 0
                    ? <div style={{ fontSize: 9, color: '#e57373' }}>{dueTodayCount} today + {overdueCount} overdue</div>
                    : <div style={{ fontSize: 9, color: '#4060a0' }}>card{displayCount !== 1 ? 's' : ''}</div>
                  }
                </div>
              )
            })}
          </div>
        )
      })()}

      {cards.length === 0 ? (
        <>
          <div style={S.studySubtitle}>No cards yet</div>
          <div style={S.studyMeta}>Mark clues as Wrong or Pass on the board, or add cards manually in the Deck tab.</div>
        </>
      ) : (
        <div style={S.configPanel}>

          {/* Session size presets */}
          <div style={S.configRow}>
            <span style={S.configLabel}>SESSION SIZE</span>
            <div style={S.toggleGroup}>
              {[['quick','Quick','10'],['standard','Standard','20'],['long','Long','40'],['marathon','Marathon','100']].map(([key,label,n]) => (
                <button key={key}
                  style={{ ...S.toggleBtn, ...(chunkPreset === key && !showCustom ? S.toggleActive : {}) }}
                  onClick={() => { setChunkPreset(key); setShowCustom(false) }}
                >
                  <span style={{ fontSize: 13 }}>{label}</span>
                  <span style={{ fontSize: 10, opacity: 0.6 }}> {n}</span>
                </button>
              ))}
              <button
                style={{ ...S.toggleBtn, ...(chunkPreset === 'adaptive' && !showCustom ? S.toggleActive : {}) }}
                onClick={() => { setChunkPreset('adaptive'); setShowCustom(false) }}
              >
                <span style={{ fontSize: 13 }}>Adaptive</span>
                <span style={{ fontSize: 10, opacity: 0.6 }}> {matchingCards.length}</span>
              </button>
              <button
                style={{ ...S.toggleBtn, ...(showCustom ? S.toggleActive : {}) }}
                onClick={() => setShowCustom(true)}
              >
                Custom
              </button>
            </div>
            {showCustom && (
              <input
                style={{ ...S.loaderInput, marginTop: 8, textAlign: 'center', fontSize: 16 }}
                type="number"
                value={customChunk}
                onChange={e => setCustomChunk(e.target.value)}
                placeholder="Cards per session (e.g. 15)"
                min={1} max={200}
              />
            )}
          </div>

          {/* Answer mode */}
          <div style={S.configRow}>
            <span style={S.configLabel}>ANSWER MODE</span>
            <div style={S.toggleGroup}>
              <button
                style={{ ...S.toggleBtn, ...(!typedMode ? S.toggleActive : {}) }}
                onClick={() => { setTypedMode(false); localStorage.setItem('jeo-typed-answers', '0') }}
              >Reveal &amp; self-grade</button>
              <button
                style={{ ...S.toggleBtn, ...(typedMode ? S.toggleActive : {}) }}
                onClick={() => { setTypedMode(true); localStorage.setItem('jeo-typed-answers', '1') }}
              >⌨ Type the answer</button>
            </div>
            <div style={{ fontSize: 9, color: '#4060a0', letterSpacing: 1, lineHeight: 1.5 }}>
              Typing checks recall rather than recognition, so retention reflects what
              you could actually produce on a buzzer.
            </div>
          </div>

          {/* Due toggle */}
          <div style={S.configRow}>
            <span style={S.configLabel}>CARDS TO INCLUDE</span>
            <div style={S.toggleGroup}>
              {[
                ['all', `All (${studiable.length})`],
                ['due', `All Due (${dueCount})`],
                ['today', `Today (${studiable.filter(c => { const s=new Date().setHours(0,0,0,0); const e=new Date().setHours(23,59,59,999); return c.dueAt>=s&&c.dueAt<=e }).length})`],
                ['overdue', `Overdue (${studiable.filter(c => c.dueAt < new Date().setHours(0,0,0,0)).length})`],
              ].map(([v,l]) => (
                <button key={v} style={{ ...S.toggleBtn, ...(dueFilter === v ? S.toggleActive : {}) }} onClick={() => setDueFilter(v)}>{l}</button>
              ))}

            </div>
          </div>
          <div style={S.configRow}>
            <span style={S.configLabel}>DIFFICULTY</span>
            <div style={S.toggleGroup}>
              <button style={{ ...S.toggleBtn, ...(!strugglingOnly ? S.toggleActive : {}) }} onClick={() => setStrugglingOnly(false)}>All</button>
              <button style={{ ...S.toggleBtn, ...(strugglingOnly === 'hard' ? S.toggleActive : {}) }} onClick={() => setStrugglingOnly('hard')}>🟡 Hard ({studiable.filter(c => c.easeFactor < 2.0 && c.repetitions > 0).length})</button>
              <button style={{ ...S.toggleBtn, ...(strugglingOnly === true ? S.toggleActive : {}) }} onClick={() => setStrugglingOnly(true)}>🔴 Struggling ({studiable.filter(c => c.repetitions === 0 || (c.lapses || 0) >= 2).length})</button>
            </div>
          </div>

          {/* Source filter */}
          <div style={S.configRow}>
            <span style={S.configLabel}>SOURCE</span>
            <div style={S.chipRow}>
              {[
                ['all', 'All'],
                ['drills', `Drills (${studiable.filter(c=>c.id?.startsWith('drill-')).length})`],
                ['leeches', `🐛 Leeches (${studiable.filter(c=>(c.lapses||0)>=LEECH_LAPSES).length})`],
                ['missed', `Missed (${studiable.filter(c=>c.source==='missed').length})`],
                ['anki', `Anki (${studiable.filter(c=>c.source==='anki').length})`],
                ['manual', `Manual (${studiable.filter(c=>c.source==='manual').length})`],
              ].map(([val, label]) => (
                <button key={val} style={{ ...S.chip, ...(sourceFilter === val ? S.chipActive : {}), ...(val === 'leeches' ? { color: '#e57373' } : {}) }} onClick={() => setSourceFilter(val)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Category filter */}
          {allMetaCategories.length > 0 && (
            <div style={S.configRow}>
              <span style={S.configLabel}>CATEGORY</span>
              {weakest && (
                <button
                  onClick={() => setCategoryFilter(categoryFilter === weakest.meta ? 'all' : weakest.meta)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
                    background: categoryFilter === weakest.meta ? 'rgba(245,197,24,0.10)' : '#060b1a',
                    border: `1px solid ${categoryFilter === weakest.meta ? '#f5c518' : '#2a3480'}`,
                    borderRadius: 8, padding: '9px 12px', cursor: 'pointer', marginBottom: 4,
                  }}
                >
                  <span style={{ textAlign: 'left' }}>
                    <span style={{ fontSize: 12, color: '#f5c518', letterSpacing: 1 }}>🎯 Target your weakest</span>
                    <span style={{ display: 'block', fontSize: 10, color: '#4060a0', letterSpacing: 1 }}>
                      {weakest.meta} · averaging ${weakest.avg.toLocaleString()} on the board
                    </span>
                  </span>
                  <span style={{ fontSize: 11, color: categoryFilter === weakest.meta ? '#f5c518' : '#4060a0' }}>
                    {categoryFilter === weakest.meta ? 'ON' : 'OFF'}
                  </span>
                </button>
              )}
              <div style={S.chipRow}>
                <button style={{ ...S.chip, ...(categoryFilter === 'all' ? S.chipActive : {}) }} onClick={() => setCategoryFilter('all')}>
                  All
                </button>
                {allMetaCategories.map(meta => {
                  const count = cards.filter(c => getMetaCategory(c.category?.split(' · ')[0] || c.category || '') === meta).length
                  return (
                    <button key={meta} style={{ ...S.chip, ...(categoryFilter === meta ? S.chipActive : {}) }} onClick={() => setCategoryFilter(meta)}>
                      {meta} ({count})
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Match count + daily goal + start */}
          <div style={S.configFooter}>
            {dueFilter !== 'all' && dueCount === 0 && (
              <div style={S.nextDueBox}>
                <div style={S.nextDueLbl}>NEXT CARD DUE</div>
                <div style={S.nextDueVal}>{formatRelative(Math.min(...cards.map(c => c.dueAt)))}</div>
              </div>
            )}
            {matchingCards.length > 0 && (() => {
              const size = getChunkSize()
              const numChunks = Math.ceil(matchingCards.length / size)
              return (
                <div style={{ width: '100%', background: '#0a0f2e', borderRadius: 10, padding: '12px 14px', border: '1px solid #1a2460' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: '#c0c8e8' }}>
                      <b style={{ color: '#f5c518', fontFamily: "'Bebas Neue', sans-serif", fontSize: 20 }}>{matchingCards.length}</b>
                      {' '}card{matchingCards.length !== 1 ? 's' : ''} →{' '}
                      <b style={{ color: '#f5c518' }}>{numChunks}</b> session{numChunks !== 1 ? 's' : ''} of ~{size}
                    </span>
                  </div>
                  <div style={S.progressOuter}>
                    <div style={{ ...S.progressInner, width: `${Math.min(100, (1/numChunks)*100)}%`, background: '#2a3580' }} />
                  </div>
                  <div style={{ fontSize: 10, color: '#4060a0', marginTop: 4, letterSpacing: 1 }}>
                    Complete all {numChunks} to finish today&apos;s due cards
                  </div>
                </div>
              )
            })()}
            <button
              style={{ ...S.startBtn, opacity: matchingCards.length === 0 ? 0.3 : 1 }}
              onClick={startSession}
              disabled={matchingCards.length === 0}
            >
              {matchingCards.length === 0 ? 'No cards match' : `Start Session 1 →`}
            </button>
          </div>
        </div>
      )}
    </div>
  )

  // ── Chunk complete screen ─────────────────────────────────────────────────
  if (phase === 'chunkdone') return (
    <div style={S.studyLanding}>
      <div style={S.studyIcon}>{chunksRemaining === 0 ? '🎉' : '✅'}</div>
      <div style={S.studyTitle}>
        {chunksRemaining === 0 ? 'ALL DONE!' : `SESSION ${chunkIdx + 1} COMPLETE`}
      </div>
      {/* Misgrading the final card lands here, so undo has to be reachable. */}
      {lastRating && (
        <button
          style={{ fontSize: 11, color: '#f5c518', background: 'none', border: '1px solid #3a3010', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', letterSpacing: 1 }}
          onClick={undoLastRating}
        >↩ Undo last card ({lastRating.label})</button>
      )}

      {/* Chunk stats */}
      <div style={S.statsGrid}>
        {[['Again', chunkStats.again, '#e57373'],['Hard', chunkStats.hard, '#ffb74d'],['Good', chunkStats.good, '#81c784'],['Easy', chunkStats.easy, '#4dd0e1']].map(([lbl, n, c]) => (
          <div key={lbl} style={S.statCell}><div style={{ ...S.statN, color: c }}>{n}</div><div style={S.statLbl}>{lbl}</div></div>
        ))}
      </div>

      {/* Daily progress bar */}
      <div style={{ width: '100%', maxWidth: 480, background: '#0a0f2e', borderRadius: 10, padding: '12px 14px', border: '1px solid #1a2460' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: '#8890c0', letterSpacing: 1 }}>DAILY PROGRESS</span>
          <span style={{ fontSize: 11, color: '#f5c518' }}>{chunkIdx + 1} / {totalChunks} sessions</span>
        </div>
        <div style={S.progressOuter}>
          <div style={{ ...S.progressInner, width: `${((chunkIdx + 1) / totalChunks) * 100}%` }} />
        </div>
        <div style={{ fontSize: 10, color: '#4060a0', marginTop: 4 }}>
          {totalDone} of {sessionCards.length} cards reviewed
          {chunksRemaining > 0 && ` · ${chunksRemaining} session${chunksRemaining !== 1 ? 's' : ''} remaining`}
        </div>
      </div>

      {chunksRemaining > 0 ? (
        <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 480 }}>
          <button
            style={{ ...S.startBtn, flex: 1, background: '#1e2456', color: '#8890d0', border: '1px solid #2e3476', fontSize: 13 }}
            onClick={() => setPhase('configure')}
          >
            Stop for now
          </button>
          <button
            style={{ ...S.startBtn, flex: 2 }}
            onClick={() => {
              setChunkIdx(prev => prev + 1)
              setCardIdx(0)
              setFlipped(false)
              setChunkStats({ again: 0, hard: 0, good: 0, easy: 0 })
              setPhase('session')
            }}
          >
            Next Session {chunkIdx + 2} →
          </button>
        </div>
      ) : (
        <button style={S.startBtn} onClick={() => setPhase('configure')}>Back to Setup</button>
      )}
    </div>
  )

  // ── Active session ────────────────────────────────────────────────────────
  const card = currentChunk[cardIdx]
  if (!card) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#4060a0', fontSize: 13, letterSpacing: 2 }}>LOADING…</div>

  return (
    <div style={S.studyWrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: 480 }}>
        <button style={{ fontSize: 11, color: '#4060a0', letterSpacing: 1 }} onClick={() => setPhase('configure')}>← Exit</button>
        <div style={{ fontSize: 11, color: '#8890c0', letterSpacing: 1, textAlign: 'center' }}>
          Session {chunkIdx + 1}/{totalChunks} · Card {cardIdx + 1}/{currentChunk.length}
          <div style={{ fontSize: 9, color: '#4060a0', letterSpacing: 2, marginTop: 1 }}>TODAY: {dailyCards} REVIEWED</div>
        </div>
        {/* Replaces the old "Prev", which rewound the card index without undoing the
            rating — so re-grading ran sm2 a second time on an already-updated card. */}
        <button
          style={{ fontSize: 11, color: lastRating ? '#f5c518' : '#2a3460', letterSpacing: 1, cursor: lastRating ? 'pointer' : 'default' }}
          onClick={undoLastRating}
          disabled={!lastRating}
          title={lastRating ? `Undo "${lastRating.label}"` : 'Nothing to undo'}
        >↩ Undo</button>
      </div>
      <div style={S.progressOuter}><div style={{ ...S.progressInner, width: `${(cardIdx / currentChunk.length) * 100}%` }} /></div>
      <div style={S.flashCard} onClick={toggleFlip}>
        {/* Category header — always visible on both faces */}
        {(card.category || card.value > 0) && (
          <div style={{
            width: '100%',
            background: 'linear-gradient(135deg, #0a1040, #060b1a)',
            borderBottom: '1px solid #1a2460',
            padding: '10px 16px',
            borderRadius: '12px 12px 0 0',
            textAlign: 'center',
          }}>
            {card.category && (
              <div style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 15,
                letterSpacing: 2,
                color: '#f5c518',
                lineHeight: 1.2,
                marginBottom: card.value > 0 ? 3 : 0,
              }}>
                {card.category}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center' }}>
              {card.value > 0 && (
                <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, color: '#8890c0' }}>
                  ${card.value.toLocaleString()}
                </span>
              )}
              <span style={{ fontSize: 9, letterSpacing: 2, color: card.source === 'missed' ? '#e57373' : card.source === 'anki' ? '#4dd0e1' : card.source === 'drill' ? '#b39ddb' : '#81c784' }}>
                {card.source === 'missed' ? 'MISSED' : card.source === 'anki' ? 'ANKI' : card.source === 'drill' ? 'DRILL' : 'MANUAL'}
              </span>
              {card.dueAt > new Date().setHours(23, 59, 59, 999) && <span style={{ fontSize: 9, color: '#4060a0', letterSpacing: 1 }}>EARLY</span>}
            </div>
          </div>
        )}
        {!flipped
          ? <div style={S.flashInner}>
              <div style={S.flashSide}>CLUE</div>
              {card.image && <img src={card.image} alt="map" style={{ width: '100%', maxHeight: 160, objectFit: 'contain', borderRadius: 8, marginBottom: 8 }} />}
              {!card.image && <CardContent content={card.front.replace(/^\[Map\] /, '')} isHtml={card.hasMedia || cardIsHtml(card.front)} style={S.flashFrontText} />}
              {typedMode ? (
                <div style={{ width: '100%', marginTop: 10 }} onClick={e => e.stopPropagation()}>
                  <input
                    ref={answerInputRef}
                    value={typed}
                    onChange={e => setTyped(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitTyped() } }}
                    placeholder="Type your response…"
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    style={{ width: '100%', background: '#060b1a', border: '1px solid #2a3480', borderRadius: 8, padding: '10px 12px', color: '#e9ecf9', fontSize: 15, fontFamily: 'inherit', textAlign: 'center' }}
                  />
                  <div style={{ ...S.flashHint, marginTop: 6 }}>
                    {typed.trim() ? 'press enter to check' : 'type an answer, or tap the card to reveal'}
                  </div>
                </div>
              ) : (
                <div style={S.flashHint}>tap to reveal</div>
              )}
            </div>
          : <div style={S.flashInner}>
              <div style={{ ...S.flashSide, color: '#7cd992' }}>ANSWER</div>
              <CardContent content={card.back} isHtml={card.hasMedia || cardIsHtml(card.back)} style={S.flashBackText} />
              {typedResult && (
                <div style={{
                  marginTop: 10, padding: '7px 12px', borderRadius: 8,
                  border: `1px solid ${typedResult === 'correct' ? '#2e8c50' : '#8c2e2e'}`,
                  background: typedResult === 'correct' ? 'rgba(46,140,80,0.12)' : 'rgba(140,46,46,0.12)',
                  color: typedResult === 'correct' ? '#7cd992' : '#e07070', fontSize: 12,
                }}>
                  {typedResult === 'correct' ? '✓ matched' : '✗ no match'}
                  <span style={{ color: '#8890c0' }}> — you typed “{typed.trim()}”</span>
                </div>
              )}
              <div style={S.flashHint}>tap to flip back</div>
            </div>}
      </div>
      {flipped && (
        <>
          {/* Right / Wrong only. How well you knew it is the time you took, not a
              judgement you make after seeing the answer — which is the judgement
              people are worst at. Wrong is always Again; Right is graded by speed. */}
          <div style={S.rateRow}>
            {(() => {
              const rightQ = suggestGrade({ correct: true, ms: elapsedMs }) ?? 2
              const rightLabel = ['again', 'hard', 'good', 'easy'][rightQ]
              return [
                { q: 0, text: '✗ Wrong', color: '#e07070', bg: '#5c1a1a', border: '#8c2e2e', label: 'again' },
                { q: rightQ, text: '✓ Right', color: '#7cd992', bg: '#1a5c2e', border: '#2e8c50', label: rightLabel },
              ].map(({ q, text, color, bg, border, label }) => (
                <button
                  key={text}
                  style={{ ...S.rateBtn, background: bg, borderColor: border, flex: 1, padding: '12px 4px' }}
                  onClick={() => rate(q, label)}
                >
                  <span style={{ color, fontWeight: 700, fontSize: 15 }}>{text}</span>
                  <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, marginTop: 3 }}>{nextDueLabel(q, card)}</span>
                </button>
              ))
            })()}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 4, alignSelf: 'center' }}>
            <button
              style={{ fontSize: 11, color: '#4060a0', letterSpacing: 1 }}
              onClick={() => { setEditFront(card.front); setEditBack(card.back); setEditingCard(card) }}
            >
              ✏️ Edit card
            </button>
            <button
              style={{ fontSize: 11, color: '#4060a0', letterSpacing: 1 }}
              onClick={() => setConfirmDeleteStudy(card.id)}
            >
              🗑 Delete card
            </button>
          </div>

          {/* Delete confirmation */}
          {confirmDeleteStudy && (
            <div style={S.overlay} onClick={() => setConfirmDeleteStudy(null)}>
              <div style={{ ...S.modal, maxWidth: 300 }} onClick={e => e.stopPropagation()}>
                <div style={{ fontSize: 14, color: '#c0c8e8', marginBottom: 16, textAlign: 'center' }}>Delete this card?</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={{ ...S.markBtn, background: '#5c1a1a', color: '#e07070', border: '1px solid #8c2e2e', flex: 1 }} onClick={() => {
                    const cardToDelete = cards.find(c => c.id === confirmDeleteStudy)
                    if (cardToDelete) addToTrash(cardToDelete)
                    addTombstones(confirmDeleteStudy)
                    setCards(prev => prev.filter(c => c.id !== confirmDeleteStudy))
                    setConfirmDeleteStudy(null)
                    const nextCard = cardIdx + 1
                    if (nextCard >= currentChunk.length) setPhase('chunkdone')
                    else { setCardIdx(nextCard); setFlipped(false) }
                  }}>Delete</button>
                  <button style={{ ...S.markBtn, background: '#1e2456', color: '#8890d0', border: '1px solid #2e3476', flex: 1 }} onClick={() => setConfirmDeleteStudy(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* Inline edit modal */}
          {editingCard?.id === card.id && (
            <div style={{ width: '100%', maxWidth: 480, background: '#0a0f2e', borderRadius: 10, border: '1px solid #f5c518', padding: 16, marginTop: 8 }}>
              <div style={{ fontSize: 10, color: '#f5c518', letterSpacing: 2, marginBottom: 10 }}>EDIT CARD</div>
              <div style={{ fontSize: 10, color: '#6070a0', letterSpacing: 2, marginBottom: 4 }}>CLUE</div>
              <textarea
                style={{ ...S.textarea, marginBottom: 10, width: '100%' }}
                value={editFront}
                onChange={e => setEditFront(e.target.value)}
                rows={3}
              />
              <div style={{ fontSize: 10, color: '#6070a0', letterSpacing: 2, marginBottom: 4 }}>ANSWER</div>
              <textarea
                style={{ ...S.textarea, marginBottom: 12, width: '100%' }}
                value={editBack}
                onChange={e => setEditBack(e.target.value)}
                rows={2}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  style={{ ...S.markBtn, background: '#1e2456', color: '#8890d0', border: '1px solid #2e3476', flex: 1 }}
                  onClick={() => setEditingCard(null)}
                >
                  Cancel
                </button>
                <button
                  style={{ ...S.revealBtn, flex: 2 }}
                  onClick={() => {
                    const updatedCard = { ...card, front: editFront.trim(), back: editBack.trim() }
                    setCards(prev => prev.map(c => c.id === card.id ? updatedCard : c))
                    setAllChunks(prev => prev.map((chunk, ci) =>
                      ci === chunkIdx
                        ? chunk.map((c, ri) => ri === cardIdx ? updatedCard : c)
                        : chunk
                    ))
                    setEditingCard(null)
                  }}
                  disabled={!editFront.trim() || !editBack.trim()}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Media Storage Info ──────────────────────────────────────────────────────
function MediaStorageInfo() {
  const [stats, setStats] = useState(null)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    getMediaStats().then(setStats).catch(() => {})
  }, [])

  if (!stats || stats.count === 0) return null

  async function handleClear() {
    if (!confirm('Clear all stored media? Card images will no longer display.')) return
    setClearing(true)
    await clearAllMedia()
    setStats({ count: 0, sizeKB: 0 })
    setClearing(false)
  }

  return (
    <div style={{ marginTop: 8, padding: '8px 12px', background: '#060b1a', borderRadius: 8, border: '1px solid #1a2040', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: '#6070a0' }}>
        📁 {stats.count} media files · {stats.sizeKB}KB stored
      </span>
      <button style={{ fontSize: 11, color: '#e57373', letterSpacing: 1 }} onClick={handleClear} disabled={clearing}>
        {clearing ? '...' : 'Clear'}
      </button>
    </div>
  )
}

// ─── Deck View ────────────────────────────────────────────────────────────────
function DeckView({ cards, setCards, user, onBack }) {
  const [subview, setSubview] = useState('list')
  const [editCard, setEditCard] = useState(null) // card being edited
  const [editFront, setEditFront] = useState('')
  const [editBack, setEditBack] = useState('')
  const [editCat, setEditCat] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkMode, setBulkMode] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [newFront, setNewFront] = useState('')
  const [newBack, setNewBack] = useState('')
  const [newCat, setNewCat] = useState('')
  const [filter, setFilter] = useState('all')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [trash, setTrash] = useState(() => getTrash().cards)
  const [showTrash, setShowTrash] = useState(false)
  const [snapshots, setSnapshots] = useState([])
  useEffect(() => { let live = true; getDeckSnapshots().then(s => { if (live) setSnapshots(s) }); return () => { live = false } }, [cards.length])
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [importError, setImportError] = useState(null)
  const fileRef = useRef()
  const now = Date.now()

  function addCard() {
    if (!newFront.trim() || !newBack.trim()) return
    setCards(prev => [...prev, newCard(newFront.trim(), newBack.trim(), newCat.trim())])
    setNewFront(''); setNewBack(''); setNewCat(''); setSubview('list')
  }
  function deleteCard(id) {
    const card = cards.find(c => c.id === id)
    if (card) { addToTrash(card); setTrash(getTrash().cards) }
    addTombstones(id)
    setCards(prev => prev.filter(c => c.id !== id))
    setConfirmDelete(null)
  }

  function restoreCard(id) {
    const card = restoreFromTrash(id)
    if (card) {
      const { deletedAt, ...restored } = card
      // Clear the tombstone too, or the next merge deletes it straight back out.
      removeTombstone(id)
      setCards(prev => [restored, ...prev])
      setTrash(getTrash().cards)
    }
  }
  function resetCard(id) { setCards(prev => prev.map(c => c.id === id ? resetSchedule(c) : c)) }

  function startEdit(card) {
    setEditCard(card)
    setEditFront(card.front)
    setEditBack(card.back)
    setEditCat(card.category || '')
  }

  function saveEdit() {
    if (!editFront.trim() || !editBack.trim()) return
    setCards(prev => prev.map(c => c.id === editCard.id ? { ...c, front: editFront.trim(), back: editBack.trim(), category: editCat.trim() } : c))
    setEditCard(null)
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(filtered.map(c => c.id)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
    setBulkMode(false)
  }

  function bulkDelete() {
    // Every other delete in the app goes to the bin first — single, in-session and
    // quarantine all call addToTrash. This one didn't, which made selecting fifty cards
    // and hitting Delete the one irreversible action in the deck view.
    cards.filter(c => selectedIds.has(c.id)).forEach(addToTrash)
    setTrash(getTrash().cards)
    addTombstones([...selectedIds])
    setCards(prev => prev.filter(c => !selectedIds.has(c.id)))
    clearSelection()
  }

  function bulkReset() {
    setCards(prev => prev.map(c => selectedIds.has(c.id) ? resetSchedule(c) : c))
    clearSelection()
  }

  function handleJsonExport() {
    const json = JSON.stringify(cards, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `jeo-deck-backup-${new Date().toISOString().slice(0,10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleJsonImport(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const imported = JSON.parse(ev.target.result)
        if (!Array.isArray(imported)) { alert('Invalid backup file'); return }
        const freshCards = loadCards()
        const existingIds = new Set(freshCards.map(c => c.id))
        const newCards = imported.filter(c => !existingIds.has(c.id))
        const updated = [...freshCards, ...newCards]
        if (!saveCards(updated)) {
          alert('Could not save — this device is out of local storage. Free space in My Deck and try again.')
          return
        }
        // Clear the tombstones for anything being restored, or the next sync deletes it
        // straight back out and the backup silently un-restores itself.
        newCards.forEach(c => removeTombstone(c.id))
        setCards(updated)
        alert(`Restored ${newCards.length} cards (${imported.length - newCards.length} already existed)`)
      } catch { alert('Failed to parse backup file') }
    }
    reader.readAsText(file)
  }

  async function handleExport() {
    setExporting(true)
    try {
      const toExport = bulkMode && selectedIds.size > 0 ? cards.filter(c => selectedIds.has(c.id)) : filtered
      await exportToApkg(toExport)
    } catch (err) {
      alert('Export failed: ' + err.message)
    } finally {
      setExporting(false)
    }
  }

  function isLeech(card) { return (card.lapses || 0) >= LEECH_LAPSES }

  const [importProgress, setImportProgress] = useState('')

  async function handleApkgImport(e) {
    const file = e.target.files[0]; if (!file) return
    setImporting(true); setImportError(null); setImportResult(null); setImportProgress('Starting...')

    try {
      // Parse in chunks using scheduler to avoid blocking UI
      // Falls back to parseApkg which uses requestIdleCallback internally
      setImportProgress('Unzipping deck...')
      const result = await parseApkg(file, (progress) => {
        if (progress.phase === 'media') setImportProgress(`Storing media ${progress.stored}/${progress.total}...`)
        else if (progress.phase === 'upload') setImportProgress(`Uploading media ${progress.stored}/${progress.total}...`)
        else if (progress.phase === 'cards') setImportProgress(`Parsing ${progress.processed}/${progress.total} cards...`)
        else if (progress.phase === 'sql') setImportProgress('Loading database...')
      }, user)

      const imported = result.cards
      // Counted outside the updater: React can call a state updater more than once, and
      // the old code incremented from inside it. It then reported imported.length anyway,
      // so "Imported 2,400 cards" could mean two were added and 2,398 already existed.
      const existing = new Set(cards.map(c => c.front))
      const toAdd = imported.filter(c => !existing.has(c.front))
      setCards(prev => {
        const have = new Set(prev.map(c => c.front))
        return [...prev, ...imported.filter(c => !have.has(c.front))]
      })
      setImportResult({ added: toAdd.length, skipped: imported.length - toAdd.length, mediaCount: result.mediaCount })
    } catch (err) {
      setImportError(err.message || String(err))
    } finally {
      setImporting(false)
      setImportProgress('')
      e.target.value = ''
    }
  }

  const leeches = cards.filter(c => (c.lapses || 0) >= LEECH_LAPSES && !isSuspended(c))
  const quarantined = cards.filter(isSuspended)
  // "Due" means due to be studied, and a quarantined card will not be — it was excluded
  // everywhere else and counted here, which is how a card could sit in the due count and
  // never appear in a session.
  const counts = {
    all: cards.length,
    due: cards.filter(c => !isSuspended(c) && c.dueAt <= now).length,
    leeches: leeches.length,
    quarantined: quarantined.length,
    drills: cards.filter(c => c.id?.startsWith('drill-')).length,
    missed: cards.filter(c => c.source === 'missed').length,
    manual: cards.filter(c => c.source === 'manual').length,
    anki: cards.filter(c => c.source === 'anki').length,
  }
  const filtered = cards.filter(c => {
    if (filter === 'due') { if (isSuspended(c) || !(c.dueAt <= new Date().setHours(23, 59, 59, 999))) return false }
    if (filter === 'drills') { if (!c.id?.startsWith('drill-')) return false }
    else if (filter === 'leeches') { if (!((c.lapses || 0) >= LEECH_LAPSES) || isSuspended(c)) return false }
    else if (filter === 'quarantined') { if (!isSuspended(c)) return false }
    else if (filter === 'missed' || filter === 'manual' || filter === 'anki') { if (c.source !== filter) return false }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      if (!(c.front || '').toLowerCase().includes(q) && !(c.back || '').toLowerCase().includes(q) && !(c.category || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div style={S.deckWrap}>
      {onBack && <button style={{ fontSize: 12, color: '#4060a0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '0 0 4px 0' }} onClick={onBack}>← Back</button>}
      <div style={S.deckActions}>
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <button style={{ ...S.actionBtn, ...(subview === 'add' ? S.actionBtnActive : {}), flex: 1 }} onClick={() => setSubview(subview === 'add' ? 'list' : 'add')}>{subview === 'add' ? '✕ Cancel' : '+ Add Card'}</button>
          <button style={{ ...S.actionBtn, ...(subview === 'import' ? S.actionBtnActive : {}), flex: 1 }} onClick={() => setSubview(subview === 'import' ? 'list' : 'import')}>{subview === 'import' ? '✕ Cancel' : '⬆ Import .apkg'}</button>
          <button style={{ ...S.actionBtn, ...(showTrash ? S.actionBtnActive : {}), position: 'relative' }} onClick={() => setShowTrash(t => !t)}>
            🗑{trash.length > 0 && <span style={{ position: 'absolute', top: 2, right: 2, background: '#e57373', borderRadius: '50%', width: 14, height: 14, fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>{trash.length}</span>}
          </button>
          <button style={S.actionBtn} onClick={handleJsonExport} title="Export full deck as JSON backup">💾</button>
          <label style={{ ...S.actionBtn, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Restore from JSON backup">
            📂<input type="file" accept=".json" style={{ display: 'none' }} onChange={handleJsonImport} />
          </label>
        </div>
        <div style={{ position: 'relative', width: '100%' }}>
          <input style={{ ...S.input, width: '100%', boxSizing: 'border-box', paddingLeft: 32, paddingRight: searchQuery ? 28 : 12, fontSize: 13 }} type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search cards..." />
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#4060a0', pointerEvents: 'none', lineHeight: 1 }}>🔍</span>
          {searchQuery && <button style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#4060a0', lineHeight: 1 }} onClick={() => setSearchQuery('')}>✕</button>}
        </div>
        {searchQuery && <div style={{ fontSize: 11, color: '#6070a0', letterSpacing: 1 }}>{filtered.length} result{filtered.length !== 1 ? 's' : ''}</div>}
      </div>

      {subview === 'add' && (
        <div style={S.addForm}>
          <div style={S.formLabel}>CLUE (Front)</div>
          <textarea style={S.textarea} value={newFront} onChange={e => setNewFront(e.target.value)} placeholder="Enter the clue..." rows={3} />
          <div style={S.formLabel}>ANSWER (Back)</div>
          <textarea style={S.textarea} value={newBack} onChange={e => setNewBack(e.target.value)} placeholder="What is / Who is..." rows={2} />
          <div style={S.formLabel}>CATEGORY (Optional)</div>
          <input style={S.input} value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="e.g. American History" />
          <button style={{ ...S.startBtn, marginTop: 12, opacity: (!newFront.trim() || !newBack.trim()) ? 0.4 : 1 }} onClick={addCard} disabled={!newFront.trim() || !newBack.trim()}>Add Card</button>
        </div>
      )}

      {subview === 'import' && (
        <div style={S.addForm}>
          <div style={S.importTitle}>Import Anki Deck</div>
          <div style={S.importDesc}>
            Select a <code style={S.code}>.apkg</code> file from Anki. Images and audio are extracted and stored locally — they will display inside your flashcards.
          </div>
          <div style={S.importHowTo}><b>Anki:</b> File → Export → Include media ✓ → format: Anki Deck Package (.apkg)</div>
          <input ref={fileRef} type="file" accept=".apkg" onChange={handleApkgImport} style={{ display: 'none' }} />
          {importing ? (
            <div style={{ textAlign: 'center' }}>
              <div style={S.importStatus}>⏳ {importProgress || 'Importing...'}</div>
              <div style={{ fontSize: 11, color: '#4060a0', marginTop: 6, lineHeight: 1.6 }}>
                Large decks may take 15–30 seconds. The app stays responsive.
              </div>
            </div>
          ) : <button style={S.startBtn} onClick={() => fileRef.current.click()}>Choose .apkg File</button>}
          {importResult && (
            <div style={S.importSuccess}>
              ✅ Added {importResult.added} card{importResult.added !== 1 ? 's' : ''}
              {importResult.skipped > 0 && ` · ${importResult.skipped} already in your deck`}
              {importResult.mediaCount > 0 && ` · ${importResult.mediaCount} media files stored`}
            </div>
          )}
          {importError && <div style={S.importError}>❌ {importError}</div>}
          <MediaStorageInfo />
        </div>
      )}

      {/* Bulk action bar */}
      {bulkMode && (
        <div style={{ display: 'flex', gap: 6, background: '#0a0f2e', borderRadius: 8, padding: '8px 12px', border: '1px solid #1a2460', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#f5c518', flex: 1 }}>{selectedIds.size} selected</span>
          <button style={{ fontSize: 11, color: '#8890c0', letterSpacing: 1 }} onClick={selectAll}>All</button>
          <button style={{ fontSize: 11, color: '#4caf7d', letterSpacing: 1 }} onClick={bulkReset}>Reset SRS</button>
          <button style={{ fontSize: 11, color: '#e57373', letterSpacing: 1 }} onClick={bulkDelete}>Delete</button>
          <button style={{ fontSize: 11, color: '#4060a0', letterSpacing: 1 }} onClick={clearSelection}>✕</button>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
          {['all','due','leeches','quarantined','drills','missed','manual','anki']
            .filter(f => f !== 'quarantined' || counts.quarantined > 0)
            .map(f => (
              <button key={f} style={{ ...S.filterTab, ...(filter === f ? S.filterTabActive : {}), ...(f === 'leeches' && counts.leeches > 0 ? { color: '#e57373' } : {}), ...(f === 'quarantined' ? { color: '#e07070', borderColor: '#5c2a2a' } : {}) }} onClick={() => setFilter(f)}>
                {f === 'leeches' ? '🐛' : f === 'quarantined' ? '🚫' : ''}{f.toUpperCase()} ({counts[f]})
              </button>
            ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={{ ...S.filterTab, color: bulkMode ? '#f5c518' : '#5060a0', ...(bulkMode ? { borderColor: '#f5c518' } : {}) }} onClick={() => setBulkMode(!bulkMode)}>
            ☑ BULK
          </button>
          <button style={{ ...S.filterTab, color: exporting ? '#8890c0' : '#4dd0e1' }} onClick={handleExport} disabled={exporting}>
            {exporting ? '⏳' : '⬇ ANKI'}
          </button>
        </div>
      </div>

      {filtered.length === 0
        ? <div style={S.emptyDeck}><div style={{ fontSize: 32, marginBottom: 8 }}>🗂</div><div style={{ color: '#6070a0', fontSize: 14, textAlign: 'center' }}>{filter === 'all' ? 'No cards yet.' : `No ${filter} cards.`}</div></div>
        : <div style={S.cardList}>
          {filtered.map(card => {
            const isDue = card.dueAt <= new Date().setHours(23, 59, 59, 999)
            const sc = card.source === 'missed' ? '#e57373' : card.source === 'anki' ? '#4dd0e1' : '#81c784'
            return (
              <div key={card.id} style={{ ...S.cardRow, ...(bulkMode && selectedIds.has(card.id) ? { borderColor: '#f5c518', background: 'rgba(245,197,24,0.05)' } : {}) }} onClick={bulkMode ? () => toggleSelect(card.id) : undefined}>
                <div style={S.cardRowMain}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    {isLeech(card) && <span style={{ fontSize: 10, flexShrink: 0 }} title="Leech: 4+ consecutive wrong">🐛</span>}
                    <CardContent content={card.front} isHtml={card.hasMedia || cardIsHtml(card.front)} style={S.cardRowFront} />
                  </div>
                  <CardContent content={card.back} isHtml={card.hasMedia || cardIsHtml(card.back)} style={S.cardRowBack} />
                  <div style={S.cardRowMeta}>
                    {card.category && <span style={S.metaTag}>{card.category}</span>}
                    <span style={{ ...S.metaTag, color: sc }}>{(card.source || 'drill').toUpperCase()}</span>
                    <span style={{ ...S.metaTag, color: isSuspended(card) ? '#4060a0' : isDue ? '#f5c518' : '#4060a0' }}>
                      {isSuspended(card) ? 'Not scheduled' : isDue ? 'DUE NOW' : `Due ${formatRelative(card.dueAt)}`}
                    </span>
                    {card.repetitions > 0 && <span style={S.metaTag}>Rep {card.repetitions} · EF {card.easeFactor.toFixed(2)}</span>}
                    {isSuspended(card)
                      ? <span style={{ ...S.metaTag, color: '#e07070', borderColor: '#5c2a2a' }}>🚫 QUARANTINED ({card.lapses} lapses)</span>
                      : isLeech(card) && <span style={{ ...S.metaTag, color: '#e57373' }}>LEECH ({card.lapses} lapses)</span>}
                  </div>
                </div>
                {!bulkMode && (
                  <div style={S.cardRowActions}>
                    <button style={S.iconBtn} onClick={() => startEdit(card)}>✏️</button>
                    <button style={S.iconBtn} onClick={() => resetCard(card.id)}>↺</button>
                    <button style={{ ...S.iconBtn, color: '#e57373' }} onClick={() => setConfirmDelete(card.id)}>🗑</button>
                  </div>
                )}
                {bulkMode && (
                  <div style={{ fontSize: 18, color: selectedIds.has(card.id) ? '#f5c518' : '#2a3580', paddingLeft: 8 }}>
                    {selectedIds.has(card.id) ? '☑' : '☐'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      }

      {/* Snapshot restore */}
      {(() => {
        const snaps = snapshots
        if (!snaps.length) return null
        return (
          <div style={{ background: '#0a0f2e', border: '1px solid #1a2460', borderRadius: 12, padding: '10px 14px', marginTop: 4 }}>
            <div style={{ fontSize: 9, color: '#4060a0', letterSpacing: 3, marginBottom: 8 }}>DECK SNAPSHOTS</div>
            {snaps.map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: i < snaps.length-1 ? '1px solid #0d1235' : 'none' }}>
                <div>
                  <div style={{ fontSize: 12, color: '#c0c8e8' }}>{s.date}</div>
                  <div style={{ fontSize: 10, color: '#4060a0' }}>{s.count} cards</div>
                </div>
                <button style={{ fontSize: 11, color: '#f5c518', border: '1px solid #3a3010', borderRadius: 6, padding: '3px 10px', background: '#1a1500', cursor: 'pointer' }}
                  onClick={async () => {
                    const restored = await restoreSnapshot(i)
                    if (!restored) { alert('Could not read that snapshot.'); return }
                    // Restoring replaces the deck, so say what that costs before doing it.
                    const restoredIds = new Set(restored.map(c => c.id))
                    const dropped = cards.filter(c => !restoredIds.has(c.id))
                    const warning = dropped.length
                      ? `\n\n${dropped.length} card${dropped.length !== 1 ? 's' : ''} added since then will be deleted.`
                      : ''
                    if (!confirm(`Restore ${restored.length} cards from ${s.date}? This replaces your current deck.${warning}`)) return
                    // Tombstone what's being dropped and clear tombstones for what's coming
                    // back — otherwise the next sync undoes the restore in both directions.
                    if (dropped.length) addTombstones(dropped.map(c => c.id))
                    restored.forEach(c => removeTombstone(c.id))
                    setCards(restored)
                    alert(`Restored ${restored.length} cards`)
                  }}>Restore</button>
              </div>
            ))}
          </div>
        )
      })()}

      {showTrash && (
        <div style={{ background: '#0a0f2e', border: '1px solid #1a2460', borderRadius: 12, padding: 14, marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: '#4060a0', letterSpacing: 3 }}>RECENTLY DELETED</div>
            <div style={{ fontSize: 9, color: '#2a3460' }}>Empties at midnight</div>
          </div>
          {trash.length === 0
            ? <div style={{ fontSize: 12, color: '#2a3460', textAlign: 'center', padding: '12px 0' }}>Trash is empty</div>
            : trash.map(card => (
              <div key={card.id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #0d1235', padding: '8px 0' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#c0c8e8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.front}</div>
                  <div style={{ fontSize: 10, color: '#4060a0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.back}</div>
                </div>
                <button
                  style={{ fontSize: 11, color: '#4caf7d', border: '1px solid #2e8c50', borderRadius: 6, padding: '3px 10px', background: '#0a1e10', cursor: 'pointer', flexShrink: 0 }}
                  onClick={() => restoreCard(card.id)}
                >Restore</button>
              </div>
            ))
          }
        </div>
      )}

      {confirmDelete && (
        <div style={S.overlay} onClick={() => setConfirmDelete(null)}>
          <div style={{ ...S.modal, maxWidth: 300 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, color: '#e8e8f0', marginBottom: 16, textAlign: 'center' }}>Delete this card?</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ ...S.markBtn, background: '#5c1a1a', color: '#e07070', border: '1px solid #8c2e2e', flex: 1 }} onClick={() => deleteCard(confirmDelete)}>Delete</button>
              <button style={{ ...S.markBtn, background: '#1e2456', color: '#8890d0', border: '1px solid #2e3476', flex: 1 }} onClick={() => setConfirmDelete(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {editCard && (
        <div style={S.overlay} onClick={() => setEditCard(null)}>
          <div style={{ ...S.modal, maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <button style={S.closeX} onClick={() => setEditCard(null)}>✕</button>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: '#f5c518', letterSpacing: 2, marginBottom: 16 }}>EDIT CARD</div>
            <div style={S.formLabel}>CLUE (Front)</div>
            <textarea style={{ ...S.textarea, marginBottom: 8 }} value={editFront} onChange={e => setEditFront(e.target.value)} rows={3} />
            <div style={S.formLabel}>ANSWER (Back)</div>
            <textarea style={{ ...S.textarea, marginBottom: 8 }} value={editBack} onChange={e => setEditBack(e.target.value)} rows={2} />
            <div style={S.formLabel}>CATEGORY</div>
            <input style={{ ...S.input, marginBottom: 16 }} value={editCat} onChange={e => setEditCat(e.target.value)} placeholder="e.g. American History" />
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...S.markBtn, background: '#1e2456', color: '#8890d0', border: '1px solid #2e3476', flex: 1 }} onClick={() => setEditCard(null)}>Cancel</button>
              <button style={{ ...S.revealBtn, flex: 2 }} onClick={saveEdit} disabled={!editFront.trim() || !editBack.trim()}>Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Game History Row ────────────────────────────────────────────────────────
function GameHistoryRow({ game }) {
  const [expanded, setExpanded] = useState(false)
  const hasBreakdown = (game.singleBreakdown?.length > 0) || (game.doubleBreakdown?.length > 0)

  return (
    <div style={{ borderBottom: '1px solid #1a2040' }}>
      {/* Summary row — always visible, tappable if breakdown exists */}
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0', cursor: hasBreakdown ? 'pointer' : 'default' }}
        onClick={() => hasBreakdown && setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {hasBreakdown && (
              <span style={{ fontSize: 10, color: '#4060a0', transition: 'transform 0.2s', display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
            )}
            <span style={{ fontSize: 13, color: '#c0c8e8' }}>#{game.episodeId} · {game.airDate}</span>
          </div>
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: game.coryatScore >= 0 ? '#4caf7d' : '#e57373' }}>
            {game.coryatScore >= 0 ? '+' : ''}{game.coryatScore.toLocaleString()}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#4060a0', paddingLeft: hasBreakdown ? 16 : 0 }}>
          <span>SJ: {game.singleCoryat >= 0 ? '+' : ''}{game.singleCoryat}</span>
          {game.doubleCoryat !== 0 && <span>DJ: {game.doubleCoryat >= 0 ? '+' : ''}{game.doubleCoryat}</span>}
          <span>{game.totalCorrect}✓ {game.totalIncorrect}✗ {game.totalPass} pass</span>
          {game.finalJeopardy && (
            <span style={{ color: game.finalJeopardy.result === 'correct' ? '#4caf7d' : '#e57373' }}>
              FJ: {game.finalJeopardy.result === 'correct' ? '✓' : '✗'}
            </span>
          )}
        </div>
      </div>

      {/* Expanded category breakdown */}
      {expanded && hasBreakdown && (
        <div style={{ paddingLeft: 16, paddingBottom: 10 }}>
          {game.singleBreakdown?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: '#4060a0', marginBottom: 6 }}>SINGLE JEOPARDY</div>
              {game.singleBreakdown.map((cat, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #0f1530' }}>
                  <span style={{ fontSize: 12, color: '#8890c0' }}>{cat.name}</span>
                  <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: cat.score >= 0 ? '#4caf7d' : '#e57373' }}>
                    {cat.score >= 0 ? '+' : ''}{cat.score.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
          {game.doubleBreakdown?.length > 0 && (
            <div>
              <div style={{ fontSize: 9, letterSpacing: 3, color: '#4060a0', marginBottom: 6 }}>DOUBLE JEOPARDY</div>
              {game.doubleBreakdown.map((cat, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #0f1530' }}>
                  <span style={{ fontSize: 12, color: '#8890c0' }}>{cat.name}</span>
                  <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: cat.score >= 0 ? '#4caf7d' : '#e57373' }}>
                    {cat.score >= 0 ? '+' : ''}{cat.score.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Summary / Stats View ─────────────────────────────────────────────────────
function SummaryView({ cards = [], predictionBaseDate, onResetPredictionBase, coryatScore, actualScore, fjAnswered, singleBoard, doubleBoard, singleClueStates, doubleClueStates, gameHistory, episodeMeta, tournamentState, confidenceRatings, allTimeCorrect, allTimeIncorrect, allTimePass, allTimeAnswered, pctCorrect, pctIncorrect, pctPass, avgSJ, avgDJ, gamesWithFJ, fjCorrect, pctFJ }) {
  const [historyView, setHistoryView] = useState(false)
  const [statsTab, setStatsTab] = useState('current') // current | weakness | speed | history

  const totalCorrect = Object.values(singleClueStates).filter(s => s === 'correct').length + Object.values(doubleClueStates).filter(s => s === 'correct').length
  const totalIncorrect = Object.values(singleClueStates).filter(s => s === 'incorrect').length + Object.values(doubleClueStates).filter(s => s === 'incorrect').length
  const totalPass = Object.values(singleClueStates).filter(s => s === 'pass').length + Object.values(doubleClueStates).filter(s => s === 'pass').length
  const totalClues = (singleBoard?.categories?.length * 5 || 0) + (doubleBoard?.categories?.length * 5 || 0)
  const pct = totalClues > 0 ? Math.round((totalCorrect / totalClues) * 100) : 0

  const allTimeAvg = gameHistory.length > 0 ? Math.round(gameHistory.reduce((s, g) => s + g.coryatScore, 0) / gameHistory.length) : null
  const last10 = gameHistory.slice(0, 10)
  const last10Avg = last10.length > 0 ? Math.round(last10.reduce((s, g) => s + g.coryatScore, 0) / last10.length) : null
  const best = gameHistory.length > 0 ? Math.max(...gameHistory.map(g => g.coryatScore)) : null

  // Actual show score averages (includes DD/FJ wagers)
  const gamesWithActual = gameHistory.filter(g => g.actualScore !== undefined && g.actualScore !== null)
  const allTimeActualAvg = gamesWithActual.length > 0 ? Math.round(gamesWithActual.reduce((s, g) => s + g.actualScore, 0) / gamesWithActual.length) : null
  const last10Actual = gamesWithActual.slice(0, 10)
  const last10ActualAvg = last10Actual.length > 0 ? Math.round(last10Actual.reduce((s, g) => s + g.actualScore, 0) / last10Actual.length) : null
  const bestActual = gamesWithActual.length > 0 ? Math.max(...gamesWithActual.map(g => g.actualScore)) : null
  const wageringImpact = (allTimeAvg !== null && allTimeActualAvg !== null) ? allTimeActualAvg - allTimeAvg : null

  const singleBreakdown = categoryBreakdown(singleBoard, singleClueStates)
  const doubleBreakdown = categoryBreakdown(doubleBoard, doubleClueStates)
  // Show current game section if we have a board loaded (even if no clues answered yet)
  const hasCurrentGame = !!singleBoard

  const streak = calcStreak(gameHistory)

  return (
    <div style={S.summaryWrap}>
      {/* Stats tab bar */}
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
        {[['current','📋 NOW'],['weakness','⚠️ WEAK'],['heatmap','🗺 MAP'],['speed','⚡ SPEED'],['history','📜 LOG']].map(([id, label]) => (
          <button key={id} style={{ ...S.navBtn, flex: 1, fontSize: 10, letterSpacing: 1, padding: '9px 4px', ...(statsTab === id ? S.navActive : {}) }} onClick={() => setStatsTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {/* Streak bar — always visible */}
      {gameHistory.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {[
            ['🔥 STREAK', streak.current > 0 ? `${streak.current}d` : '—'],
            ['🏆 BEST', `${streak.longest}d`],
            ['📅 THIS WK', streak.thisWeek],
            ['🎮 TOTAL', streak.total],
          ].map(([l, v]) => (
            <div key={l} style={{ background: '#0a0f2e', borderRadius: 8, padding: '8px 4px', textAlign: 'center', border: '1px solid #1a2460' }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: '#f5c518' }}>{v}</div>
              <div style={{ fontSize: 8, color: '#6070a0', letterSpacing: 1.5 }}>{l}</div>
            </div>
          ))}
        </div>
      )}

      {/* All-time performance stats — always visible in current tab */}
      {statsTab === 'current' && gameHistory.length > 0 && allTimeAnswered > 0 && (
        <div style={{ background: '#0a0f2e', borderRadius: 12, padding: '14px 16px', border: '1px solid #1a2460' }}>
          <div style={{ fontSize: 10, letterSpacing: 3, color: '#6070a0', marginBottom: 10 }}>ALL-TIME PERFORMANCE</div>

          {/* Correct / Wrong / Pass */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
            {[
              ['✓ CORRECT', allTimeCorrect, pctCorrect, '#4caf7d'],
              ['✗ WRONG', allTimeIncorrect, pctIncorrect, '#e57373'],
              ['— PASS', allTimePass, pctPass, '#7986cb'],
            ].map(([lbl, count, pct, color]) => (
              <div key={lbl} style={{ background: '#060b1a', borderRadius: 8, padding: '10px 6px', textAlign: 'center', border: '1px solid #1a2040' }}>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color }}>{count.toLocaleString()}</div>
                <div style={{ fontSize: 11, color, marginBottom: 2 }}>{pct !== null ? `${pct}%` : '—'}</div>
                <div style={{ fontSize: 8, color: '#4060a0', letterSpacing: 1.5 }}>{lbl}</div>
              </div>
            ))}
          </div>

          {/* SJ / DJ averages */}
          {(avgSJ !== null || avgDJ !== null) && (
            <div style={{ display: 'grid', gridTemplateColumns: avgDJ !== null ? '1fr 1fr' : '1fr', gap: 8, marginBottom: pctFJ !== null ? 12 : 0 }}>
              {[['AVG SJ CORYAT', avgSJ, '#f5c518'], ['AVG DJ CORYAT', avgDJ, '#f5c518']].filter(([,v]) => v !== null).map(([lbl, val, color]) => (
                <div key={lbl} style={{ background: '#060b1a', borderRadius: 8, padding: '10px 6px', textAlign: 'center', border: '1px solid #1a2040' }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color }}>{val >= 0 ? '+' : ''}{val.toLocaleString()}</div>
                  <div style={{ fontSize: 8, color: '#4060a0', letterSpacing: 1.5 }}>{lbl}</div>
                </div>
              ))}
            </div>
          )}

          {/* FJ percentage */}
          {pctFJ !== null && (
            <div style={{ background: '#060b1a', borderRadius: 8, padding: '10px 14px', border: '1px solid #1a2040', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12, color: '#c0c8e8' }}>Final Jeopardy correct</div>
                <div style={{ fontSize: 10, color: '#4060a0', letterSpacing: 1 }}>{fjCorrect} of {gamesWithFJ.length} games</div>
              </div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: pctFJ >= 50 ? '#4caf7d' : '#e57373' }}>
                {pctFJ}%
              </div>
            </div>
          )}
        </div>
      )}

      {/* Weakness tab */}
      {statsTab === 'weakness' && <WeaknessTracker gameHistory={gameHistory} />}

      {/* Speed tab */}
      {statsTab === 'speed' && <SpeedTracker gameHistory={gameHistory} />}

      {/* Heat map tab */}
      {statsTab === 'heatmap' && <CategoryHeatMapView gameHistory={gameHistory} />}

      {/* History tab */}
      {statsTab === 'history' && gameHistory.length > 0 && (
        <div style={{ background: '#0a0f2e', borderRadius: 12, padding: '14px 16px', border: '1px solid #1a2460' }}>
          <div style={S.sectionTitle}>GAME HISTORY ({gameHistory.length})</div>
          {gameHistory.map(game => <GameHistoryRow key={game.id} game={game} />)}
        </div>
      )}

      {statsTab === 'history' && gameHistory.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: '#6070a0', fontSize: 13 }}>No games yet.</div>
      )}

      {/* Current game tab */}
      {statsTab === 'current' && (
      <div style={S.summaryWrap}>
      {/* Current game */}
      {hasCurrentGame && (
        <div style={S.summaryHero}>
          <div style={S.scoreLbl}>{episodeMeta ? `SHOW #${episodeMeta.episodeNumber} · ${episodeMeta.airDate}` : 'CURRENT GAME'}</div>
          <div style={{ ...S.scoreVal, fontSize: 56, color: coryatScore >= 0 ? '#f5c518' : '#e74c3c' }}>
            {coryatScore >= 0 ? '+' : ''}{coryatScore.toLocaleString()}
          </div>
          <div style={{ fontSize: 12, color: '#6070a0', marginTop: 4 }}>{totalCorrect}✓ {totalIncorrect}✗ {totalPass} pass</div>
          <div style={{ ...S.progressOuter, marginTop: 12 }}><div style={{ ...S.progressInner, width: `${pct}%` }} /></div>
          <div style={{ fontSize: 11, color: '#8890c0', marginTop: 6, letterSpacing: 2 }}>{pct}% accuracy</div>
        </div>
      )}

      {/* All-time stats */}
      {gameHistory.length > 0 && (
        <div style={S.catBreakdown}>
          <div style={S.sectionTitle}>ALL-TIME STATS ({gameHistory.length} game{gameHistory.length !== 1 ? 's' : ''})</div>
          {/* Coryat averages */}
          <div style={{ fontSize: 9, color: '#4060a0', letterSpacing: 2, marginBottom: 6 }}>CORYAT SCORE</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
            {[['AVG', allTimeAvg], ['LAST 10', last10Avg], ['BEST', best]].map(([lbl, val]) => (
              <div key={lbl} style={{ ...S.statCell, padding: '10px 4px' }}>
                <div style={{ ...S.statN, fontSize: 20, color: '#f5c518' }}>{val !== null ? (val >= 0 ? '+' : '') + val.toLocaleString() : '—'}</div>
                <div style={S.statLbl}>{lbl}</div>
              </div>
            ))}
          </div>

          {/* Actual show score averages */}
          {gamesWithActual.length > 0 && (
            <>
              <div style={{ fontSize: 9, color: '#4060a0', letterSpacing: 2, marginBottom: 6 }}>ACTUAL SHOW SCORE (WITH WAGERS)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                {[['AVG', allTimeActualAvg], ['LAST 10', last10ActualAvg], ['BEST', bestActual]].map(([lbl, val]) => (
                  <div key={lbl} style={{ ...S.statCell, padding: '10px 4px' }}>
                    <div style={{ ...S.statN, fontSize: 20, color: '#4dd0e1' }}>{val !== null ? (val >= 0 ? '+' : '') + val.toLocaleString() : '—'}</div>
                    <div style={S.statLbl}>{lbl}</div>
                  </div>
                ))}
              </div>

              {/* Wagering impact */}
              {wageringImpact !== null && (
                <div style={{ background: '#060b1a', borderRadius: 8, padding: '10px 14px', border: '1px solid #1a2040', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#8890c0' }}>Wagering impact (avg)</div>
                    <div style={{ fontSize: 10, color: '#4060a0', letterSpacing: 1 }}>Actual score vs Coryat</div>
                  </div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: wageringImpact >= 0 ? '#4caf7d' : '#e57373' }}>
                    {wageringImpact >= 0 ? '+' : ''}{wageringImpact.toLocaleString()}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <DailyDoublePanel gameHistory={gameHistory} />
      <RetentionPanel cards={cards} />

      {gameHistory.length > 1 && <ScoreSparkline games={gameHistory.slice(0, 10).reverse()} />}

      {/* Category breakdown — only show if a game is in progress */}
      {singleBreakdown.length > 0 && (
        <div style={S.catBreakdown}>
          <div style={S.sectionTitle}>SINGLE JEOPARDY — CURRENT GAME</div>
          {singleBreakdown.map((cat, i) => (
            <div key={i} style={S.catRow}>
              <span style={{ fontSize: 13, color: '#a0acd0' }}>{cat.name}</span>
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: cat.score >= 0 ? '#4caf7d' : '#e57373' }}>{cat.score >= 0 ? '+' : ''}{cat.score.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
      {doubleBreakdown.length > 0 && (
        <div style={S.catBreakdown}>
          <div style={S.sectionTitle}>DOUBLE JEOPARDY — CURRENT GAME</div>
          {doubleBreakdown.map((cat, i) => (
            <div key={i} style={S.catRow}>
              <span style={{ fontSize: 13, color: '#a0acd0' }}>{cat.name}</span>
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: cat.score >= 0 ? '#4caf7d' : '#e57373' }}>{cat.score >= 0 ? '+' : ''}{cat.score.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* Game history */}
      {gameHistory.length > 0 && (
        <div style={S.catBreakdown}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={S.sectionTitle}>GAME HISTORY</div>
            <button style={{ fontSize: 10, color: '#4060a0', letterSpacing: 1 }} onClick={() => setHistoryView(!historyView)}>{historyView ? 'COLLAPSE' : 'EXPAND ALL'}</button>
          </div>
          {(historyView ? gameHistory : gameHistory.slice(0, 5)).map((game) => (
            <GameHistoryRow key={game.id} game={game} />
          ))}
          {!historyView && gameHistory.length > 5 && (
            <button style={{ fontSize: 11, color: '#4060a0', padding: '8px 0', width: '100%', letterSpacing: 1 }} onClick={() => setHistoryView(true)}>+ {gameHistory.length - 5} more games</button>
          )}
        </div>
      )}

      {!hasCurrentGame && gameHistory.length === 0 && (
        <div style={{ ...S.catBreakdown, textAlign: 'center', padding: '32px 16px' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
          <div style={{ color: '#6070a0', fontSize: 14 }}>Load an episode and play through it — your stats will appear here.</div>
        </div>
      )}

      <div style={S.explainer}>
        <div style={S.sectionTitle}>ABOUT CORYAT SCORING</div>
        <p style={{ fontSize: 13, color: '#6878a8', lineHeight: 1.6 }}>Correct answers add face value, incorrect subtract face value, Daily Doubles and Final Jeopardy are excluded. A score above $15,000 is competitive. Regular contestants average $20,000–$30,000.</p>
      </div>

      {/* Tournament / contestant result */}
      {(tournamentState || episodeMeta?.contestants?.length > 0) && (
        <OpponentCoryatResult
          coryatScore={coryatScore}
          actualScore={actualScore}
          fjAnswered={fjAnswered}
          actualContestants={episodeMeta?.contestants?.length > 0
            ? episodeMeta.contestants.filter(c => c.name)
            : null}
          tournamentState={tournamentState}
        />
      )}

      {/* Confidence vs actual */}
      {confidenceRatings && hasCurrentGame && singleBoard && (
        <ConfidenceComparison
          ratings={confidenceRatings}
          singleBreakdown={categoryBreakdown(singleBoard, singleClueStates)}
          doubleBreakdown={categoryBreakdown(doubleBoard, doubleClueStates)}
        />
      )}
      </div>)} {/* end current tab */}
    </div>
  )
}

// ─── Category Heat Map View ───────────────────────────────────────────────────
function CategoryHeatMapView({ gameHistory }) {
  const heatmap = buildCategoryHeatMap(gameHistory)
  const valueBreakdown = buildValueBreakdown(gameHistory)

  if (heatmap.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🗺</div>
        <div style={{ color: '#6070a0', fontSize: 13 }}>Play more games to build your category heat map.</div>
      </div>
    )
  }

  const maxAbs = Math.max(...heatmap.map(c => Math.abs(c.avg)), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Meta-category heat map */}
      <div style={{ background: '#0a0f2e', borderRadius: 12, padding: '14px 16px', border: '1px solid #1a2460' }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: '#6070a0', marginBottom: 12 }}>META-CATEGORY PERFORMANCE</div>
        {heatmap.map(cat => {
          const pct = Math.abs(cat.avg) / maxAbs * 100
          const isNeg = cat.avg < 0
          const intensity = pct / 100
          const bg = isNeg
            ? `rgba(229,115,115,${0.1 + intensity * 0.3})`
            : `rgba(76,175,77,${0.1 + intensity * 0.3})`
          return (
            <div key={cat.meta} style={{ marginBottom: 8, background: bg, borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 12, color: '#c0c8e8', fontWeight: 700 }}>{cat.meta}</span>
                <span style={{ fontSize: 12, fontFamily: "'Bebas Neue', sans-serif", color: isNeg ? '#e57373' : '#4caf7d' }}>
                  {cat.avg >= 0 ? '+' : ''}{cat.avg.toLocaleString()} avg · {cat.appearances} in {cat.games}g
                </span>
              </div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: isNeg ? '#e57373' : '#4caf7d', borderRadius: 99 }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Performance by value */}
      {valueBreakdown.some(v => v.total > 0) && (
        <div style={{ background: '#0a0f2e', borderRadius: 12, padding: '14px 16px', border: '1px solid #1a2460' }}>
          <div style={{ fontSize: 10, letterSpacing: 3, color: '#6070a0', marginBottom: 12 }}>PERFORMANCE BY DOLLAR VALUE</div>
          <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 80, marginBottom: 8 }}>
            {valueBreakdown.filter(v => v.total > 0).map(v => {
              const acc = v.accuracy || 0
              return (
                <div key={v.value} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ fontSize: 10, color: acc >= 60 ? '#4caf7d' : acc >= 40 ? '#ffb74d' : '#e57373' }}>
                    {acc}%
                  </div>
                  <div style={{ width: '100%', background: acc >= 60 ? '#4caf7d' : acc >= 40 ? '#ffb74d' : '#e57373', borderRadius: '3px 3px 0 0', height: `${acc}%`, minHeight: 4 }} />
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            {valueBreakdown.filter(v => v.total > 0).map(v => (
              <div key={v.value} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: '#6070a0' }}>
                ${v.value}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#6070a0', marginTop: 10, lineHeight: 1.6 }}>
            Accuracy by clue value (normalized — DJ $800 = SJ $400 equivalent).
          </div>
        </div>
      )}
    </div>
  )
}

function ConfidenceComparison({ ratings, singleBreakdown, doubleBreakdown }) {
  const all = [...(singleBreakdown || []), ...(doubleBreakdown || [])]
  const rated = all.filter(cat => ratings[cat.name] !== undefined)
  if (rated.length === 0) return null

  const LABELS = ['Weak 😬', 'OK 😐', 'Good 🙂', 'Strong 😎']

  return (
    <div style={{ background: '#0a0f2e', borderRadius: 12, padding: '14px 16px', border: '1px solid #1a2460' }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: '#6070a0', marginBottom: 10 }}>CONFIDENCE VS ACTUAL</div>
      {rated.map(cat => {
        const confidence = ratings[cat.name]
        const isPositive = cat.score >= 0
        const match = (confidence >= 2 && isPositive) || (confidence <= 1 && !isPositive)
        return (
          <div key={cat.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1a2040' }}>
            <div>
              <div style={{ fontSize: 12, color: '#a0acd0' }}>{cat.name}</div>
              <div style={{ fontSize: 10, color: '#4060a0' }}>Predicted: {LABELS[confidence]}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: isPositive ? '#4caf7d' : '#e57373' }}>
                {cat.score >= 0 ? '+' : ''}{cat.score.toLocaleString()}
              </div>
              <div style={{ fontSize: 10, color: match ? '#7cd992' : '#f5c518' }}>{match ? '✓ accurate' : '⚠ surprised'}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Score Sparkline ──────────────────────────────────────────────────────────
// Daily Doubles are the one part of board play Coryat cannot see, because it counts
// them at face value and ignores the wager entirely.
function DailyDoublePanel({ gameHistory }) {
  const dd = useMemo(() => buildDailyDoubleStats(gameHistory), [gameHistory])
  if (!dd.gamesWithNet) return null

  const good = dd.net >= 0
  return (
    <div style={{ background: '#0a0f2e', borderRadius: 10, padding: '14px 16px', border: '1px solid #1a2460', marginTop: 12 }}>
      <div style={{ fontSize: 9, letterSpacing: 3, color: '#6070a0', marginBottom: 10 }}>DAILY DOUBLE WAGERING</div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 34, lineHeight: 1, color: good ? '#4caf7d' : '#e57373' }}>
            {good ? '+' : ''}{dd.net.toLocaleString()}
          </div>
          <div style={{ fontSize: 10, color: '#4060a0', letterSpacing: 1 }}>
            LIFETIME · {good ? 'ahead of' : 'behind'} flat Coryat
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: '#c0c8e8' }}>
            {dd.netPerGame >= 0 ? '+' : ''}{dd.netPerGame?.toLocaleString()}
          </div>
          <div style={{ fontSize: 10, color: '#4060a0', letterSpacing: 1 }}>PER GAME</div>
        </div>
      </div>

      {dd.logged > 0 ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
            {[
              ['HIT RATE', dd.hitRate === null ? '—' : dd.hitRate + '%', dd.hitRate >= 50 ? '#4caf7d' : '#ffb74d'],
              ['AVG WAGER', dd.avgWager === null ? '—' : '$' + dd.avgWager.toLocaleString(), '#4dd0e1'],
              ['BEST HIT', dd.biggestWin ? '$' + dd.biggestWin.toLocaleString() : '—', '#4caf7d'],
            ].map(([lbl, val, col]) => (
              <div key={lbl} style={{ ...S.statCell, padding: '10px 4px' }}>
                <div style={{ ...S.statN, fontSize: 18, color: col }}>{val}</div>
                <div style={S.statLbl}>{lbl}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: '#4060a0', marginTop: 8, letterSpacing: 1 }}>
            {dd.hits} hit · {dd.misses} missed{dd.passes ? ` · ${dd.passes} passed` : ''}
            {dd.trueDDs > 0 && ` · ${dd.trueDDs} true DD${dd.trueDDs !== 1 ? 's' : ''}`}
            {dd.biggestLoss > 0 && ` · worst loss $${dd.biggestLoss.toLocaleString()}`}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 10, color: '#4060a0', marginTop: 10, lineHeight: 1.5, letterSpacing: 1 }}>
          Net is derived from past scores. Hit rate and wager size need per-wager
          detail, which is recorded from v2.5.8 onward — play a game to start it.
        </div>
      )}
    </div>
  )
}

// Retention answers the question the deck size can't: is any of this sticking?
// The series only counts cards that were already learned, so it measures the
// schedule rather than the difficulty of first encounters.
function RetentionPanel({ cards = [] }) {
  const log = useMemo(() => getReviewLog(), [cards.length])
  const health = useMemo(() => buildDeckHealth(cards), [cards])
  const series = useMemo(() => buildRetentionSeries(log, { bucketDays: 7, buckets: 8 }), [log])
  const recall = useMemo(() => summariseRecall(log), [log])

  if (!cards.length) return null

  const withData = series.filter(b => b.retention !== null)
  const overall = (() => {
    const learned = log.filter(e => e.l)
    if (!learned.length) return null
    return Math.round((learned.filter(e => e.q > 0).length / learned.length) * 100)
  })()

  const W = 280, H = 60
  const pts = series.map((b, i) => ({
    x: (i / Math.max(1, series.length - 1)) * W,
    y: b.retention === null ? null : H - ((b.retention - 50) / 50) * H, // 50–100% band
    b,
  }))
  const drawn = pts.filter(p => p.y !== null)

  return (
    <div style={{ background: '#0a0f2e', borderRadius: 10, padding: '14px 16px', border: '1px solid #1a2460', marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span style={{ fontSize: 9, letterSpacing: 3, color: '#6070a0' }}>RETENTION</span>
        {overall !== null && (
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: overall >= 85 ? '#4caf7d' : overall >= 75 ? '#ffb74d' : '#e57373' }}>
            {overall}%
          </span>
        )}
      </div>

      {withData.length >= 2 ? (
        <>
          <svg viewBox={`0 -8 ${W} ${H + 16}`} style={{ width: '100%', height: 76, overflow: 'visible' }}>
            {/* 85% is the conventional target band for a healthy schedule */}
            <line x1="0" x2={W} y1={H - (35 / 50) * H} y2={H - (35 / 50) * H}
                  stroke="#2a3480" strokeWidth="1" strokeDasharray="3 3" />
            <polyline
              points={drawn.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none" stroke="#4dd0e1" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
            />
            {drawn.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" fill="#4dd0e1" />)}
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#4060a0', letterSpacing: 1 }}>
            <span>{series[0].label}</span>
            <span style={{ color: '#2a3480' }}>dashed line = 85% target</span>
            <span>now</span>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 10, color: '#4060a0', lineHeight: 1.5, letterSpacing: 1, marginBottom: 10 }}>
          {log.length
            ? `Building the curve — ${log.filter(e => e.l).length} review${log.filter(e => e.l).length === 1 ? '' : 's'} of learned cards logged so far. Needs a couple of weeks to show a trend.`
            : 'Retention needs a review history, which starts from your next study session.'}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 12 }}>
        {[
          ['MATURE', `${health.maturePct}%`, '#4caf7d'],
          ['LEARNED', health.learned.toLocaleString(), '#c0c8e8'],
          ['LAPSED', health.lapsed.toLocaleString(), health.lapsed ? '#ffb74d' : '#4060a0'],
          ['LEECHES', health.leeches.toLocaleString(), health.leeches ? '#e57373' : '#4060a0'],
        ].map(([lbl, val, col]) => (
          <div key={lbl} style={{ ...S.statCell, padding: '9px 2px' }}>
            <div style={{ ...S.statN, fontSize: 16, color: col }}>{val}</div>
            <div style={S.statLbl}>{lbl}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 9, color: '#4060a0', marginTop: 6, letterSpacing: 1 }}>
        Mature = interval of 21 days or more{health.avgEase ? ` · avg ease ${health.avgEase}` : ''}
      </div>

      {/* Recall speed. Every review since the timing went in has recorded how long the
          answer took to come, and nothing displayed it — which is the difference between
          knowing a card and knowing it fast enough to buzz. */}
      {recall.n > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #131a35' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ fontSize: 9, letterSpacing: 3, color: '#6070a0' }}>RECALL SPEED</span>
            <span style={{ fontSize: 11, color: '#8890c0', letterSpacing: 1 }}>
              median <b style={{ color: '#4dd0e1', fontFamily: "'Bebas Neue', sans-serif", fontSize: 15 }}>{formatRecall(recall.median)}</b>
              <span style={{ color: '#4060a0' }}> · {recall.n.toLocaleString()} timed</span>
            </span>
          </div>
          <div style={{ display: 'flex', height: 6, borderRadius: 99, overflow: 'hidden', background: '#131a35' }}>
            {[
              ['fast', recall.fast, '#4caf7d'],
              ['ok', recall.ok, '#f5c518'],
              ['slow', recall.slow, '#e57373'],
            ].map(([k, n, c]) => n > 0 && (
              <div key={k} style={{ width: `${(n / recall.n) * 100}%`, background: c }} title={`${n} ${k}`} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#4060a0', marginTop: 5, letterSpacing: 1 }}>
            <span style={{ color: '#4caf7d' }}>{recall.fast} instant (&lt;2s)</span>
            <span style={{ color: '#f5c518' }}>{recall.ok} comfortable</span>
            <span style={{ color: '#e57373' }}>{recall.slow} slow (&gt;4s)</span>
          </div>
        </div>
      )}
    </div>
  )
}

function ScoreSparkline({ games }) {
  const scores = games.map(g => g.coryatScore)
  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const range = max - min || 1
  const w = 280, h = 60, pad = 8

  const points = scores.map((s, i) => {
    const x = pad + (i / Math.max(scores.length - 1, 1)) * (w - pad * 2)
    const y = pad + (1 - (s - min) / range) * (h - pad * 2)
    return `${x},${y}`
  }).join(' ')

  return (
    <div style={{ ...S.catBreakdown, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={S.sectionTitle}>LAST {games.length} GAMES TREND</div>
      <svg width={w} height={h} style={{ overflow: 'visible' }}>
        <polyline points={points} fill="none" stroke="#f5c518" strokeWidth="2" strokeLinejoin="round" />
        {scores.map((s, i) => {
          const x = pad + (i / Math.max(scores.length - 1, 1)) * (w - pad * 2)
          const y = pad + (1 - (s - min) / range) * (h - pad * 2)
          return <circle key={i} cx={x} cy={y} r="3" fill="#f5c518" />
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: w, fontSize: 9, color: '#4060a0', marginTop: 4 }}>
        <span>{games[0]?.airDate?.split(',')[0]}</span>
        <span>{games[games.length - 1]?.airDate?.split(',')[0]}</span>
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  app: { fontFamily: "'Barlow Condensed', sans-serif", background: '#060b1a', minHeight: '100dvh', color: '#e8e8f0' },
  header: { display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', padding: '12px 16px', paddingTop: 'calc(12px + env(safe-area-inset-top))', background: 'linear-gradient(135deg, #0a0f2e 0%, #0f1e6e 100%)', borderBottom: '3px solid #f5c518', boxShadow: '0 4px 20px rgba(245,197,24,0.2)' },
  logoMain: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: '#f5c518', letterSpacing: 4 },
  logoSub: { fontSize: 9, letterSpacing: 3, color: '#8890c0', marginTop: -4 },
  scoreBox: { textAlign: 'center' },
  scoreLbl: { fontSize: 10, letterSpacing: 3, color: '#8890c0' },
  scoreVal: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 38, lineHeight: 1.1 },
  headerStats: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 },
  pill: { fontSize: 11, background: 'rgba(255,255,255,0.07)', borderRadius: 20, padding: '3px 10px', color: '#c0c8e8', letterSpacing: 1 },
  authBtn: { fontSize: 16, padding: '2px 4px' },

  nav: { display: 'flex', background: '#0a0f2e', borderBottom: '1px solid #1a2460', overflowX: 'auto' },
  navBtn: { padding: '11px 12px', fontSize: 11, letterSpacing: 1.5, color: '#5060a0', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, borderBottom: '3px solid transparent', whiteSpace: 'nowrap', flex: 1 },
  navActive: { color: '#f5c518', borderBottomColor: '#f5c518' },

  main: { padding: '14px', paddingBottom: 'calc(32px + env(safe-area-inset-bottom))' },

  board: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 3 },
  catHeader: { background: '#0f1e6e', color: '#f5c518', fontFamily: "'Bebas Neue', sans-serif", fontSize: 12, textAlign: 'center', padding: '10px 4px', borderRadius: 4, border: '1px solid #1a2e9e', lineHeight: 1.2 },
  tile: { aspectRatio: '1/0.8', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, border: '1px solid #1a2e9e', flexDirection: 'column' },
  tileVal: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: '#f5c518', textAlign: 'center' },
  tileIcon: { fontSize: 16, color: 'rgba(255,255,255,0.5)' },
  ddTag: { display: 'block', fontSize: 8, color: '#fff', background: '#b8960a', borderRadius: 2, padding: '1px 3px', marginBottom: 1 },
  legend: { display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', padding: '10px 0 2px', fontSize: 10, color: '#6070a0' },
  legendItem: { display: 'flex', alignItems: 'center', gap: 3 },

  loaderBar: { display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' },
  loaderInput: { flex: 1, background: '#0a0f2e', border: '1px solid #1a2460', borderRadius: 8, color: '#e8e8f0', fontSize: 16, padding: '8px 12px', fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 1 },
  loaderBtn: { background: 'rgba(245,197,24,0.1)', border: '1px solid rgba(245,197,24,0.3)', borderRadius: 8, color: '#f5c518', fontSize: 12, fontWeight: 700, padding: '8px 14px', fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 1, whiteSpace: 'nowrap' },
  loadError: { fontSize: 12, color: '#e07070', background: 'rgba(224,112,112,0.08)', borderRadius: 8, padding: '8px 12px', marginBottom: 8 },
  episodeLink: { textAlign: 'right', marginBottom: 6 },

  roundTabs: { display: 'flex', gap: 4 },
  roundTab: { fontSize: 11, letterSpacing: 1, color: '#5060a0', background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '7px 12px', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, border: '1px solid #1a2460' },
  roundTabActive: { color: '#f5c518', background: 'rgba(245,197,24,0.08)', borderColor: '#f5c518' },
  roundScores: { display: 'flex', gap: 12, fontSize: 12, color: '#6070a0', alignItems: 'center' },
  roundScore: { letterSpacing: 1 },

  fjBar: { background: '#0a0f2e', border: '1px solid #1a3460', borderRadius: 10, padding: '12px 14px', marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  fjLabel: { fontSize: 11, color: '#8890c0', letterSpacing: 1 },
  fjBtn: { background: 'rgba(77,208,225,0.1)', border: '1px solid rgba(77,208,225,0.3)', borderRadius: 8, color: '#4dd0e1', fontSize: 12, fontWeight: 700, padding: '7px 14px', fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 1 },

  browserHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #1a2460' },
  browserTitle: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: '#f5c518', letterSpacing: 2 },
  browserControls: { display: 'flex', gap: 8, padding: '12px 16px', borderBottom: '1px solid #1a2040' },
  seasonSelect: { background: '#060b1a', border: '1px solid #1a2460', borderRadius: 8, color: '#e8e8f0', fontSize: 12, padding: '8px 10px', fontFamily: "'Barlow Condensed', sans-serif" },
  browserCount: { display: 'flex', justifyContent: 'space-between', padding: '7px 20px', fontSize: 10, letterSpacing: 1.5, color: '#4060a0', borderBottom: '1px solid #0f1530' },
  browserList: { flex: 1, overflowY: 'auto', padding: '8px 0' },
  browserLoading: { textAlign: 'center', color: '#6070a0', padding: '24px', fontSize: 13 },
  episodeRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', width: '100%', textAlign: 'left', borderBottom: '1px solid #0f1530', background: 'none' },
  epShowNum: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: '#f5c518', minWidth: 70 },
  epDate: { flex: 1, fontSize: 13, color: '#a0acd0' },
  epScore: { fontSize: 11, color: '#4caf7d', fontVariantNumeric: 'tabular-nums', flexShrink: 0 },
  epArrow: { fontSize: 12, color: '#2a3580' },

  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 },
  modal: { background: 'linear-gradient(160deg,#0f1e6e,#060b1a)', border: '2px solid #f5c518', borderRadius: 12, padding: '28px 20px 20px', maxWidth: 480, width: '100%', textAlign: 'center', position: 'relative', boxShadow: '0 20px 60px rgba(245,197,24,0.2)' },
  closeX: { position: 'absolute', top: 10, right: 12, fontSize: 16, color: '#4050a0' },
  modalCat: { fontSize: 10, letterSpacing: 3, color: '#f5c518', marginBottom: 4 },
  modalVal: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 40, color: '#f5c518', lineHeight: 1 },
  ddBadge: { color: '#ffd700', fontSize: 12, letterSpacing: 2, marginTop: 4 },
  modalText: { fontSize: 17, color: '#e8e8f0', lineHeight: 1.5, margin: '18px 0', padding: '0 4px' },
  modalQ: { fontSize: 15, color: '#7cd992', fontStyle: 'italic', margin: '14px 0', padding: 10, background: 'rgba(124,217,146,0.08)', borderRadius: 8, border: '1px solid rgba(124,217,146,0.15)' },
  revealBtn: { background: '#f5c518', color: '#060b1a', borderRadius: 8, padding: '11px 28px', fontSize: 14, fontWeight: 700, letterSpacing: 2, fontFamily: "'Barlow Condensed', sans-serif" },
  markRow: { display: 'flex', gap: 8 },
  markBtn: { borderRadius: 8, padding: '10px 0', fontSize: 13, fontWeight: 700, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", flex: 1 },

  studyLanding: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 16px', gap: 12, textAlign: 'center' },
  studyIcon: { fontSize: 48 },
  studyTitle: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: '#f5c518', letterSpacing: 3 },
  studySubtitle: { fontSize: 16, color: '#c0c8e8' },
  studyMeta: { fontSize: 13, color: '#6070a0', lineHeight: 1.6, maxWidth: 380 },
  startBtn: { background: '#f5c518', color: '#060b1a', borderRadius: 8, padding: '13px 32px', fontSize: 15, fontWeight: 700, letterSpacing: 2, fontFamily: "'Barlow Condensed', sans-serif", marginTop: 8 },
  nextDueBox: { background: '#0a0f2e', borderRadius: 10, padding: '14px 24px', border: '1px solid #1a2460' },
  nextDueLbl: { fontSize: 10, letterSpacing: 3, color: '#6070a0' },
  nextDueVal: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: '#f5c518', marginTop: 2 },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, width: '100%', maxWidth: 340, marginBottom: 8 },
  statCell: { background: '#0a0f2e', borderRadius: 8, padding: '12px 4px', textAlign: 'center', border: '1px solid #1a2460' },
  statN: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 28 },
  statLbl: { fontSize: 10, color: '#6070a0', letterSpacing: 2 },

  studyWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 },
  progressOuter: { width: '100%', height: 4, background: '#1a2040', borderRadius: 99, overflow: 'hidden' },
  progressInner: { height: '100%', background: '#f5c518', borderRadius: 99, transition: 'width 0.4s' },
  studyCount: { fontSize: 11, color: '#4060a0', letterSpacing: 3 },
  cardMeta: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  cardCat: { fontSize: 10, letterSpacing: 2, color: '#f5c518', background: 'rgba(245,197,24,0.08)', borderRadius: 4, padding: '2px 8px' },
  cardValBadge: { fontSize: 10, color: '#8890c0', background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '2px 8px' },
  cardSource: { fontSize: 10, letterSpacing: 2, borderRadius: 4, padding: '2px 8px', background: 'rgba(255,255,255,0.05)' },
  flashCard: { width: '100%', maxWidth: 480, minHeight: 240, background: 'linear-gradient(150deg,#0f1e6e,#060b1a)', border: '2px solid #2a3580', borderRadius: 14, display: 'flex', flexDirection: 'column', alignItems: 'stretch', cursor: 'pointer', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', overflow: 'hidden' },
  flashInner: { padding: 24, textAlign: 'center', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  flashSide: { fontSize: 10, letterSpacing: 4, color: '#f5c518', marginBottom: 12 },
  flashFrontText: { fontSize: 17, color: '#e8e8f0', lineHeight: 1.55 },
  flashBackText: { fontSize: 20, color: '#7cd992', fontStyle: 'italic', lineHeight: 1.55 },
  flashHint: { fontSize: 10, color: '#2a3480', marginTop: 18, letterSpacing: 2 },
  rateRow: { display: 'flex', gap: 8, width: '100%', maxWidth: 480 },
  rateBtn: { flex: 1, borderRadius: 8, padding: '10px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', border: '1px solid', fontFamily: "'Barlow Condensed', sans-serif" },

  deckWrap: { display: 'flex', flexDirection: 'column', gap: 12 },
  deckActions: { display: 'flex', flexDirection: 'column', gap: 8 },
  actionBtn: { flex: 1, fontSize: 12, letterSpacing: 1.5, color: '#f5c518', background: 'rgba(245,197,24,0.06)', borderRadius: 8, padding: '9px 0', fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", border: '1px solid rgba(245,197,24,0.2)' },
  actionBtnActive: { background: 'rgba(245,197,24,0.15)', borderColor: 'rgba(245,197,24,0.5)' },
  addForm: { background: '#0a0f2e', borderRadius: 12, padding: 16, border: '1px solid #1a2460', display: 'flex', flexDirection: 'column', gap: 6 },
  formLabel: { fontSize: 10, letterSpacing: 3, color: '#6070a0' },
  // 16px keeps iOS from zooming the page when a field takes focus, which is what the
  // viewport's user-scalable=no used to suppress.
  textarea: { background: '#060b1a', border: '1px solid #1a2460', borderRadius: 8, color: '#e8e8f0', fontSize: 16, padding: '10px 12px', fontFamily: "'Barlow', sans-serif", resize: 'vertical' },
  input: { background: '#060b1a', border: '1px solid #1a2460', borderRadius: 8, color: '#e8e8f0', fontSize: 16, padding: '9px 12px', fontFamily: "'Barlow Condensed', sans-serif" },
  importTitle: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: '#f5c518', letterSpacing: 2, marginBottom: 4 },
  importDesc: { fontSize: 13, color: '#8890c0', lineHeight: 1.6 },
  importHowTo: { fontSize: 12, color: '#6070a0', lineHeight: 1.6, background: '#060b1a', borderRadius: 8, padding: '10px 12px', border: '1px solid #1a2040' },
  importStatus: { fontSize: 13, color: '#f5c518', textAlign: 'center', padding: '12px 0' },
  importSuccess: { fontSize: 13, color: '#7cd992', textAlign: 'center', padding: '10px', background: 'rgba(124,217,146,0.08)', borderRadius: 8 },
  importError: { fontSize: 13, color: '#e07070', textAlign: 'center', padding: '10px', background: 'rgba(224,112,112,0.08)', borderRadius: 8 },
  code: { background: '#060b1a', padding: '1px 5px', borderRadius: 4, fontSize: 12, color: '#4dd0e1', border: '1px solid #1a2040' },
  deckTabs: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  filterTab: { fontSize: 10, letterSpacing: 1.5, color: '#5060a0', background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '5px 10px', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, border: '1px solid #1a2460' },
  filterTabActive: { color: '#f5c518', background: 'rgba(245,197,24,0.08)', borderColor: '#f5c518' },
  emptyDeck: { padding: '40px 16px' },
  cardList: { display: 'flex', flexDirection: 'column', gap: 8 },
  cardRow: { background: '#0a0f2e', borderRadius: 10, padding: '12px 14px', border: '1px solid #1a2460', display: 'flex', gap: 12, alignItems: 'flex-start' },
  cardRowMain: { flex: 1, minWidth: 0 },
  cardRowFront: { fontSize: 13, color: '#c0c8e8', lineHeight: 1.4 },
  cardRowBack: { fontSize: 12, color: '#7cd992', fontStyle: 'italic', marginTop: 4, lineHeight: 1.4 },
  cardRowMeta: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 },
  metaTag: { fontSize: 9, letterSpacing: 1.5, color: '#4060a0', background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '2px 6px' },
  cardRowActions: { display: 'flex', flexDirection: 'column', gap: 6 },
  iconBtn: { fontSize: 15, color: '#4060a0', background: 'none', padding: 2 },

  summaryWrap: { display: 'flex', flexDirection: 'column', gap: 16 },
  summaryHero: { background: 'linear-gradient(135deg,#0f1e6e,#060b1a)', borderRadius: 12, padding: '20px 16px', textAlign: 'center', border: '1px solid #1a2e9e' },
  catBreakdown: { background: '#0a0f2e', borderRadius: 12, padding: '14px 16px', border: '1px solid #1a2460' },
  sectionTitle: { fontSize: 10, letterSpacing: 3, color: '#6070a0', marginBottom: 10 },
  catRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #1a2040' },
  explainer: { background: '#0a0f2e', borderRadius: 12, padding: '14px 16px', border: '1px solid #1a2460' },

  // Study config
  configPanel: { width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 16 },
  configRow: { background: '#0a0f2e', borderRadius: 10, padding: '12px 14px', border: '1px solid #1a2460', display: 'flex', flexDirection: 'column', gap: 8 },
  configLabel: { fontSize: 9, letterSpacing: 3, color: '#6070a0' },
  toggleGroup: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  toggleBtn: { flex: '1 1 68px', minWidth: 0, fontSize: 12, fontWeight: 700, letterSpacing: 1, color: '#5060a0', background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '8px 4px', fontFamily: "'Barlow Condensed', sans-serif", border: '1px solid #1a2460' },
  toggleActive: { color: '#f5c518', background: 'rgba(245,197,24,0.08)', borderColor: '#f5c518' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 120, overflowY: 'auto' },
  chip: { fontSize: 11, letterSpacing: 1, color: '#5060a0', background: 'rgba(255,255,255,0.04)', borderRadius: 20, padding: '5px 12px', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, border: '1px solid #1a2460', whiteSpace: 'nowrap' },
  chipActive: { color: '#f5c518', background: 'rgba(245,197,24,0.08)', borderColor: '#f5c518' },
  configFooter: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 4 },
  matchCount: { display: 'flex', alignItems: 'baseline' },
}

const globalCSS = `
  /* Fonts are requested once from index.html — see the comment there. */
  /* Anki card content styles */
  .card-content img { max-width: 100%; height: auto; border-radius: 6px; margin: 4px 0; display: block; }
  .card-content audio { width: 100%; margin-top: 8px; }
  .card-content b, .card-content strong { color: #f5c518; }
  .card-content em { color: #c0c8e8; font-style: italic; }
  .card-content br { display: block; margin: 2px 0; content: ''; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #060b1a; overscroll-behavior: none; }
  button { cursor: pointer; border: none; background: none; font-family: inherit; }
  textarea:focus, input:focus, select:focus { outline: 1px solid #f5c518; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: #0a0f2e; }
  ::-webkit-scrollbar-thumb { background: #1a2460; border-radius: 99px; }
`
