import { useState, useEffect, useCallback, useRef } from 'react'
import { sm2, newCard, formatRelative, nextDueLabel } from './srs.js'
import { loadCards, saveCards } from './storage.js'
import { parseApkg } from './ankiImport.js'
import { SAMPLE_BOARD } from './boardData.js'
import { fetchEpisode, episodeToBoard } from './jarchive.js'

const CLUE_STATES = { UNANSWERED: 'unanswered', CORRECT: 'correct', INCORRECT: 'incorrect', PASS: 'pass' }
const CORYAT_VAL = { correct: v => v, incorrect: v => -v, pass: () => 0, unanswered: () => 0 }

function initClueStates(board) {
  const s = {}
  board.categories.forEach((cat, ci) =>
    cat.clues.forEach((_, ri) => { s[`${ci}-${ri}`] = CLUE_STATES.UNANSWERED })
  )
  return s
}

export default function App() {
  const [view, setView] = useState('board')
  const [board, setBoard] = useState(SAMPLE_BOARD)
  const [episodeMeta, setEpisodeMeta] = useState(null) // { episodeNumber, airDate, url, hasDouble, finalJeopardy }
  const [clueStates, setClueStates] = useState(() => initClueStates(SAMPLE_BOARD))
  const [activeClue, setActiveClue] = useState(null)
  const [showAnswer, setShowAnswer] = useState(false)
  const [cards, setCards] = useState([])
  const [storageReady, setStorageReady] = useState(false)

  useEffect(() => {
    setCards(loadCards())
    setStorageReady(true)
  }, [])

  useEffect(() => {
    if (storageReady) saveCards(cards)
  }, [cards, storageReady])

  const addMissedAsCard = useCallback((clue, category) => {
    setCards(prev => {
      if (prev.some(c => c.front === clue.answer)) return prev
      return [...prev, newCard(clue.answer, clue.question, category, clue.value, 'missed')]
    })
  }, [])

  async function loadEpisode(episodeIdOrParam, round = 'single') {
    // Support "8000&round=double" format from the DJ button
    let episodeId = episodeIdOrParam
    let roundOverride = round
    if (typeof episodeIdOrParam === 'string' && episodeIdOrParam.includes('&round=')) {
      const [id, r] = episodeIdOrParam.split('&round=')
      episodeId = id
      roundOverride = r
    }
    const episode = await fetchEpisode(episodeId)
    const { board: newBoard, meta } = episodeToBoard(episode, roundOverride)
    setBoard(newBoard)
    setEpisodeMeta(meta)
    setClueStates(initClueStates(newBoard))
    setActiveClue(null)
    setView('board')
  }

  function openClue(ci, ri) {
    if (clueStates[`${ci}-${ri}`] !== CLUE_STATES.UNANSWERED) return
    setActiveClue({ ci, ri, clue: board.categories[ci].clues[ri], category: board.categories[ci].name })
    setShowAnswer(false)
  }

  function markClue(result) {
    const { ci, ri, clue, category } = activeClue
    setClueStates(prev => ({ ...prev, [`${ci}-${ri}`]: result }))
    if (result === CLUE_STATES.INCORRECT || result === CLUE_STATES.PASS) {
      addMissedAsCard(clue, category)
    }
    setActiveClue(null)
  }

  const coryatScore = Object.entries(clueStates).reduce((sum, [key, state]) => {
    const [ci, ri] = key.split('-').map(Number)
    const clue = board.categories[ci].clues[ri]
    if (clue.isDailyDouble) return sum
    return sum + CORYAT_VAL[state](clue.value)
  }, 0)

  const totalClues = board.categories.length * 5
  const answeredCount = Object.values(clueStates).filter(s => s !== CLUE_STATES.UNANSWERED).length
  const correctCount = Object.values(clueStates).filter(s => s === CLUE_STATES.CORRECT).length
  const incorrectCount = Object.values(clueStates).filter(s => s === CLUE_STATES.INCORRECT).length
  const dueCount = cards.filter(c => c.dueAt <= Date.now()).length

  return (
    <div style={S.app}>
      <Header coryatScore={coryatScore} correctCount={correctCount} incorrectCount={incorrectCount} answeredCount={answeredCount} totalClues={totalClues} episodeMeta={episodeMeta} onLoadEpisode={loadEpisode} />
      <NavBar view={view} setView={setView} dueCount={dueCount} deckSize={cards.length} />

      <main style={S.main}>
        {view === 'board'      && <BoardView board={board} clueStates={clueStates} onOpen={openClue} episodeMeta={episodeMeta} onLoadEpisode={loadEpisode} />}
        {view === 'study'      && <StudyView cards={cards} setCards={setCards} />}
        {view === 'deck'       && <DeckView cards={cards} setCards={setCards} />}
        {view === 'summary'    && <SummaryView coryatScore={coryatScore} correctCount={correctCount} incorrectCount={incorrectCount} passCount={Object.values(clueStates).filter(s => s === CLUE_STATES.PASS).length} totalClues={totalClues} board={board} clueStates={clueStates} />}
      </main>

      {activeClue && (
        <ClueModal
          clue={activeClue.clue}
          category={activeClue.category}
          showAnswer={showAnswer}
          onReveal={() => setShowAnswer(true)}
          onMark={markClue}
          onClose={() => setActiveClue(null)}
        />
      )}
      <style>{globalCSS}</style>
    </div>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────────
function Header({ coryatScore, correctCount, incorrectCount, answeredCount, totalClues, episodeMeta }) {
  const color = coryatScore >= 0 ? '#f5c518' : '#e74c3c'
  return (
    <header style={S.header}>
      <div>
        <div style={S.logoMain}>JEO TRAINER</div>
        {episodeMeta ? (
          <div style={S.logoSub}>#{episodeMeta.episodeNumber} · {episodeMeta.airDate}</div>
        ) : (
          <div style={S.logoSub}>CORYAT & FLASHCARDS</div>
        )}
      </div>
      <div style={S.scoreBox}>
        <div style={S.scoreLbl}>CORYAT SCORE</div>
        <div style={{ ...S.scoreVal, color }}>{coryatScore >= 0 ? '+' : ''}{coryatScore.toLocaleString()}</div>
      </div>
      <div style={S.headerStats}>
        <div style={S.pill}>{correctCount}✓ {incorrectCount}✗</div>
        <div style={S.pill}>{answeredCount}/{totalClues}</div>
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

// ─── Board View ───────────────────────────────────────────────────────────────
function BoardView({ board, clueStates, onOpen, episodeMeta, onLoadEpisode }) {
  const [loadInput, setLoadInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)

  async function handleLoad(episodeId) {
    setLoading(true)
    setLoadError(null)
    try {
      await onLoadEpisode(episodeId || 'latest')
    } catch (err) {
      setLoadError(err.message || 'Could not load episode')
    } finally {
      setLoading(false)
    }
  }

  const tileBg = { unanswered: '#0f1e6e', correct: '#1a5c2e', incorrect: '#5c1a1a', pass: '#2a2a4a' }
  return (
    <div>
      {/* Episode loader bar */}
      <div style={S.loaderBar}>
        <input
          style={S.loaderInput}
          value={loadInput}
          onChange={e => setLoadInput(e.target.value.replace(/\D/g, ''))}
          placeholder="Episode # (blank = latest)"
          maxLength={6}
        />
        <button style={S.loaderBtn} onClick={() => handleLoad(loadInput)} disabled={loading}>
          {loading ? '⏳' : '▶ Load'}
        </button>
        {episodeMeta?.hasDouble && (
          <button style={{ ...S.loaderBtn, fontSize: 10 }} onClick={() => handleLoad(`${board.episodeId}&round=double`)} disabled={loading}>
            DJ →
          </button>
        )}
      </div>
      {loadError && <div style={S.loadError}>{loadError}</div>}
      {episodeMeta?.url && (
        <div style={S.episodeLink}>
          <a href={episodeMeta.url} target="_blank" rel="noopener noreferrer" style={{ color: '#4060a0', fontSize: 10, letterSpacing: 1 }}>
            View on j-archive ↗
          </a>
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
                  : <span style={S.tileVal}>{clue.isDailyDouble && <span style={S.ddTag}>DD</span>}${clue.value.toLocaleString()}</span>}
              </div>
            )
          })
        )}
      </div>
      <div style={S.legend}>
        {[['#4caf7d','Correct'],['#e57373','Incorrect'],['#7986cb','Pass'],['#f5c518','DD = excluded from Coryat']].map(([c,l]) => (
          <span key={l} style={S.legendItem}><span style={{ color: c }}>■</span> {l}</span>
        ))}
      </div>
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
        {!showAnswer ? (
          <button style={S.revealBtn} onClick={onReveal}>Reveal Answer</button>
        ) : (
          <>
            <div style={S.modalQ}>{clue.question}</div>
            <div style={S.markRow}>
              <button style={{ ...S.markBtn, background: '#1a5c2e', color: '#7cd992', border: '1px solid #2e8c50' }} onClick={() => onMark('correct')}>✓ Got It</button>
              <button style={{ ...S.markBtn, background: '#5c1a1a', color: '#e07070', border: '1px solid #8c2e2e' }} onClick={() => onMark('incorrect')}>✗ Wrong</button>
              <button style={{ ...S.markBtn, background: '#1e2456', color: '#8890d0', border: '1px solid #2e3476' }} onClick={() => onMark('pass')}>— Pass</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Study View ───────────────────────────────────────────────────────────────
function StudyView({ cards, setCards }) {
  const [sessionCards, setSessionCards] = useState(null)
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [sessionDone, setSessionDone] = useState(false)
  const [sessionStats, setSessionStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 })

  const dueCards = cards.filter(c => c.dueAt <= Date.now())

  function startSession() {
    setSessionCards([...dueCards])
    setIdx(0); setFlipped(false); setSessionDone(false)
    setSessionStats({ again: 0, hard: 0, good: 0, easy: 0 })
  }

  function rate(quality, label) {
    const card = sessionCards[idx]
    const updated = sm2(card, quality)
    setCards(prev => prev.map(c => c.id === card.id ? updated : c))
    setSessionStats(prev => ({ ...prev, [label]: prev[label] + 1 }))
    const next = idx + 1
    if (next >= sessionCards.length) setSessionDone(true)
    else { setIdx(next); setFlipped(false) }
  }

  if (!sessionCards) {
    return (
      <div style={S.studyLanding}>
        <div style={S.studyIcon}>🔁</div>
        <div style={S.studyTitle}>STUDY SESSION</div>
        {dueCards.length === 0 ? (
          <>
            <div style={S.studySubtitle}>No cards due right now!</div>
            <div style={S.studyMeta}>{cards.length === 0 ? 'Mark clues as Wrong or Pass on the board, or add cards manually in the Deck tab.' : `All ${cards.length} card${cards.length !== 1 ? 's' : ''} are scheduled for future review.`}</div>
            {cards.length > 0 && (
              <div style={S.nextDueBox}>
                <div style={S.nextDueLbl}>NEXT CARD DUE</div>
                <div style={S.nextDueVal}>{formatRelative(Math.min(...cards.map(c => c.dueAt)))}</div>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={S.studySubtitle}>{dueCards.length} card{dueCards.length !== 1 ? 's' : ''} due for review</div>
            <div style={S.studyMeta}>Rate each card: <b>Again</b> resets it, <b>Hard / Good / Easy</b> schedule it further out using SM-2.</div>
            <button style={S.startBtn} onClick={startSession}>Start Session →</button>
          </>
        )}
      </div>
    )
  }

  if (sessionDone) {
    return (
      <div style={S.studyLanding}>
        <div style={S.studyIcon}>🎉</div>
        <div style={S.studyTitle}>SESSION COMPLETE</div>
        <div style={S.statsGrid}>
          {[['Again', sessionStats.again, '#e57373'], ['Hard', sessionStats.hard, '#ffb74d'], ['Good', sessionStats.good, '#81c784'], ['Easy', sessionStats.easy, '#4dd0e1']].map(([lbl, n, c]) => (
            <div key={lbl} style={S.statCell}><div style={{ ...S.statN, color: c }}>{n}</div><div style={S.statLbl}>{lbl}</div></div>
          ))}
        </div>
        <button style={S.startBtn} onClick={() => setSessionCards(null)}>Done</button>
      </div>
    )
  }

  const card = sessionCards[idx]
  return (
    <div style={S.studyWrap}>
      <div style={S.progressOuter}><div style={{ ...S.progressInner, width: `${(idx / sessionCards.length) * 100}%` }} /></div>
      <div style={S.studyCount}>{idx + 1} / {sessionCards.length}</div>
      <div style={S.cardMeta}>
        {card.category && <span style={S.cardCat}>{card.category}</span>}
        {card.value > 0 && <span style={S.cardValBadge}>${card.value.toLocaleString()}</span>}
        <span style={{ ...S.cardSource, color: card.source === 'missed' ? '#e57373' : card.source === 'anki' ? '#4dd0e1' : '#81c784' }}>
          {card.source === 'missed' ? 'MISSED' : card.source === 'anki' ? 'ANKI' : 'MANUAL'}
        </span>
      </div>
      <div style={S.flashCard} onClick={() => setFlipped(!flipped)}>
        {!flipped ? (
          <div style={S.flashInner}>
            <div style={S.flashSide}>CLUE</div>
            <div style={S.flashFrontText}>{card.front}</div>
            <div style={S.flashHint}>tap to reveal answer</div>
          </div>
        ) : (
          <div style={S.flashInner}>
            <div style={{ ...S.flashSide, color: '#7cd992' }}>ANSWER</div>
            <div style={S.flashBackText}>{card.back}</div>
            <div style={S.flashHint}>tap to flip back</div>
          </div>
        )}
      </div>
      {flipped && (
        <div style={S.rateRow}>
          {[
            { q: 0, label: 'Again', color: '#e57373', bg: '#3a1010' },
            { q: 1, label: 'Hard',  color: '#ffb74d', bg: '#3a2510' },
            { q: 2, label: 'Good',  color: '#81c784', bg: '#103a18' },
            { q: 3, label: 'Easy',  color: '#4dd0e1', bg: '#0e2e36' },
          ].map(({ q, label, color, bg }) => (
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

// ─── Deck View ────────────────────────────────────────────────────────────────
function DeckView({ cards, setCards }) {
  const [subview, setSubview] = useState('list') // list | add | import
  const [newFront, setNewFront] = useState('')
  const [newBack, setNewBack] = useState('')
  const [newCat, setNewCat] = useState('')
  const [filter, setFilter] = useState('all')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null) // { added, skipped }
  const [importError, setImportError] = useState(null)
  const fileRef = useRef()

  const now = Date.now()

  function addCard() {
    if (!newFront.trim() || !newBack.trim()) return
    setCards(prev => [...prev, newCard(newFront.trim(), newBack.trim(), newCat.trim())])
    setNewFront(''); setNewBack(''); setNewCat('')
    setSubview('list')
  }

  function deleteCard(id) {
    setCards(prev => prev.filter(c => c.id !== id))
    setConfirmDelete(null)
  }

  function resetCard(id) {
    setCards(prev => prev.map(c => c.id === id ? { ...c, interval: 0, easeFactor: 2.5, repetitions: 0, dueAt: Date.now(), lastReviewed: null } : c))
  }

  async function handleApkgImport(e) {
    const file = e.target.files[0]
    if (!file) return
    setImporting(true)
    setImportError(null)
    setImportResult(null)
    try {
      const imported = await parseApkg(file)
      let added = 0, skipped = 0
      setCards(prev => {
        const existingFronts = new Set(prev.map(c => c.front))
        const toAdd = imported.filter(c => {
          if (existingFronts.has(c.front)) { skipped++; return false }
          added++; return true
        })
        return [...prev, ...toAdd]
      })
      // Small delay so skipped count is accurate after state update
      setTimeout(() => setImportResult({ added: imported.length, skipped: 0 }), 100)
    } catch (err) {
      setImportError(err.message || 'Failed to parse .apkg file.')
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  const filtered = cards.filter(c => {
    if (filter === 'due')    return c.dueAt <= now
    if (filter === 'missed') return c.source === 'missed'
    if (filter === 'manual') return c.source === 'manual'
    if (filter === 'anki')   return c.source === 'anki'
    return true
  })

  const counts = {
    all: cards.length,
    due: cards.filter(c => c.dueAt <= now).length,
    missed: cards.filter(c => c.source === 'missed').length,
    manual: cards.filter(c => c.source === 'manual').length,
    anki: cards.filter(c => c.source === 'anki').length,
  }

  return (
    <div style={S.deckWrap}>
      {/* Action buttons */}
      <div style={S.deckActions}>
        <button style={{ ...S.actionBtn, ...(subview === 'add' ? S.actionBtnActive : {}) }} onClick={() => setSubview(subview === 'add' ? 'list' : 'add')}>
          {subview === 'add' ? '✕ Cancel' : '+ Add Card'}
        </button>
        <button style={{ ...S.actionBtn, ...(subview === 'import' ? S.actionBtnActive : {}) }} onClick={() => setSubview(subview === 'import' ? 'list' : 'import')}>
          {subview === 'import' ? '✕ Cancel' : '⬆ Import .apkg'}
        </button>
      </div>

      {/* Add card form */}
      {subview === 'add' && (
        <div style={S.addForm}>
          <div style={S.formLabel}>CLUE (Front)</div>
          <textarea style={S.textarea} value={newFront} onChange={e => setNewFront(e.target.value)} placeholder="Enter the clue / question prompt..." rows={3} />
          <div style={S.formLabel}>ANSWER (Back)</div>
          <textarea style={S.textarea} value={newBack} onChange={e => setNewBack(e.target.value)} placeholder="What is / Who is..." rows={2} />
          <div style={S.formLabel}>CATEGORY (Optional)</div>
          <input style={S.input} value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="e.g. American History" />
          <button style={{ ...S.startBtn, marginTop: 12, opacity: (!newFront.trim() || !newBack.trim()) ? 0.4 : 1 }} onClick={addCard} disabled={!newFront.trim() || !newBack.trim()}>
            Add Card
          </button>
        </div>
      )}

      {/* .apkg import */}
      {subview === 'import' && (
        <div style={S.addForm}>
          <div style={S.importTitle}>Import Anki Deck</div>
          <div style={S.importDesc}>
            Select a <code style={S.code}>.apkg</code> file exported from Anki. All notes will be imported as flashcards. If a deck has already been studied, its SRS intervals will be preserved.
          </div>
          <div style={S.importHowTo}>
            <b>How to export from Anki:</b> File → Export → select your deck → format: <i>Anki Deck Package (.apkg)</i> → Export
          </div>

          <input ref={fileRef} type="file" accept=".apkg" onChange={handleApkgImport} style={{ display: 'none' }} />

          {importing ? (
            <div style={S.importStatus}>⏳ Parsing deck — this may take a moment for large decks...</div>
          ) : (
            <button style={S.startBtn} onClick={() => fileRef.current.click()}>
              Choose .apkg File
            </button>
          )}

          {importResult && (
            <div style={S.importSuccess}>
              ✅ Imported {importResult.added} cards successfully!
            </div>
          )}
          {importError && (
            <div style={S.importError}>
              ❌ {importError}
            </div>
          )}
        </div>
      )}

      {/* Filter tabs */}
      <div style={S.deckTabs}>
        {['all','due','missed','manual','anki'].map(f => (
          <button key={f} style={{ ...S.filterTab, ...(filter === f ? S.filterTabActive : {}) }} onClick={() => setFilter(f)}>
            {f.toUpperCase()} ({counts[f]})
          </button>
        ))}
      </div>

      {/* Card list */}
      {filtered.length === 0 ? (
        <div style={S.emptyDeck}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🗂</div>
          <div style={{ color: '#6070a0', fontSize: 14, textAlign: 'center' }}>
            {filter === 'all' ? 'No cards yet. Mark clues Wrong/Pass on the board, add manually, or import an Anki deck.' : `No ${filter} cards.`}
          </div>
        </div>
      ) : (
        <div style={S.cardList}>
          {filtered.map(card => {
            const isDue = card.dueAt <= now
            const sourceColor = card.source === 'missed' ? '#e57373' : card.source === 'anki' ? '#4dd0e1' : '#81c784'
            return (
              <div key={card.id} style={S.cardRow}>
                <div style={S.cardRowMain}>
                  <div style={S.cardRowFront}>{card.front}</div>
                  <div style={S.cardRowBack}>{card.back}</div>
                  <div style={S.cardRowMeta}>
                    {card.category && <span style={S.metaTag}>{card.category}</span>}
                    <span style={{ ...S.metaTag, color: sourceColor }}>{card.source.toUpperCase()}</span>
                    <span style={{ ...S.metaTag, color: isDue ? '#f5c518' : '#4060a0' }}>{isDue ? 'DUE NOW' : `Due ${formatRelative(card.dueAt)}`}</span>
                    {card.repetitions > 0 && <span style={S.metaTag}>Rep {card.repetitions} · EF {card.easeFactor.toFixed(2)}</span>}
                  </div>
                </div>
                <div style={S.cardRowActions}>
                  <button style={S.iconBtn} title="Reset progress" onClick={() => resetCard(card.id)}>↺</button>
                  <button style={{ ...S.iconBtn, color: '#e57373' }} title="Delete" onClick={() => setConfirmDelete(card.id)}>🗑</button>
                </div>
              </div>
            )
          })}
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
    </div>
  )
}

// ─── Summary View ─────────────────────────────────────────────────────────────
function SummaryView({ coryatScore, correctCount, incorrectCount, passCount, totalClues, board, clueStates }) {
  const pct = Math.round((correctCount / totalClues) * 100)
  const byCategory = board.categories.map((cat, ci) => {
    let catCoryat = 0
    cat.clues.forEach((clue, ri) => {
      const state = clueStates[`${ci}-${ri}`]
      if (!clue.isDailyDouble) catCoryat += CORYAT_VAL[state](clue.value)
    })
    return { name: cat.name, coryat: catCoryat }
  })

  return (
    <div style={S.summaryWrap}>
      <div style={S.summaryHero}>
        <div style={S.scoreLbl}>FINAL CORYAT SCORE</div>
        <div style={{ ...S.scoreVal, fontSize: 64, color: coryatScore >= 0 ? '#f5c518' : '#e74c3c' }}>
          {coryatScore >= 0 ? '+' : ''}{coryatScore.toLocaleString()}
        </div>
        <div style={{ fontSize: 12, color: '#6070a0', marginTop: 4, letterSpacing: 1 }}>
          {correctCount} correct · {incorrectCount} incorrect · {passCount} passed · {totalClues - correctCount - incorrectCount - passCount} unanswered
        </div>
        <div style={{ ...S.progressOuter, marginTop: 14 }}><div style={{ ...S.progressInner, width: `${pct}%` }} /></div>
        <div style={{ fontSize: 11, color: '#8890c0', marginTop: 6, letterSpacing: 2 }}>{pct}% accuracy</div>
      </div>
      <div style={S.catBreakdown}>
        <div style={S.sectionTitle}>BY CATEGORY</div>
        {byCategory.map((cat, i) => (
          <div key={i} style={S.catRow}>
            <span style={{ fontSize: 13, color: '#a0acd0' }}>{cat.name}</span>
            <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: cat.coryat >= 0 ? '#4caf7d' : '#e57373' }}>
              {cat.coryat >= 0 ? '+' : ''}{cat.coryat.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
      <div style={S.explainer}>
        <div style={S.sectionTitle}>ABOUT CORYAT SCORING</div>
        <p style={{ fontSize: 13, color: '#6878a8', lineHeight: 1.6 }}>
          Coryat score measures unassisted performance: correct answers add face value, incorrect answers subtract face value, and Daily Doubles are excluded entirely. It's the standard metric serious Jeopardy players use to track improvement over time.
        </p>
        <p style={{ fontSize: 13, color: '#6878a8', lineHeight: 1.6, marginTop: 8 }}>
          A score above $15,000 is competitive. Regular contestants typically average $20,000–$30,000.
        </p>
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

  // Episode loader
  loaderBar: { display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' },
  loaderInput: { flex: 1, background: '#0a0f2e', border: '1px solid #1a2460', borderRadius: 8, color: '#e8e8f0', fontSize: 13, padding: '8px 12px', fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 1 },
  loaderBtn: { background: 'rgba(245,197,24,0.1)', border: '1px solid rgba(245,197,24,0.3)', borderRadius: 8, color: '#f5c518', fontSize: 12, fontWeight: 700, padding: '8px 14px', fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 1 },
  loadError: { fontSize: 12, color: '#e07070', background: 'rgba(224,112,112,0.08)', borderRadius: 8, padding: '8px 12px', marginBottom: 8 },
  episodeLink: { textAlign: 'right', marginBottom: 6 },
}

const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700&family=Barlow:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #060b1a; overscroll-behavior: none; }
  button { cursor: pointer; border: none; background: none; font-family: inherit; }
  textarea:focus, input:focus { outline: 1px solid #f5c518; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: #0a0f2e; }
  ::-webkit-scrollbar-thumb { background: #1a2460; border-radius: 99px; }
`
