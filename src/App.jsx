import { useState, useEffect, useCallback, useRef } from 'react'
import { sm2, newCard, formatRelative, nextDueLabel } from './srs.js'
import { loadCards, saveCards, loadGameHistory, saveGameHistory } from './storage.js'
import { parseApkg, migrateLocalMediaToSupabase } from './ankiImport.js'
import { SAMPLE_BOARD } from './boardData.js'
import { fetchEpisode, episodeToBoard, searchEpisodesByCategory } from './jarchive.js'
import { supabase, signIn, signUp, resetPassword, signOut, loadRemoteData, saveRemoteData, mergeData, saveGameStateRemote, loadGameStateRemote, uploadMedia } from './supabase.js'
import { buildCategoryHeatMap, buildValueBreakdown, predictCoryat, exportToApkg, getMetaCategory, META_CATEGORY_NAMES } from './analytics.js'
import { CardContent, cardIsHtml } from './CardContent.jsx'
import { getMediaStats, clearAllMedia } from './mediaStore.js'
import { loadGameState, saveGameState, clearGameState, loadEpisodeCache, saveEpisodeToCache, getEpisodeFromCache, pinEpisode, unpinEpisode, removeEpisodeFromCache, getCacheStats } from './storage.js'
import { WeaknessTracker, SpeedTracker, CategoryConfidenceModal, WagerTrainer, TournamentSetup, TournamentSetup as TournamentSetupModal, OpponentScoreBar, OpponentCoryatResult, calcStreak, generateOpponent, HISTORICAL_CORYAT } from './training.jsx'

const CLUE_STATES = { UNANSWERED: 'unanswered', CORRECT: 'correct', INCORRECT: 'incorrect', PASS: 'pass' }
const CORYAT_VAL = { correct: v => v, incorrect: v => -v, pass: () => 0, unanswered: () => 0 }

