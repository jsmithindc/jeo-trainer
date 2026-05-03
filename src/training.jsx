import { useState, useEffect, useRef } from 'react'

// ─── Historical data ──────────────────────────────────────────────────────────
// Approximate Coryat distributions for Jeopardy contestants
// Based on analysis of j-archive data
export const HISTORICAL_CORYAT = {
  mean: 21400,
  stdDev: 6800,
  min: 4000,
  max: 42000,
}

// Historical average scores by position heading into FJ
// [leader, second, third] approximate distributions
export const HISTORICAL_SCORES = {
  leader:  { mean: 24000, stdDev: 7000 },
  second:  { mean: 16000, stdDev: 5000 },
  third:   { mean: 9000,  stdDev: 4000 },
}

function gaussianRandom(mean, stdDev) {
  // Box-Muller transform
  const u1 = Math.random(), u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return Math.round(mean + z * stdDev)
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

export function generateOpponent(position) {
  const dist = HISTORICAL_SCORES[position]
  return clamp(gaussianRandom(dist.mean, dist.stdDev), 2000, 50000)
}

// ─── Streak helpers ───────────────────────────────────────────────────────────
export function calcStreak(gameHistory) {
  if (!gameHistory.length) return { current: 0, longest: 0, thisWeek: 0, total: gameHistory.length }

  // Current streak: consecutive days with at least one game
  const daySet = new Set(gameHistory.map(g => g.playedAt?.slice(0, 10)).filter(Boolean))
  const days = [...daySet].sort().reverse()

  let current = 0
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  if (days[0] === today || days[0] === yesterday) {
    current = 1
    for (let i = 1; i < days.length; i++) {
      const prev = new Date(days[i - 1])
      const curr = new Date(days[i])
      const diff = (prev - curr) / 86400000
      if (diff <= 1.5) current++
      else break
    }
  }

  // Longest streak
  let longest = 1, run = 1
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1])
    const curr = new Date(days[i])
    if ((prev - curr) / 86400000 <= 1.5) { run++; longest = Math.max(longest, run) }
    else run = 1
  }

  // This week
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const thisWeek = gameHistory.filter(g => (g.playedAt || '') >= weekAgo).length

  return { current, longest, thisWeek, total: gameHistory.length }
}

// ─── Weakness Tracker ─────────────────────────────────────────────────────────
export function WeaknessTracker({ gameHistory }) {
  const S = styles

  // Aggregate all category scores across all games
  const catMap = {}
  gameHistory.forEach(game => {
    const processBreakdown = (breakdown, round) => {
      if (!breakdown) return
      breakdown.forEach(cat => {
        const key = cat.name
        if (!catMap[key]) catMap[key] = { name: key, scores: [], total: 0, games: 0 }
        catMap[key].scores.push(cat.score)
        catMap[key].total += cat.score
        catMap[key].games++
      })
    }
    processBreakdown(game.singleBreakdown, 'single')
    processBreakdown(game.doubleBreakdown, 'double')
  })

  const categories = Object.values(catMap)
    .filter(c => c.games >= 1)
    .map(c => ({ ...c, avg: Math.round(c.total / c.games) }))
    .sort((a, b) => a.avg - b.avg) // worst first

  if (categories.length === 0) {
    return (
      <div style={S.emptyState}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
        <div style={{ color: '#6070a0', fontSize: 13 }}>Play more games to see your weak spots.</div>
      </div>
    )
  }

  const worst = categories.slice(0, 5)
  const best = categories.slice(-5).reverse()
  const maxAbs = Math.max(...categories.map(c => Math.abs(c.avg)), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={S.card}>
        <div style={S.sectionTitle}>WEAKEST CATEGORIES</div>
        {worst.map(cat => <CategoryBar key={cat.name} cat={cat} maxAbs={maxAbs} />)}
      </div>
      <div style={S.card}>
        <div style={S.sectionTitle}>STRONGEST CATEGORIES</div>
        {best.map(cat => <CategoryBar key={cat.name} cat={cat} maxAbs={maxAbs} />)}
      </div>
      {categories.length > 10 && (
        <div style={S.card}>
          <div style={S.sectionTitle}>ALL CATEGORIES ({categories.length})</div>
          {categories.map(cat => <CategoryBar key={cat.name} cat={cat} maxAbs={maxAbs} />)}
        </div>
      )}
    </div>
  )
}

