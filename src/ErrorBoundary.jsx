import { Component } from 'react'

const GAME_STATE_KEY = 'coryat-game-state-v1'

/**
 * Catches render-time errors so a single bad component shows a readable message
 * instead of unmounting the whole tree (the blank blue screen).
 *
 * Note: this only catches errors thrown during render/lifecycle. Errors inside
 * event handlers or promise callbacks are not caught here.
 *
 * Deliberately self-contained — no imports beyond React, inline styles only, so
 * nothing this component depends on can be the thing that's broken.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null, clearedGame: false }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  clearSavedGame = () => {
    try { localStorage.removeItem(GAME_STATE_KEY) } catch {}
    this.setState({ clearedGame: true })
  }

  render() {
    const { error, info, clearedGame } = this.state
    if (!error) return this.props.children

    const detail = [
      error.stack || String(error),
      info?.componentStack ? `\nComponent stack:${info.componentStack}` : '',
    ].join('')

    return (
      <div style={S.wrap}>
        <div style={S.inner}>
          <div style={S.icon}>⚠️</div>
          <div style={S.title}>SOMETHING BROKE</div>
          <div style={S.sub}>
            Jeo Trainer hit an error while drawing the screen. Your flashcards and game
            history are stored separately and have not been touched.
          </div>

          <div style={S.errBox}>
            <div style={S.errLabel}>ERROR</div>
            <div style={S.errMsg}>{error.message || String(error)}</div>
          </div>

          <div style={S.btnRow}>
            <button style={S.btnPrimary} onClick={() => window.location.reload()}>
              Reload app
            </button>
            <button
              style={{ ...S.btnGhost, ...(clearedGame ? S.btnDone : {}) }}
              onClick={this.clearSavedGame}
              disabled={clearedGame}
            >
              {clearedGame ? '✓ Cleared — now reload' : 'Discard saved game'}
            </button>
          </div>

          <div style={S.hint}>
            A corrupted in-progress game is the most common cause. Discarding it loses
            only that unfinished game, never your deck.
          </div>

          <details style={S.details}>
            <summary style={S.summary}>Technical details</summary>
            <pre style={S.pre}>{detail}</pre>
          </details>
        </div>
      </div>
    )
  }
}

const S = {
  wrap: {
    background: '#060b1a',
    minHeight: '100dvh',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '48px 16px',
    fontFamily: "'Barlow Condensed', system-ui, sans-serif",
    color: '#c0c8e8',
  },
  inner: { width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' },
  icon: { fontSize: 40 },
  title: {
    fontFamily: "'Bebas Neue', 'Arial Narrow', sans-serif",
    fontSize: 34,
    letterSpacing: 4,
    color: '#f5c518',
    textAlign: 'center',
  },
  sub: { fontSize: 14, lineHeight: 1.5, color: '#8890c0', textAlign: 'center', maxWidth: 420 },
  errBox: {
    width: '100%',
    background: '#0a0f2e',
    border: '1px solid #2a3480',
    borderLeft: '3px solid #e57373',
    borderRadius: 8,
    padding: '12px 14px',
  },
  errLabel: { fontSize: 9, letterSpacing: 3, color: '#6070a0', marginBottom: 4 },
  errMsg: { fontSize: 14, color: '#e57373', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word' },
  btnRow: { display: 'flex', gap: 10, width: '100%', flexWrap: 'wrap' },
  btnPrimary: {
    flex: '1 1 160px',
    background: '#f5c518',
    color: '#060b1a',
    border: 'none',
    borderRadius: 8,
    padding: '12px 16px',
    fontFamily: "'Bebas Neue', 'Arial Narrow', sans-serif",
    fontSize: 17,
    letterSpacing: 2,
    cursor: 'pointer',
  },
  btnGhost: {
    flex: '1 1 160px',
    background: 'transparent',
    color: '#8890d0',
    border: '1px solid #2e3476',
    borderRadius: 8,
    padding: '12px 16px',
    fontFamily: "'Bebas Neue', 'Arial Narrow', sans-serif",
    fontSize: 17,
    letterSpacing: 2,
    cursor: 'pointer',
  },
  btnDone: { color: '#81c784', borderColor: '#81c784', cursor: 'default' },
  hint: { fontSize: 12, color: '#4060a0', textAlign: 'center', lineHeight: 1.5, maxWidth: 420 },
  details: { width: '100%', marginTop: 4 },
  summary: { fontSize: 11, letterSpacing: 2, color: '#4060a0', cursor: 'pointer' },
  pre: {
    fontSize: 10.5,
    lineHeight: 1.5,
    color: '#6070a0',
    background: '#05081a',
    border: '1px solid #1a2040',
    borderRadius: 6,
    padding: 10,
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: 280,
  },
}