function initClueStates(board) {
  const s = {}
  board.categories.forEach((cat, ci) =>
    cat.clues.forEach((_, ri) => { s[`${ci}-${ri}`] = CLUE_STATES.UNANSWERED })
  )
  return s
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
  const [episodeList, setEpisodeList] = useState([]) // for prev/next nav
  const [currentEpIndex, setCurrentEpIndex] = useState(-1)
  const [boardLoading, setBoardLoading] = useState(true)
  const [boardError, setBoardError] = useState(null)

  const [singleClueStates, setSingleClueStates] = useState({})
  const [doubleClueStates, setDoubleClueStates] = useState({})

  const [activeClue, setActiveClue] = useState(null)
  const [showAnswer, setShowAnswer] = useState(false)
  const [showFJ, setShowFJ] = useState(false)
  const [fjAnswered, setFjAnswered] = useState(null)
  const [timedMode, setTimedMode] = useState(false)
  const [tournamentMode, setTournamentMode] = useState(false)
  const tournamentModeRef = useRef(false)
  const [tournamentState, setTournamentState] = useState(null) // { position, opponents }
  const [showTournamentSetup, setShowTournamentSetup] = useState(false)
  const [showConfidence, setShowConfidence] = useState(false)
  const [confidenceRatings, setConfidenceRatings] = useState(null)
  const [wagerState, setWagerState] = useState(null) // { type, resolve }
  const [buzzTimeRef] = useState({ start: null }) // for tracking buzz times

  const [cards, setCards] = useState([])
  const [gameHistory, setGameHistory] = useState([])
  const [storageReady, setStorageReady] = useState(false)
  const [showBrowser, setShowBrowser] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [gameStarted, setGameStarted] = useState(false) // true after Start button tapped
  const [showStartScreen, setShowStartScreen] = useState(false)
  const [actualScore, setActualScore] = useState(0) // real show score including wagers
  const [wagerAmount, setWagerAmount] = useState(null) // pending wager
  const [resumePrompt, setResumePrompt] = useState(null) // saved game state to restore
  const [showCache, setShowCache] = useState(false)
  const [showCategorySearch, setShowCategorySearch] = useState(false)

  const syncTimeout = useRef(null)

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

  // ── Load local data ───────────────────────────────────────────────────────
  useEffect(() => {
    setCards(loadCards())
    setGameHistory(loadGameHistory())
    setStorageReady(true)
  }, [])

  // ── Auto-load latest episode + episode list on mount ────────────────────
  useEffect(() => {
    if (!authChecked) return
    // Load episode list so prev/next work immediately
    fetch('/.netlify/functions/episodes')
      .then(r => r.json())
      .then(data => {
        if (data.episodes?.length) {
          setEpisodeList(data.episodes)
          setCurrentEpIndex(0) // latest is index 0
        }
      })
      .catch(() => {}) // non-critical
    // Load latest episode, fall back to known recent ID
    loadEpisode('latest', true).catch(() => loadEpisode('9200', true))
  }, [authChecked])

  // ── Sync from Supabase when user logs in ──────────────────────────────────
  useEffect(() => {
    if (!user || !storageReady) return
    setSyncing(true)
    setSyncError(null)
    loadRemoteData()
      .then(remote => {
        const local = { cards, gameHistory }
        const merged = mergeData(local, remote)
        setCards(merged.cards)
        setGameHistory(merged.gameHistory)
        saveCards(merged.cards)
        saveGameHistory(merged.gameHistory)
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
    saveGameHistory(gameHistory)
    if (user) {
      clearTimeout(syncTimeout.current)
      syncTimeout.current = setTimeout(() => {
        setSyncing(true)
        saveRemoteData(cards, gameHistory)
          .catch(err => setSyncError(err.message))
          .finally(() => setSyncing(false))
      }, 2000)
    }
  }, [cards, gameHistory, storageReady, user])

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
    if (!episodeMeta || !gameStarted) return
    const state = {
      episodeData, episodeMeta, round, board,
      singleClueStates, doubleClueStates,
      fjAnswered, coryatScore: singleCoryat + doubleCoryat,
      actualScore, confidenceRatings, tournamentState,
    }
    saveGameState(state)
    if (user) saveGameStateRemote(state).catch(console.error)
  }

  async function loadEpisode(gameId, silent = false) {
    // Auto-save current game if one is in progress
    if (gameStarted && episodeMeta) autoSaveCurrentGame()

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
      if (episode.doubleJeopardy) {
        const { board: djBoard } = episodeToBoard(episode, 'double')
        setDoubleClueStates(initClueStates(djBoard))
      } else {
        setDoubleClueStates({})
      }
      setFjAnswered(null)
      setActiveClue(null)
      setConfidenceRatings(null)
      setShowStartScreen(true) // show start screen with predicted Coryat + confidence
    } catch (err) {
      setBoardError(err.message)
      if (!board) setBoard(SAMPLE_BOARD)
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

  function openClue(ci, ri) {
    if (clueStates[`${ci}-${ri}`] !== CLUE_STATES.UNANSWERED) return
    const clue = board.categories[ci].clues[ri]
    const category = board.categories[ci].name
    // In tournament mode, intercept Daily Doubles for wagering
    if (clue.isDailyDouble && tournamentModeRef.current) {
      setWagerState({ type: 'daily_double', ci, ri, clue, category })
      return
    }
    setActiveClue({ ci, ri, clue, category })
    setShowAnswer(false)
  }

  function markClue(result) {
    const { ci, ri, clue, category } = activeClue
    setClueStates(prev => ({ ...prev, [`${ci}-${ri}`]: result }))
    if (result === CLUE_STATES.INCORRECT || result === CLUE_STATES.PASS) {
      addMissedAsCard(clue, category)
    }
    // Track actual show score (with wagers for DD)
    const effectiveValue = clue.wager || clue.value
    if (result === CLUE_STATES.CORRECT) setActualScore(s => s + effectiveValue)
    else if (result === CLUE_STATES.INCORRECT) setActualScore(s => s - effectiveValue)
    setActiveClue(null)
  }

  // ── Scores ────────────────────────────────────────────────────────────────
  const singleBoard = episodeData ? episodeToBoard(episodeData, 'single').board : null
  const doubleBoard = episodeData?.doubleJeopardy ? episodeToBoard(episodeData, 'double').board : null
  const singleCoryat = calcCoryat(singleClueStates, singleBoard)
  const doubleCoryat = doubleBoard ? calcCoryat(doubleClueStates, doubleBoard) : 0
  const coryatScore = singleCoryat + doubleCoryat

  const totalClues = board?.categories?.length * 5 || 0

  // Calculate remaining board value for wager trainer
  const remainingBoardValue = board?.categories?.reduce((sum, cat, ci) => {
    return sum + cat.clues.reduce((s, clue, ri) => {
      const state = clueStates[`${ci}-${ri}`]
      return s + (state === 'unanswered' && !clue.isDailyDouble ? clue.value : 0)
    }, 0)
  }, 0) || 0
  const answeredCount = Object.values(clueStates).filter(s => s !== CLUE_STATES.UNANSWERED).length
  const correctCount = Object.values(clueStates).filter(s => s === CLUE_STATES.CORRECT).length
  const incorrectCount = Object.values(clueStates).filter(s => s === CLUE_STATES.INCORRECT).length
  const dueCount = cards.filter(c => c.dueAt <= Date.now()).length

  // ── Save game ─────────────────────────────────────────────────────────────
  function saveGame(fjResult) {
    if (!episodeMeta) return
    const totalCorrect = Object.values(singleClueStates).filter(s => s === 'correct').length + Object.values(doubleClueStates).filter(s => s === 'correct').length
    const totalIncorrect = Object.values(singleClueStates).filter(s => s === 'incorrect').length + Object.values(doubleClueStates).filter(s => s === 'incorrect').length
    const totalPass = Object.values(singleClueStates).filter(s => s === 'pass').length + Object.values(doubleClueStates).filter(s => s === 'pass').length

    // Build per-category breakdown for history view
    function buildBreakdown(board, states) {
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
      airDate: episodeMeta.airDate,
      playedAt: new Date().toISOString(),
      singleCoryat,
      doubleCoryat,
      coryatScore,
      actualScore,
      totalCorrect,
      totalIncorrect,
      totalPass,
      finalJeopardy: fjResult || null,
      singleBreakdown: buildBreakdown(singleBoard, singleClueStates),
      doubleBreakdown: buildBreakdown(doubleBoard, doubleClueStates),
      valueBreakdown,
      confidenceRatings: confidenceRatings || null,
      contestants: episodeMeta.contestants || null,
      tournamentResult: tournamentState ? {
        position: tournamentState.position,
        opponents: tournamentState.opponents,
        finalRank: [coryatScore, ...tournamentState.opponents].sort((a,b)=>b-a).indexOf(coryatScore) + 1,
      } : null,
    }
    setGameHistory(prev => [game, ...prev.filter(g => g.episodeId !== game.episodeId)])
  }

  function handleFJAnswer(result) {
    setFjAnswered(result)
    // Update actual score with FJ wager
    if (wagerAmount) {
      if (result === 'correct') setActualScore(s => s + wagerAmount)
      else setActualScore(s => s - wagerAmount)
    }
    saveGame({ result, category: episodeData?.finalJeopardy?.category, clue: episodeData?.finalJeopardy?.clue, answer: episodeData?.finalJeopardy?.answer, wager: wagerAmount })
    clearGameState()
    setWagerAmount(null)
    setShowFJ(false)
  }

  // ── Prev/next episode via episode list ────────────────────────────────────
  function navigateEpisode(dir) {
    if (episodeList.length === 0 || currentEpIndex < 0) return
    const newIndex = currentEpIndex + dir
    if (newIndex < 0 || newIndex >= episodeList.length) return
    setCurrentEpIndex(newIndex)
    loadEpisode(episodeList[newIndex].gameId)
  }

  if (!authChecked || (boardLoading && !board)) {
    return (
      <div style={{ background: '#060b1a', minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f5c518', fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 4, flexDirection: 'column', gap: 12 }}>
        <div>JEO TRAINER</div>
        <div style={{ fontSize: 12, color: '#4060a0', letterSpacing: 3 }}>LOADING LATEST EPISODE...</div>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap')`}</style>
      </div>
    )
  }

  return (
    <div style={S.app}>
      <Header
        coryatScore={coryatScore}
        actualScore={actualScore}
        correctCount={correctCount}
        incorrectCount={incorrectCount}
        answeredCount={answeredCount}
        totalClues={totalClues}
        episodeMeta={episodeMeta}
        user={user}
        syncing={syncing}
        syncError={syncError}
        onAuthClick={() => setShowAuth(true)}
      />
      <NavBar view={view} setView={setView} dueCount={dueCount} deckSize={cards.length} />

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
              if (tournamentModeRef.current) {
                setWagerState({ type: 'final_jeopardy', ci: null, ri: null, clue: null, category: null })
              } else {
                setShowFJ(true)
              }
            }}
            boardLoading={boardLoading}
            boardError={boardError}
            onLoadEpisode={loadEpisode}
            canGoPrev={currentEpIndex < episodeList.length - 1}
            canGoNext={currentEpIndex > 0}
            onPrev={() => navigateEpisode(1)}
            onNext={() => navigateEpisode(-1)}
            timedMode={timedMode}
            onToggleTimedMode={() => setTimedMode(m => !m)}
            tournamentMode={tournamentMode}
            tournamentState={tournamentState}
            coryatScore={coryatScore}
            onShowCache={() => setShowCache(true)}
            onShowCategorySearch={() => setShowCategorySearch(true)}
            onToggleTournament={() => {
              if (tournamentModeRef.current) {
                setTournamentMode(false)
                tournamentModeRef.current = false
                setTournamentState(null)
              } else {
                setShowTournamentSetup(true)
              }
            }}
          />
        )}
        {view === 'study'   && <StudyView cards={cards} setCards={setCards} />}
        {view === 'deck'    && <DeckView cards={cards} setCards={setCards} />}
        {view === 'summary' && (
          <SummaryView
            coryatScore={coryatScore}
            singleBoard={singleBoard}
            doubleBoard={doubleBoard}
            singleClueStates={singleClueStates}
            doubleClueStates={doubleClueStates}
            gameHistory={gameHistory}
            episodeMeta={episodeMeta}
            tournamentState={tournamentState}
            confidenceRatings={confidenceRatings}
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
        />
      )}
      {activeClue && timedMode && (
        <TimedClueModal
          clue={activeClue.clue}
          category={activeClue.category}
          onMark={markClue}
          onClose={() => setActiveClue(null)}
        />
      )}

      {showFJ && episodeData?.finalJeopardy && (
        <FinalJeopardyModal
          fj={episodeData.finalJeopardy}
          onAnswer={handleFJAnswer}
          onClose={() => setShowFJ(false)}
        />
      )}

      {showBrowser && (
        <EpisodeBrowser
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

      {showTournamentSetup && (
        <TournamentSetupModal
          onStart={({ position, opponents }) => {
            setTournamentState({ position, opponents })
            setTournamentMode(true)
            tournamentModeRef.current = true
            setShowTournamentSetup(false)
          }}
          onClose={() => setShowTournamentSetup(false)}
        />
      )}

      {wagerState && (
        <WagerTrainer
          type={wagerState.type}
          coryatScore={coryatScore}
          boardValue={remainingBoardValue}
          opponentScores={tournamentState?.opponents}
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
function Header({ coryatScore, actualScore, correctCount, incorrectCount, answeredCount, totalClues, episodeMeta, user, syncing, syncError, onAuthClick }) {
  const color = coryatScore >= 0 ? '#f5c518' : '#e74c3c'
  const showActual = actualScore !== 0 || coryatScore !== actualScore
  return (
    <header style={S.header}>
      <div>
        <div style={S.logoMain}>JEO TRAINER</div>
        {episodeMeta
          ? <div style={S.logoSub}>#{episodeMeta.episodeNumber} · {episodeMeta.airDate}</div>
          : <div style={S.logoSub}>CORYAT & FLASHCARDS</div>}
      </div>
      <div style={S.scoreBox}>
        <div style={S.scoreLbl}>CORYAT SCORE</div>
        <div style={{ ...S.scoreVal, color }}>{coryatScore >= 0 ? '+' : ''}{coryatScore.toLocaleString()}</div>
        {actualScore !== coryatScore && (
          <div style={{ fontSize: 9, color: '#6070a0', letterSpacing: 1 }}>
            show: {actualScore >= 0 ? '+' : ''}{actualScore.toLocaleString()}
          </div>
        )}
      </div>
      <div style={S.headerStats}>
        <div style={S.pill}>{correctCount}✓ {incorrectCount}✗</div>
        <div style={S.pill}>{answeredCount}/{totalClues}</div>
        <button style={{ ...S.authBtn, color: syncError ? '#e57373' : user ? '#7cd992' : '#8890c0' }} onClick={onAuthClick} title={syncError ? `Sync error: ${syncError}` : user ? 'Synced' : 'Sign in to sync'}>
          {syncing ? '⏳' : syncError ? '⚠️' : user ? '☁️' : '🔓'}
        </button>
      </div>
    </header>
  )
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
function NavBar({ view, setView, dueCount, deckSize }) {
  const tabs = [
    { id: 'board',   label: '📋 BOARD' },
    { id: 'study',   label: `🔁 STUDY${dueCount > 0 ? ` (${dueCount})` : ''}` },
    { id: 'deck',    label: `🗂 DECK (${deckSize})` },
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
function BoardView({ board, clueStates, onOpen, episodeMeta, episodeData, round, hasDouble, onSwitchRound, onBrowse, singleCoryat, doubleCoryat, fjAnswered, onShowFJ, boardLoading, boardError, onLoadEpisode, canGoPrev, canGoNext, onPrev, onNext, timedMode, onToggleTimedMode, tournamentMode, tournamentState, coryatScore, onToggleTournament, onShowCache, onShowCategorySearch }) {
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
        </div>
      </div>
      {/* Tournament opponent bar */}
      {tournamentMode && tournamentState && (
        <OpponentScoreBar tournamentState={tournamentState} coryatScore={coryatScore} />
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
          <div key={ci} style={S.catHeader}>{cat.name}</div>
        ))}
        {board.categories[0].clues.map((_, ri) =>
          board.categories.map((cat, ci) => {
            const key = `${ci}-${ri}`
            const state = clueStates[key]
            const clue = cat.clues[ri]
            return (
              <div key={key} onClick={() => onOpen(ci, ri)} style={{ ...S.tile, background: tileBg[state], cursor: state !== 'unanswered' ? 'default' : 'pointer', opacity: state !== 'unanswered' ? 0.65 : 1 }}>
                {state !== 'unanswered'
                  ? <span style={S.tileIcon}>{state === 'correct' ? '✓' : state === 'incorrect' ? '✗' : '—'}</span>
                  : <span style={S.tileVal}>{clue.isDailyDouble && !tournamentMode && <span style={S.ddTag}>DD</span>}${clue.value.toLocaleString()}</span>}
              </div>
            )
          })
        )}
      </div>

      {episodeData?.finalJeopardy && (
        <div style={S.fjBar}>
          <div style={S.fjLabel}>FINAL JEOPARDY · <span style={{ color: '#f5c518' }}>{episodeData.finalJeopardy.category}</span></div>
          {fjAnswered
            ? <div style={{ fontSize: 12, color: fjAnswered === 'correct' ? '#7cd992' : '#e07070' }}>{fjAnswered === 'correct' ? '✓ Got it' : '✗ Missed'} <span style={{ color: '#4060a0' }}>(not in Coryat)</span></div>
            : <button style={S.fjBtn} onClick={onShowFJ}>{tournamentMode ? '⭐ Wager + Play Final J!' : 'Play Final J!'} →</button>}
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
        <div style={S.modalText}>{fj.clue}</div>
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

// ─── Start Screen ────────────────────────────────────────────────────────────
function StartScreen({ board, episodeMeta, gameHistory, onStart, onSkip }) {
  const [ratings, setRatings] = useState({})
  const [showConfidence, setShowConfidence] = useState(false)
  const categories = board?.categories?.map(c => c.name) || []
  const prediction = predictCoryat(gameHistory, board)
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
            <div style={{ fontSize: 9, letterSpacing: 3, color: '#6070a0', marginBottom: 6 }}>PREDICTED CORYAT RANGE</div>
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

// ─── Episode Cache Manager ────────────────────────────────────────────────────
function EpisodeCacheManager({ onLoadEpisode, onClose }) {
  const [stats, setStats] = useState(() => getCacheStats())
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [caching, setCaching] = useState(false)
  const [cacheProgress, setCacheProgress] = useState('')

  async function cacheRange() {
    const start = parseInt(rangeStart)
    const end = parseInt(rangeEnd)
    if (!start || !end || start > end) return
    setCaching(true)
    for (let id = start; id <= end; id++) {
      setCacheProgress(`Caching episode ${id}...`)
      try {
        const episode = await fetchEpisode(String(id))
        saveEpisodeToCache(String(id), episode)
      } catch {}
      await new Promise(r => setTimeout(r, 300)) // rate limit
    }
    setCaching(false)
    setCacheProgress('')
    setStats(getCacheStats())
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
        <div style={{ fontSize: 9, color: '#6070a0', letterSpacing: 3, marginBottom: 6 }}>CACHE EPISODE RANGE</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input style={{ ...S.input, flex: 1 }} value={rangeStart} onChange={e => setRangeStart(e.target.value)} placeholder="From (e.g. 9150)" type="number" />
          <input style={{ ...S.input, flex: 1 }} value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} placeholder="To (e.g. 9160)" type="number" />
          <button style={{ ...S.loaderBtn, opacity: caching ? 0.5 : 1 }} onClick={cacheRange} disabled={caching}>
            {caching ? '⏳' : 'Cache'}
          </button>
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
              <span style={S.epShowNum}>#{ep.showNumber || ep.gameId}</span>
              <span style={S.epDate}>{ep.airDate}</span>
              <span style={S.epArrow}>▶</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Episode Browser Modal ────────────────────────────────────────────────────
function EpisodeBrowser({ onSelect, onClose }) {
  const [episodes, setEpisodes] = useState([])
  const [seasons, setSeasons] = useState([])
  const [selectedSeason, setSelectedSeason] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const searchTimeout = useRef(null)

  useEffect(() => { fetchEps() }, [])
  useEffect(() => { if (selectedSeason) fetchEps(selectedSeason, search) }, [selectedSeason])

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
            {seasons.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div style={S.browserList}>
          {loading && <div style={S.browserLoading}>⏳ Loading episodes...</div>}
          {error && <div style={{ ...S.loadError, margin: 12 }}>{error}</div>}
          {!loading && !error && episodes.length === 0 && <div style={S.browserLoading}>No episodes found</div>}
          {!loading && episodes.map((ep, i) => (
            <button key={ep.gameId} style={S.episodeRow} onClick={() => onSelect(ep.gameId, episodes, i)}>
              <span style={S.epShowNum}>#{ep.showNumber}</span>
              <span style={S.epDate}>{ep.airDate}</span>
              <span style={S.epArrow}>▶</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Timed Clue Modal ────────────────────────────────────────────────────────
// Phases: reading → buzzing → answering → reveal
function TimedClueModal({ clue, category, onMark, onClose }) {
  // Calculate reading time: ~200ms per word, min 3s max 8s
  const wordCount = clue.answer.split(/\s+/).length
  const readingMs = Math.min(Math.max(wordCount * 200, 3000), 8000)
  const buzzMs = 5000
  const answerMs = 5000

  const [phase, setPhase] = useState('reading') // reading | buzzing | answering | reveal
  const [result, setResult] = useState(null) // correct | incorrect | pass | timeout
  const [elapsed, setElapsed] = useState(0)
  const [phaseStart, setPhaseStart] = useState(Date.now())
  const intervalRef = useRef(null)
  const phaseRef = useRef('reading')
  const phaseStartRef = useRef(Date.now())

  const phaseDuration = phase === 'reading' ? readingMs : phase === 'buzzing' ? buzzMs : answerMs

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
    clearInterval(intervalRef.current)
    setPhase('answering')
  }

  function submitResult(r) {
    setResult(r)
    setPhase('reveal')
    clearInterval(intervalRef.current)
  }

  function handleDone() {
    onMark(result)
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
                  : 'RESULT'

  return (
    <div style={S.overlay} onClick={phase === 'reveal' ? undefined : undefined}>
      <div style={{ ...S.modal, borderColor: phaseColor, boxShadow: `0 20px 60px ${phaseColor}22` }} onClick={e => e.stopPropagation()}>

        {/* Phase label + timer bar */}
        <div style={{ fontSize: 10, letterSpacing: 3, color: phaseColor, marginBottom: 8 }}>{phasLabel}</div>
        {phase !== 'reveal' && (
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
        <div style={S.modalText}>{clue.answer}</div>

        {/* Phase-specific controls */}
        {phase === 'reading' && (
          <div style={{ fontSize: 12, color: '#4060a0', letterSpacing: 2, marginTop: 8 }}>
            Buzz window opens in {timeLeft}s...
          </div>
        )}

        {phase === 'buzzing' && (
          <button
            style={{ ...S.revealBtn, background: '#f5c518', fontSize: 18, padding: '16px 40px', letterSpacing: 3 }}
            onClick={buzzIn}
          >
            BUZZ IN!
          </button>
        )}

        {phase === 'answering' && (
          <>
            <div style={{ fontSize: 12, color: '#7cd992', letterSpacing: 2, marginBottom: 16 }}>
              Do you have the answer?
            </div>
            <div style={S.markRow}>
              <button style={{ ...S.markBtn, background: '#1a5c2e', color: '#7cd992', border: '1px solid #2e8c50', fontSize: 15, padding: '14px 0' }} onClick={() => submitResult('correct')}>✓ Got It</button>
              <button style={{ ...S.markBtn, background: '#5c1a1a', color: '#e07070', border: '1px solid #8c2e2e', fontSize: 15, padding: '14px 0' }} onClick={() => submitResult('incorrect')}>✗ Wrong</button>
            </div>
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
            </div>

            {/* Always show the answer */}
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
function ClueModal({ clue, category, showAnswer, onReveal, onMark, onClose }) {
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <button style={S.closeX} onClick={onClose}>✕</button>
        <div style={S.modalCat}>{category}</div>
        <div style={S.modalVal}>${clue.value.toLocaleString()}</div>
        {clue.isDailyDouble && <div style={S.ddBadge}>⭐ DAILY DOUBLE</div>}
        <div style={S.modalText}>{clue.answer}</div>
        {!showAnswer
          ? <button style={S.revealBtn} onClick={onReveal}>Reveal Answer</button>
          : <>
              <div style={S.modalQ}>{clue.question}</div>
              <div style={S.markRow}>
                <button style={{ ...S.markBtn, background: '#1a5c2e', color: '#7cd992', border: '1px solid #2e8c50' }} onClick={() => onMark('correct')}>✓ Got It</button>
                <button style={{ ...S.markBtn, background: '#5c1a1a', color: '#e07070', border: '1px solid #8c2e2e' }} onClick={() => onMark('incorrect')}>✗ Wrong</button>
                <button style={{ ...S.markBtn, background: '#1e2456', color: '#8890d0', border: '1px solid #2e3476' }} onClick={() => onMark('pass')}>— Pass</button>
              </div>
            </>}
      </div>
    </div>
  )
}

// ─── Study View ───────────────────────────────────────────────────────────────
// ─── Study View ───────────────────────────────────────────────────────────────
function StudyView({ cards, setCards }) {
  const [phase, setPhase] = useState('configure') // configure | session | done
  const [sessionCards, setSessionCards] = useState([])
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [sessionStats, setSessionStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 })

  // Filter state
  const [dueOnly, setDueOnly] = useState(true)
  const [sourceFilter, setSourceFilter] = useState('all') // all | missed | anki | manual
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [episodeFilter, setEpisodeFilter] = useState('all')

  const now = Date.now()

  // Derive available filter options from cards
  const allCategories = [...new Set(cards.flatMap(c => {
    if (!c.category) return []
    // Split multi-category strings and take first meaningful segment
    return c.category.split(' · ').map(s => s.trim()).filter(Boolean)
  }))].sort()

  const allEpisodes = [...new Set(cards
    .filter(c => c.source === 'missed' && c.category)
    .map(c => {
      // Episode info may be embedded in category like "WORLD CAPITALS"
      // We track it via the card's episodeId if present, else skip
      return c.episodeId || null
    })
    .filter(Boolean)
  )].sort((a, b) => b - a)

  // Apply filters to get matching cards
  function getFilteredCards() {
    let filtered = [...cards]
    if (dueOnly) filtered = filtered.filter(c => c.dueAt <= now)
    if (sourceFilter !== 'all') filtered = filtered.filter(c => c.source === sourceFilter)
    if (categoryFilter !== 'all') filtered = filtered.filter(c => c.category?.includes(categoryFilter))
    if (episodeFilter !== 'all') filtered = filtered.filter(c => c.episodeId === episodeFilter)
    return filtered
  }

  const matchingCards = getFilteredCards()
  const dueCount = cards.filter(c => c.dueAt <= now).length

  function startSession() {
    const toStudy = [...matchingCards].sort(() => Math.random() - 0.5)
    setSessionCards(toStudy)
    setIdx(0); setFlipped(false)
    setSessionStats({ again: 0, hard: 0, good: 0, easy: 0 })
    setPhase('session')
  }

  function rate(quality, label) {
    const card = sessionCards[idx]
    // Always update SRS schedule when rating
    setCards(prev => prev.map(c => c.id === card.id ? sm2(card, quality) : c))
    setSessionStats(prev => ({ ...prev, [label]: prev[label] + 1 }))
    const next = idx + 1
    if (next >= sessionCards.length) setPhase('done')
    else { setIdx(next); setFlipped(false) }
  }

  // ── Configure screen ──────────────────────────────────────────────────────
  if (phase === 'configure') return (
    <div style={S.studyLanding}>
      <div style={S.studyIcon}>🔁</div>
      <div style={S.studyTitle}>STUDY SESSION</div>

      {cards.length === 0 ? (
        <>
          <div style={S.studySubtitle}>No cards yet</div>
          <div style={S.studyMeta}>Mark clues as Wrong or Pass on the board, or add cards manually in the Deck tab.</div>
        </>
      ) : (
        <div style={S.configPanel}>

          {/* Due toggle */}
          <div style={S.configRow}>
            <span style={S.configLabel}>CARDS TO INCLUDE</span>
            <div style={S.toggleGroup}>
              <button style={{ ...S.toggleBtn, ...(dueOnly ? S.toggleActive : {}) }} onClick={() => setDueOnly(true)}>
                Due Only ({dueCount})
              </button>
              <button style={{ ...S.toggleBtn, ...(!dueOnly ? S.toggleActive : {}) }} onClick={() => setDueOnly(false)}>
                All Cards ({cards.length})
              </button>
            </div>
          </div>

          {/* Source filter */}
          <div style={S.configRow}>
            <span style={S.configLabel}>SOURCE</span>
            <div style={S.chipRow}>
              {[
                ['all', 'All'],
                ['missed', `Missed (${cards.filter(c=>c.source==='missed').length})`],
                ['anki', `Anki (${cards.filter(c=>c.source==='anki').length})`],
                ['manual', `Manual (${cards.filter(c=>c.source==='manual').length})`],
              ].map(([val, label]) => (
                <button key={val} style={{ ...S.chip, ...(sourceFilter === val ? S.chipActive : {}) }} onClick={() => setSourceFilter(val)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Category filter */}
          {allCategories.length > 0 && (
            <div style={S.configRow}>
              <span style={S.configLabel}>CATEGORY</span>
              <div style={S.chipRow}>
                <button style={{ ...S.chip, ...(categoryFilter === 'all' ? S.chipActive : {}) }} onClick={() => setCategoryFilter('all')}>
                  All
                </button>
                {allCategories.slice(0, 12).map(cat => (
                  <button key={cat} style={{ ...S.chip, ...(categoryFilter === cat ? S.chipActive : {}) }} onClick={() => setCategoryFilter(cat)}>
                    {cat.length > 20 ? cat.slice(0, 20) + '…' : cat}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Match count + start */}
          <div style={S.configFooter}>
            {dueOnly && dueCount === 0 && (
              <div style={S.nextDueBox}>
                <div style={S.nextDueLbl}>NEXT CARD DUE</div>
                <div style={S.nextDueVal}>{formatRelative(Math.min(...cards.map(c => c.dueAt)))}</div>
              </div>
            )}
            <div style={S.matchCount}>
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: matchingCards.length > 0 ? '#f5c518' : '#4060a0' }}>
                {matchingCards.length}
              </span>
              <span style={{ fontSize: 12, color: '#6070a0', marginLeft: 6 }}>card{matchingCards.length !== 1 ? 's' : ''} match</span>
            </div>
            <button
              style={{ ...S.startBtn, opacity: matchingCards.length === 0 ? 0.3 : 1 }}
              onClick={startSession}
              disabled={matchingCards.length === 0}
            >
              Start Session →
            </button>
          </div>
        </div>
      )}
    </div>
  )

  // ── Done screen ───────────────────────────────────────────────────────────
  if (phase === 'done') return (
    <div style={S.studyLanding}>
      <div style={S.studyIcon}>🎉</div>
      <div style={S.studyTitle}>SESSION COMPLETE</div>
      <div style={S.statsGrid}>
        {[['Again', sessionStats.again, '#e57373'],['Hard', sessionStats.hard, '#ffb74d'],['Good', sessionStats.good, '#81c784'],['Easy', sessionStats.easy, '#4dd0e1']].map(([lbl, n, c]) => (
          <div key={lbl} style={S.statCell}><div style={{ ...S.statN, color: c }}>{n}</div><div style={S.statLbl}>{lbl}</div></div>
        ))}
      </div>
      <button style={S.startBtn} onClick={() => setPhase('configure')}>Back to Setup</button>
    </div>
  )

  // ── Active session ────────────────────────────────────────────────────────
  const card = sessionCards[idx]
  return (
    <div style={S.studyWrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: 480 }}>
        <button style={{ fontSize: 11, color: '#4060a0', letterSpacing: 1 }} onClick={() => setPhase('configure')}>← Exit</button>
        <div style={S.studyCount}>{idx + 1} / {sessionCards.length}</div>
        <div style={{ width: 40 }} />
      </div>
      <div style={S.progressOuter}><div style={{ ...S.progressInner, width: `${(idx / sessionCards.length) * 100}%` }} /></div>
      <div style={S.cardMeta}>
        {card.category && <span style={S.cardCat}>{card.category}</span>}
        {card.value > 0 && <span style={S.cardValBadge}>${card.value.toLocaleString()}</span>}
        <span style={{ ...S.cardSource, color: card.source === 'missed' ? '#e57373' : card.source === 'anki' ? '#4dd0e1' : '#81c784' }}>
          {card.source === 'missed' ? 'MISSED' : card.source === 'anki' ? 'ANKI' : 'MANUAL'}
        </span>
        {card.dueAt > now && <span style={{ ...S.cardSource, color: '#4060a0' }}>EARLY</span>}
      </div>
      <div style={S.flashCard} onClick={() => setFlipped(!flipped)}>
        {!flipped
          ? <div style={S.flashInner}>
              <div style={S.flashSide}>CLUE</div>
              <CardContent content={card.front} isHtml={card.hasMedia || cardIsHtml(card.front)} style={S.flashFrontText} />
              <div style={S.flashHint}>tap to reveal</div>
            </div>
          : <div style={S.flashInner}>
              <div style={{ ...S.flashSide, color: '#7cd992' }}>ANSWER</div>
              <CardContent content={card.back} isHtml={card.hasMedia || cardIsHtml(card.back)} style={S.flashBackText} />
              <div style={S.flashHint}>tap to flip back</div>
            </div>}
      </div>
      {flipped && (
        <div style={S.rateRow}>
          {[{q:0,label:'Again',color:'#e57373',bg:'#3a1010'},{q:1,label:'Hard',color:'#ffb74d',bg:'#3a2510'},{q:2,label:'Good',color:'#81c784',bg:'#103a18'},{q:3,label:'Easy',color:'#4dd0e1',bg:'#0e2e36'}].map(({ q, label, color, bg }) => (
            <button key={q} style={{ ...S.rateBtn, background: bg, borderColor: color }} onClick={() => rate(q, label.toLowerCase())}>
              <span style={{ color, fontWeight: 700, fontSize: 14 }}>{label}</span>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, marginTop: 2 }}>{nextDueLabel(q, card)}</span>
            </button>
          ))}
        </div>
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
function DeckView({ cards, setCards }) {
  const [subview, setSubview] = useState('list')
  const [editCard, setEditCard] = useState(null) // card being edited
  const [editFront, setEditFront] = useState('')
  const [editBack, setEditBack] = useState('')
  const [editCat, setEditCat] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkMode, setBulkMode] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [newFront, setNewFront] = useState('')
  const [newBack, setNewBack] = useState('')
  const [newCat, setNewCat] = useState('')
  const [filter, setFilter] = useState('all')
  const [confirmDelete, setConfirmDelete] = useState(null)
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
  function deleteCard(id) { setCards(prev => prev.filter(c => c.id !== id)); setConfirmDelete(null) }
  function resetCard(id) { setCards(prev => prev.map(c => c.id === id ? { ...c, interval: 0, easeFactor: 2.5, repetitions: 0, dueAt: Date.now(), lastReviewed: null } : c)) }

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
    setCards(prev => prev.filter(c => !selectedIds.has(c.id)))
    clearSelection()
  }

  function bulkReset() {
    setCards(prev => prev.map(c => selectedIds.has(c.id) ? { ...c, interval: 0, easeFactor: 2.5, repetitions: 0, dueAt: Date.now(), lastReviewed: null } : c))
    clearSelection()
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

  // Leech detection: 4+ consecutive wrong (lapses)
  function isLeech(card) {
    return (card.lapses || 0) >= 4
  }

  async function handleApkgImport(e) {
    const file = e.target.files[0]; if (!file) return
    setImporting(true); setImportError(null); setImportResult(null)
    try {
      const result = await parseApkg(file, (progress) => {
        // Could update progress UI here if needed
      }, user)
      const imported = result.cards
      let added = 0
      setCards(prev => {
        const existing = new Set(prev.map(c => c.front))
        const toAdd = imported.filter(c => { if (existing.has(c.front)) return false; added++; return true })
        return [...prev, ...toAdd]
      })
      setTimeout(() => setImportResult({ added: imported.length, mediaCount: result.mediaCount }), 100)
    } catch (err) { setImportError(err.message || String(err)) }
    finally { setImporting(false); e.target.value = '' }
  }

  const leeches = cards.filter(c => (c.lapses || 0) >= 4)
  const counts = { all: cards.length, due: cards.filter(c => c.dueAt <= now).length, leeches: leeches.length, missed: cards.filter(c => c.source === 'missed').length, manual: cards.filter(c => c.source === 'manual').length, anki: cards.filter(c => c.source === 'anki').length }
  const filtered = cards.filter(c => {
    if (filter === 'due') return c.dueAt <= now
    if (filter === 'leeches') return (c.lapses || 0) >= 4
    if (filter === 'missed' || filter === 'manual' || filter === 'anki') return c.source === filter
    return true
  })

  return (
    <div style={S.deckWrap}>
      <div style={S.deckActions}>
        <button style={{ ...S.actionBtn, ...(subview === 'add' ? S.actionBtnActive : {}) }} onClick={() => setSubview(subview === 'add' ? 'list' : 'add')}>{subview === 'add' ? '✕ Cancel' : '+ Add Card'}</button>
        <button style={{ ...S.actionBtn, ...(subview === 'import' ? S.actionBtnActive : {}) }} onClick={() => setSubview(subview === 'import' ? 'list' : 'import')}>{subview === 'import' ? '✕ Cancel' : '⬆ Import .apkg'}</button>
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
          {importing ? <div style={S.importStatus}>⏳ Parsing deck and storing media...</div> : <button style={S.startBtn} onClick={() => fileRef.current.click()}>Choose .apkg File</button>}
          {importResult && (
            <div style={S.importSuccess}>
              ✅ Imported {importResult.added} cards!
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
          {['all','due','leeches','missed','manual','anki'].map(f => (
            <button key={f} style={{ ...S.filterTab, ...(filter === f ? S.filterTabActive : {}), ...(f === 'leeches' && counts.leeches > 0 ? { color: '#e57373' } : {}) }} onClick={() => setFilter(f)}>
              {f === 'leeches' ? '🐛' : ''}{f.toUpperCase()} ({counts[f]})
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
            const isDue = card.dueAt <= now
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
                    <span style={{ ...S.metaTag, color: sc }}>{card.source.toUpperCase()}</span>
                    <span style={{ ...S.metaTag, color: isDue ? '#f5c518' : '#4060a0' }}>{isDue ? 'DUE NOW' : `Due ${formatRelative(card.dueAt)}`}</span>
                    {card.repetitions > 0 && <span style={S.metaTag}>Rep {card.repetitions} · EF {card.easeFactor.toFixed(2)}</span>}
                    {isLeech(card) && <span style={{ ...S.metaTag, color: '#e57373' }}>LEECH ({card.lapses} lapses)</span>}
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
function SummaryView({ coryatScore, singleBoard, doubleBoard, singleClueStates, doubleClueStates, gameHistory, episodeMeta, tournamentState, confidenceRatings }) {
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

  function calcCategoryBreakdown(board, states) {
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

  const singleBreakdown = calcCategoryBreakdown(singleBoard, singleClueStates)
  const doubleBreakdown = calcCategoryBreakdown(doubleBoard, doubleClueStates)
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[['AVG', allTimeAvg], ['LAST 10', last10Avg], ['BEST', best]].map(([lbl, val]) => (
              <div key={lbl} style={{ ...S.statCell, padding: '10px 4px' }}>
                <div style={{ ...S.statN, fontSize: 20, color: '#f5c518' }}>{val !== null ? (val >= 0 ? '+' : '') + val.toLocaleString() : '—'}</div>
                <div style={S.statLbl}>{lbl}</div>
              </div>
            ))}
          </div>
        </div>
      )}

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
          singleBreakdown={calcCategoryBreakdown(singleBoard, singleClueStates)}
          doubleBreakdown={calcCategoryBreakdown(doubleBoard, doubleClueStates)}
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
                  {cat.avg >= 0 ? '+' : ''}{cat.avg.toLocaleString()} avg · {cat.games}g
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
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', paddingTop: 'calc(12px + env(safe-area-inset-top))', background: 'linear-gradient(135deg, #0a0f2e 0%, #0f1e6e 100%)', borderBottom: '3px solid #f5c518', boxShadow: '0 4px 20px rgba(245,197,24,0.2)' },
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
  loaderInput: { flex: 1, background: '#0a0f2e', border: '1px solid #1a2460', borderRadius: 8, color: '#e8e8f0', fontSize: 13, padding: '8px 12px', fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 1 },
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
  browserList: { flex: 1, overflowY: 'auto', padding: '8px 0' },
  browserLoading: { textAlign: 'center', color: '#6070a0', padding: '24px', fontSize: 13 },
  episodeRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', width: '100%', textAlign: 'left', borderBottom: '1px solid #0f1530', background: 'none' },
  epShowNum: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: '#f5c518', minWidth: 70 },
  epDate: { flex: 1, fontSize: 13, color: '#a0acd0' },
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
  flashCard: { width: '100%', maxWidth: 480, minHeight: 240, background: 'linear-gradient(150deg,#0f1e6e,#060b1a)', border: '2px solid #2a3580', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' },
  flashInner: { padding: 24, textAlign: 'center', width: '100%' },
  flashSide: { fontSize: 10, letterSpacing: 4, color: '#f5c518', marginBottom: 12 },
  flashFrontText: { fontSize: 17, color: '#e8e8f0', lineHeight: 1.55 },
  flashBackText: { fontSize: 20, color: '#7cd992', fontStyle: 'italic', lineHeight: 1.55 },
  flashHint: { fontSize: 10, color: '#2a3480', marginTop: 18, letterSpacing: 2 },
  rateRow: { display: 'flex', gap: 8, width: '100%', maxWidth: 480 },
  rateBtn: { flex: 1, borderRadius: 8, padding: '10px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', border: '1px solid', fontFamily: "'Barlow Condensed', sans-serif" },

  deckWrap: { display: 'flex', flexDirection: 'column', gap: 12 },
  deckActions: { display: 'flex', gap: 8 },
  actionBtn: { flex: 1, fontSize: 12, letterSpacing: 1.5, color: '#f5c518', background: 'rgba(245,197,24,0.06)', borderRadius: 8, padding: '9px 0', fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", border: '1px solid rgba(245,197,24,0.2)' },
  actionBtnActive: { background: 'rgba(245,197,24,0.15)', borderColor: 'rgba(245,197,24,0.5)' },
  addForm: { background: '#0a0f2e', borderRadius: 12, padding: 16, border: '1px solid #1a2460', display: 'flex', flexDirection: 'column', gap: 6 },
  formLabel: { fontSize: 10, letterSpacing: 3, color: '#6070a0' },
  textarea: { background: '#060b1a', border: '1px solid #1a2460', borderRadius: 8, color: '#e8e8f0', fontSize: 14, padding: '10px 12px', fontFamily: "'Barlow', sans-serif", resize: 'vertical' },
  input: { background: '#060b1a', border: '1px solid #1a2460', borderRadius: 8, color: '#e8e8f0', fontSize: 14, padding: '9px 12px', fontFamily: "'Barlow Condensed', sans-serif" },
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
  toggleGroup: { display: 'flex', gap: 6 },
  toggleBtn: { flex: 1, fontSize: 12, fontWeight: 700, letterSpacing: 1, color: '#5060a0', background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '8px 4px', fontFamily: "'Barlow Condensed', sans-serif", border: '1px solid #1a2460' },
  toggleActive: { color: '#f5c518', background: 'rgba(245,197,24,0.08)', borderColor: '#f5c518' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: { fontSize: 11, letterSpacing: 1, color: '#5060a0', background: 'rgba(255,255,255,0.04)', borderRadius: 20, padding: '5px 12px', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, border: '1px solid #1a2460', whiteSpace: 'nowrap' },
  chipActive: { color: '#f5c518', background: 'rgba(245,197,24,0.08)', borderColor: '#f5c518' },
  configFooter: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 4 },
  matchCount: { display: 'flex', alignItems: 'baseline' },
}

const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700&family=Barlow:wght@400;500&display=swap');
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