function CategoryBar({ cat, maxAbs }) {
  const S = styles
  const pct = Math.abs(cat.avg) / maxAbs * 100
  const isNeg = cat.avg < 0
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 12, color: '#a0acd0' }}>{cat.name}</span>
        <span style={{ fontSize: 12, fontFamily: "'Bebas Neue', sans-serif", color: isNeg ? '#e57373' : '#4caf7d' }}>
          {cat.avg >= 0 ? '+' : ''}{cat.avg.toLocaleString()} avg · {cat.games}g
        </span>
      </div>
      <div style={{ height: 4, background: '#1a2040', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: isNeg ? '#e57373' : '#4caf7d', borderRadius: 99 }} />
      </div>
    </div>
  )
}

// ─── Speed Tracker ────────────────────────────────────────────────────────────
export function SpeedTracker({ gameHistory }) {
  const S = styles
  const sessions = gameHistory
    .filter(g => g.timedStats && g.timedStats.buzzTimes?.length > 0)
    .slice(0, 20)

  if (sessions.length === 0) {
    return (
      <div style={S.emptyState}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>⚡</div>
        <div style={{ color: '#6070a0', fontSize: 13 }}>Play games in Timed Mode to track your reaction speed.</div>
      </div>
    )
  }

  const allTimes = sessions.flatMap(s => s.timedStats.buzzTimes)
  const avgMs = Math.round(allTimes.reduce((a, b) => a + b, 0) / allTimes.length)
  const bestMs = Math.min(...allTimes)
  const recentAvg = Math.round(sessions.slice(0, 5).flatMap(s => s.timedStats.buzzTimes).reduce((a, b, _, arr) => a + b / arr.length, 0))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={S.card}>
        <div style={S.sectionTitle}>BUZZ REACTION TIME</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
          {[['ALL-TIME AVG', `${(avgMs/1000).toFixed(2)}s`], ['BEST', `${(bestMs/1000).toFixed(2)}s`], ['RECENT AVG', `${(recentAvg/1000).toFixed(2)}s`]].map(([l, v]) => (
            <div key={l} style={S.statMini}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: '#f5c518' }}>{v}</div>
              <div style={{ fontSize: 9, color: '#6070a0', letterSpacing: 2 }}>{l}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: '#6070a0', lineHeight: 1.6 }}>
          In real Jeopardy, top contestants buzz in within 0.2–0.5 seconds of the light turning on. The buzz window is 5 seconds — aim to buzz under 1.5s.
        </div>
      </div>
      {sessions.length > 1 && (
        <div style={S.card}>
          <div style={S.sectionTitle}>TREND</div>
          <BuzzSparkline sessions={sessions} />
        </div>
      )}
    </div>
  )
}

function BuzzSparkline({ sessions }) {
  const avgs = sessions.map(s => {
    const times = s.timedStats.buzzTimes
    return times.reduce((a, b) => a + b, 0) / times.length / 1000
  }).reverse()

  const min = Math.min(...avgs)
  const max = Math.max(...avgs)
  const range = max - min || 0.1
  const w = 280, h = 60, pad = 8

  const points = avgs.map((v, i) => {
    const x = pad + (i / Math.max(avgs.length - 1, 1)) * (w - pad * 2)
    // Lower is better — invert Y
    const y = pad + ((v - min) / range) * (h - pad * 2)
    return `${x},${y}`
  }).join(' ')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={w} height={h}>
        <polyline points={points} fill="none" stroke="#4dd0e1" strokeWidth="2" strokeLinejoin="round" />
        {avgs.map((v, i) => {
          const x = pad + (i / Math.max(avgs.length - 1, 1)) * (w - pad * 2)
          const y = pad + ((v - min) / range) * (h - pad * 2)
          return <circle key={i} cx={x} cy={y} r="3" fill="#4dd0e1" />
        })}
      </svg>
      <div style={{ fontSize: 10, color: '#4060a0', marginTop: 4 }}>Lower = faster · {avgs.length} sessions</div>
    </div>
  )
}

// ─── Category Confidence Modal ────────────────────────────────────────────────
export function CategoryConfidenceModal({ board, onConfirm, onSkip }) {
  const S = styles
  const [ratings, setRatings] = useState({})
  const categories = board?.categories?.map(c => c.name) || []

  const LABELS = ['😬', '😐', '🙂', '😎']
  const LABEL_TEXT = ['Weak', 'OK', 'Good', 'Strong']

  return (
    <div style={overStyles.overlay}>
      <div style={{ ...overStyles.modal, maxWidth: 480 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: '#f5c518', letterSpacing: 2, marginBottom: 4 }}>
          RATE YOUR CONFIDENCE
        </div>
        <div style={{ fontSize: 12, color: '#6070a0', marginBottom: 16, lineHeight: 1.6 }}>
          Before you play, rate how confident you feel in each category. We'll compare to your actual performance.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {categories.map(cat => (
            <div key={cat}>
              <div style={{ fontSize: 12, color: '#a0acd0', marginBottom: 6, letterSpacing: 1 }}>{cat}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {LABELS.map((emoji, i) => (
                  <button
                    key={i}
                    onClick={() => setRatings(r => ({ ...r, [cat]: i }))}
                    style={{
                      flex: 1, padding: '8px 4px', borderRadius: 8, fontSize: 18,
                      background: ratings[cat] === i ? 'rgba(245,197,24,0.15)' : 'rgba(255,255,255,0.04)',
                      border: ratings[cat] === i ? '1px solid #f5c518' : '1px solid #1a2460',
                      cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                    }}
                  >
                    <span>{emoji}</span>
                    <span style={{ fontSize: 8, color: ratings[cat] === i ? '#f5c518' : '#4060a0', letterSpacing: 1 }}>{LABEL_TEXT[i]}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...overStyles.btn, flex: 1, background: 'rgba(255,255,255,0.04)', color: '#6070a0', border: '1px solid #1a2460' }} onClick={onSkip}>
            Skip
          </button>
          <button style={{ ...overStyles.btn, flex: 2, background: '#f5c518', color: '#060b1a' }} onClick={() => onConfirm(ratings)}>
            Start Game →
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Wager Trainer ────────────────────────────────────────────────────────────
export function WagerTrainer({ type, coryatScore, boardValue, opponentScores, onWager, onSkip, lastClueResult, answeredCount }) {
  // type: 'daily_double' | 'final_jeopardy'
  const S = styles
  const [wager, setWager] = useState('')
  const [showStrategy, setShowStrategy] = useState(false)
  const [boardControlOverride, setBoardControlOverride] = useState(false)

  const isDD = type === 'daily_double'

  // Board control rule: can only wager on DD if last clue was correct
  // (or it's the very first clue of the game)
  const isFirstClue = answeredCount === 0
  const hasControl = isFirstClue || lastClueResult === 'correct'
  const showBoardControlWarning = isDD && !hasControl && !boardControlOverride

  // Calculate optimal wager advice
  function getStrategy() {
    if (isDD) {
      const maxWager = Math.max(coryatScore, 1000) // can always wager at least $1000 on DD
      const trueDDMin = 5 // minimum $5 wager
      const remaining = boardValue

      const advice = []
      if (coryatScore <= 0) {
        advice.push(`With a score of ${coryatScore.toLocaleString()}, wager the minimum ($5) — you can't afford to go deeper in the hole.`)
      } else if (coryatScore > remaining * 2) {
        advice.push(`You have a commanding lead. A small wager (e.g. $1,000) protects your position. True Daily Double (${maxWager.toLocaleString()}) is only worth it if you're very confident.`)
      } else {
        advice.push(`With $${remaining.toLocaleString()} left on the board, a True Daily Double ($${maxWager.toLocaleString()}) is high-risk but can dramatically change the game.`)
        advice.push(`A conservative wager of $${Math.round(coryatScore * 0.3).toLocaleString()} keeps you competitive even if wrong.`)
      }
      return advice
    } else {
      // FJ wagering
      const [opp1, opp2] = opponentScores || [0, 0]
      const leader = Math.max(coryatScore, opp1, opp2)
      const isLeader = coryatScore === leader
      const secondPlace = [coryatScore, opp1, opp2].sort((a, b) => b - a)[1]

      const advice = []
      if (isLeader) {
        const lockout = Math.floor(secondPlace / 2) // wager to lock out second place
        const safeWager = coryatScore - secondPlace - 1
        advice.push(`You're in the lead. Wager at most $${safeWager.toLocaleString()} to guarantee a win even if you're wrong and 2nd place bets everything correctly.`)
        advice.push(`"Lock" strategy: wager exactly $${Math.max(0, coryatScore - lockout).toLocaleString()} — if correct, you'll have ${(coryatScore + Math.max(0, coryatScore - lockout)).toLocaleString()} which beats 2nd place doubling up.`)
      } else {
        const needed = leader - coryatScore + 1
        const maxWager = coryatScore
        advice.push(`You need to gain at least $${needed.toLocaleString()} on the leader. Wager everything ($${maxWager.toLocaleString()}) if you're confident — it's your only path to winning.`)
        if (coryatScore > secondPlace) {
          advice.push(`You're in 2nd — even a conservative bet could work if the leader bets big and gets it wrong.`)
        }
      }
      return advice
    }
  }

  const maxWager = isDD
    ? Math.max(coryatScore > 0 ? coryatScore : 0, 1000)
    : coryatScore

  const parsedWager = parseInt(wager) || 0
  const isValid = parsedWager >= 5 && parsedWager <= maxWager

  return (
    <div style={overStyles.overlay}>
      <div style={{ ...overStyles.modal, maxWidth: 420 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: '#f5c518', letterSpacing: 2, marginBottom: 4 }}>
          {isDD ? '⭐ DAILY DOUBLE' : '🎯 FINAL JEOPARDY'}
        </div>
        <div style={{ fontSize: 11, color: '#6070a0', letterSpacing: 2, marginBottom: 16 }}>WAGER TRAINER</div>

        {/* Score context */}
        <div style={{ display: 'grid', gridTemplateColumns: isDD ? '1fr 1fr' : 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
          <div style={S.statMini}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: '#f5c518' }}>
              {coryatScore >= 0 ? '+' : ''}{coryatScore.toLocaleString()}
            </div>
            <div style={{ fontSize: 9, color: '#6070a0', letterSpacing: 1 }}>YOUR SCORE</div>
          </div>
          {isDD ? (
            <div style={S.statMini}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: '#8890c0' }}>
                ${boardValue.toLocaleString()}
              </div>
              <div style={{ fontSize: 9, color: '#6070a0', letterSpacing: 1 }}>BOARD LEFT</div>
            </div>
          ) : (
            opponentScores?.map((score, i) => (
              <div key={i} style={S.statMini}>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: '#8890c0' }}>
                  {score.toLocaleString()}
                </div>
                <div style={{ fontSize: 9, color: '#6070a0', letterSpacing: 1 }}>OPP {i + 1}</div>
              </div>
            ))
          )}
        </div>

        {/* Board control warning */}
        {showBoardControlWarning && (
          <div style={{ background: 'rgba(255,183,77,0.1)', border: '1px solid rgba(255,183,77,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#ffb74d', fontWeight: 700, marginBottom: 4 }}>
              ⚠️ You don&apos;t have board control
            </div>
            <div style={{ fontSize: 12, color: '#8890c0', lineHeight: 1.6, marginBottom: 8 }}>
              In real Jeopardy, you can only select a Daily Double if you gave a correct response on the previous clue. Your last answer was {lastClueResult === 'pass' ? 'a pass' : 'incorrect'}.
            </div>
            <button
              style={{ fontSize: 12, color: '#ffb74d', letterSpacing: 1, fontWeight: 700, background: 'rgba(255,183,77,0.1)', border: '1px solid rgba(255,183,77,0.3)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontFamily: "'Barlow Condensed', sans-serif" }}
              onClick={() => setBoardControlOverride(true)}
            >
              Wager anyway (practice mode) →
            </button>
          </div>
        )}

        {/* Wager input */}
        {!showBoardControlWarning && (<>
        <div style={{ fontSize: 10, color: '#6070a0', letterSpacing: 3, marginBottom: 6 }}>
          YOUR WAGER (max ${maxWager.toLocaleString()})
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            style={{ ...overStyles.input, flex: 1, fontSize: 20, textAlign: 'center', fontFamily: "'Bebas Neue', sans-serif" }}
            type="number"
            value={wager}
            onChange={e => setWager(e.target.value)}
            placeholder="0"
            min={5}
            max={maxWager}
          />
          {isDD && (
            <button
              style={{ ...overStyles.btn, background: 'rgba(245,197,24,0.1)', color: '#f5c518', border: '1px solid rgba(245,197,24,0.3)', fontSize: 11, letterSpacing: 1 }}
              onClick={() => setWager(String(maxWager))}
            >
              TRUE DD
            </button>
          )}
        </div>

        {/* Strategy toggle */}
        <button
          style={{ fontSize: 11, color: '#4060a0', letterSpacing: 1, marginBottom: showStrategy ? 8 : 16, width: '100%', textAlign: 'left' }}
          onClick={() => setShowStrategy(!showStrategy)}
        >
          {showStrategy ? '▼' : '▶'} Wagering strategy
        </button>

        {showStrategy && (
          <div style={{ background: '#0a0f2e', borderRadius: 8, padding: '10px 12px', marginBottom: 16, border: '1px solid #1a2460' }}>
            {getStrategy().map((tip, i) => (
              <p key={i} style={{ fontSize: 12, color: '#8890c0', lineHeight: 1.6, marginBottom: i < getStrategy().length - 1 ? 8 : 0 }}>{tip}</p>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...overStyles.btn, flex: 1, background: 'rgba(255,255,255,0.04)', color: '#6070a0', border: '1px solid #1a2460' }} onClick={onSkip}>
            Skip Wagering
          </button>
          <button
            style={{ ...overStyles.btn, flex: 2, background: '#f5c518', color: '#060b1a', opacity: isValid ? 1 : 0.4 }}
            onClick={() => isValid && onWager(parsedWager)}
            disabled={!isValid}
          >
            Wager ${parsedWager.toLocaleString()} →
          </button>
        </div>
        </>)} {/* end !showBoardControlWarning */}

        {/* Always show skip when board control warning visible */}
        {showBoardControlWarning && (
          <button style={{ ...overStyles.btn, width: '100%', background: 'rgba(255,255,255,0.04)', color: '#6070a0', border: '1px solid #1a2460', marginTop: 4 }} onClick={onSkip}>
            Skip (treat as regular clue)
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Tournament Simulator Setup ───────────────────────────────────────────────
export function TournamentSetup({ onStart, onClose }) {
  const S = styles
  const [position, setPosition] = useState('random') // random | 1 | 2 | 3
  const [opp1, setOpp1] = useState('')
  const [opp2, setOpp2] = useState('')
  const [manualOpps, setManualOpps] = useState(false)

  function handleStart() {
    const pos = position === 'random' ? ['1','2','3'][Math.floor(Math.random() * 3)] : position
    const o1 = manualOpps && opp1 ? parseInt(opp1) : generateOpponent(pos === '1' ? 'second' : pos === '2' ? (Math.random() > 0.5 ? 'leader' : 'third') : 'second')
    const o2 = manualOpps && opp2 ? parseInt(opp2) : generateOpponent(pos === '3' ? 'leader' : 'third')
    onStart({ position: parseInt(pos), opponents: [o1, o2] })
  }

  return (
    <div style={overStyles.overlay} onClick={onClose}>
      <div style={{ ...overStyles.modal, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <button style={{ position: 'absolute', top: 10, right: 12, fontSize: 16, color: '#4050a0', background: 'none', border: 'none', cursor: 'pointer' }} onClick={onClose}>✕</button>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: '#f5c518', letterSpacing: 2, marginBottom: 4 }}>
          🏆 TOURNAMENT MODE
        </div>
        <div style={{ fontSize: 12, color: '#6070a0', marginBottom: 16, lineHeight: 1.6 }}>
          Compete against simulated opponents. Your Coryat score approximates your actual score. Opponent scores are drawn from historical contestant data.
        </div>

        <div style={{ fontSize: 10, color: '#6070a0', letterSpacing: 3, marginBottom: 8 }}>YOUR STARTING POSITION</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {[['random', '🎲 Random'], ['1', '🥇 1st'], ['2', '🥈 2nd'], ['3', '🥉 3rd']].map(([v, l]) => (
            <button key={v} style={{ flex: 1, padding: '8px 4px', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, fontFamily: "'Barlow Condensed', sans-serif", borderRadius: 8, cursor: 'pointer', background: position === v ? 'rgba(245,197,24,0.1)' : 'rgba(255,255,255,0.04)', color: position === v ? '#f5c518' : '#5060a0', border: position === v ? '1px solid #f5c518' : '1px solid #1a2460' }} onClick={() => setPosition(v)}>
              {l}
            </button>
          ))}
        </div>

        <button style={{ fontSize: 11, color: '#4060a0', letterSpacing: 1, marginBottom: manualOpps ? 8 : 16, width: '100%', textAlign: 'left' }} onClick={() => setManualOpps(!manualOpps)}>
          {manualOpps ? '▼' : '▶'} Set opponent scores manually
        </button>

        {manualOpps && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            {[['Opponent 1', opp1, setOpp1], ['Opponent 2', opp2, setOpp2]].map(([label, val, set]) => (
              <div key={label}>
                <div style={{ fontSize: 9, color: '#6070a0', letterSpacing: 2, marginBottom: 4 }}>{label.toUpperCase()}</div>
                <input style={{ ...overStyles.input, width: '100%' }} type="number" value={val} onChange={e => set(e.target.value)} placeholder="e.g. 18000" />
              </div>
            ))}
          </div>
        )}

        <button style={{ ...overStyles.btn, width: '100%', background: '#f5c518', color: '#060b1a' }} onClick={handleStart}>
          Start Tournament →
        </button>
      </div>
    </div>
  )
}

// ─── Opponent Score Display (during game) ─────────────────────────────────────
export function OpponentScoreBar({ tournamentState, coryatScore }) {
  if (!tournamentState) return null
  const { opponents, position } = tournamentState
  const allScores = [
    { label: 'You', score: coryatScore, isYou: true },
    ...opponents.map((s, i) => ({ label: `Opp ${i + 1}`, score: s, isYou: false })),
  ].sort((a, b) => b.score - a.score)

  const maxScore = Math.max(...allScores.map(s => Math.abs(s.score)), 1000)

  return (
    <div style={{ background: '#0a0f2e', border: '1px solid #1a3060', borderRadius: 10, padding: '10px 14px', marginBottom: 8 }}>
      <div style={{ fontSize: 9, letterSpacing: 3, color: '#6070a0', marginBottom: 8 }}>🏆 TOURNAMENT STANDINGS</div>
      {allScores.map((player, rank) => (
        <div key={player.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: player.isYou ? '#f5c518' : '#4060a0', width: 16 }}>
            {rank === 0 ? '🥇' : rank === 1 ? '🥈' : '🥉'}
          </span>
          <span style={{ fontSize: 11, color: player.isYou ? '#f5c518' : '#8890c0', width: 36, letterSpacing: 1 }}>
            {player.label}
          </span>
          <div style={{ flex: 1, height: 4, background: '#1a2040', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.max(0, player.score) / maxScore * 100}%`, background: player.isYou ? '#f5c518' : '#2a3580', borderRadius: 99, transition: 'width 0.5s' }} />
          </div>
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, color: player.isYou ? '#f5c518' : '#6070a0', width: 60, textAlign: 'right' }}>
            {player.score >= 0 ? '+' : ''}{player.score.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Opponent Coryat (end of game) ───────────────────────────────────────────
export function OpponentCoryatResult({ coryatScore, actualContestants, tournamentState }) {
  const S = styles
  const contestants = actualContestants?.length
    ? actualContestants
    : tournamentState?.opponents?.map((s, i) => ({ name: `Simulated Opp ${i + 1}`, score: s, simulated: true })) || []

  if (contestants.length === 0) return null

  const allScores = [
    { name: 'You', score: coryatScore, isYou: true },
    ...contestants,
  ].sort((a, b) => b.score - a.score)

  const yourRank = allScores.findIndex(s => s.isYou) + 1
  const medalEmoji = yourRank === 1 ? '🥇' : yourRank === 2 ? '🥈' : '🥉'

  return (
    <div style={S.card}>
      <div style={S.sectionTitle}>
        {contestants.some(c => c.simulated) ? 'SIMULATED OPPONENT SCORES' : 'ACTUAL CONTESTANT SCORES'}
      </div>
      {allScores.map((player, i) => (
        <div key={player.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1a2040' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</span>
            <span style={{ fontSize: 13, color: player.isYou ? '#f5c518' : '#a0acd0' }}>
              {player.name}{player.simulated ? ' *' : ''}
            </span>
          </div>
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: player.isYou ? '#f5c518' : player.score >= 0 ? '#4caf7d' : '#e57373' }}>
            {player.score >= 0 ? '+' : ''}{player.score.toLocaleString()}
          </span>
        </div>
      ))}
      <div style={{ fontSize: 11, color: '#6070a0', marginTop: 10, lineHeight: 1.6 }}>
        {yourRank === 1 ? `${medalEmoji} You would have won this game!` : `${medalEmoji} You finished in ${yourRank}${yourRank === 2 ? 'nd' : 'rd'} place.`}
        {contestants.some(c => c.simulated) && ' * Simulated based on historical contestant data.'}
      </div>
    </div>
  )
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const styles = {
  card: { background: '#0a0f2e', borderRadius: 12, padding: '14px 16px', border: '1px solid #1a2460' },
  sectionTitle: { fontSize: 10, letterSpacing: 3, color: '#6070a0', marginBottom: 10 },
  statMini: { background: '#060b1a', borderRadius: 8, padding: '10px 6px', textAlign: 'center', border: '1px solid #1a2040' },
  emptyState: { textAlign: 'center', padding: '40px 16px' },
}

const overStyles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 },
  modal: { background: 'linear-gradient(160deg,#0f1e6e,#060b1a)', border: '2px solid #f5c518', borderRadius: 12, padding: '28px 20px 20px', width: '100%', textAlign: 'left', position: 'relative', boxShadow: '0 20px 60px rgba(245,197,24,0.2)', maxHeight: '90vh', overflowY: 'auto' },
  btn: { borderRadius: 8, padding: '12px 20px', fontSize: 14, fontWeight: 700, letterSpacing: 1, fontFamily: "'Barlow Condensed', sans-serif", cursor: 'pointer', border: 'none' },
  input: { background: '#060b1a', border: '1px solid #1a2460', borderRadius: 8, color: '#e8e8f0', fontSize: 14, padding: '9px 12px', fontFamily: "'Barlow Condensed', sans-serif" },
}
