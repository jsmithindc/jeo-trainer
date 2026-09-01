// ─── Meta-category mapping ────────────────────────────────────────────────────
// Maps Jeopardy category names to broad meta-categories
const META_CATEGORIES = {
  'Science & Nature': [
    'science', 'nature', 'biology', 'chemistry', 'physics', 'astronomy', 'space',
    'animals', 'plants', 'geology', 'weather', 'medicine', 'anatomy', 'ecology',
    'math', 'mathematics', 'technology', 'computers', 'inventions', 'elements',
    'periodic', 'evolution', 'genetics', 'zoology', 'botany', 'oceanography',
  ],
  'History': [
    'history', 'historical', 'war', 'wars', 'revolution', 'ancient', 'medieval',
    'presidents', 'president', 'political', 'politics', 'government', 'leaders',
    'world war', 'american history', 'european history', 'civil war', 'dynasties',
    'empires', 'battles', 'treaties', 'constitution', 'congress', 'senate',
  ],
  'Geography': [
    'geography', 'capitals', 'capital', 'countries', 'cities', 'states', 'rivers',
    'mountains', 'oceans', 'continents', 'islands', 'maps', 'world', 'national',
    'flags', 'borders', 'regions', 'landmarks', 'africa', 'europe', 'asia',
    'america', 'australia', 'canada', 'uk', 'france', 'germany', 'italy',
  ],
  'Literature': [
    'literature', 'novels', 'novel', 'books', 'authors', 'poetry', 'poems',
    'shakespeare', 'fiction', 'nonfiction', 'characters', 'literary', 'writers',
    'pulitzer', 'nobel', 'bestseller', 'classic', 'dickens', 'hemingway',
    'twain', 'poe', 'fitzgerald', 'steinbeck', 'orwell', 'tolkien',
  ],
  'Arts & Entertainment': [
    'movies', 'films', 'film', 'television', 'tv', 'music', 'songs', 'oscar',
    'emmy', 'grammy', 'broadway', 'theater', 'theatre', 'opera', 'classical',
    'jazz', 'rock', 'pop', 'artists', 'paintings', 'sculpture', 'museums',
    'actors', 'directors', 'singers', 'bands', 'albums', 'entertainment',
    'hollywood', 'disney', 'animated', 'documentary', 'sitcom', 'drama',
  ],
  'Sports & Games': [
    'sports', 'football', 'baseball', 'basketball', 'hockey', 'soccer', 'tennis',
    'golf', 'olympics', 'athletes', 'teams', 'championship', 'super bowl',
    'world series', 'nba', 'nfl', 'mlb', 'nhl', 'games', 'chess', 'poker',
    'swimming', 'track', 'gymnastics', 'boxing', 'wrestling', 'racing',
  ],
  'Language & Words': [
    'words', 'language', 'vocabulary', 'grammar', 'etymology', 'phrases',
    'idioms', 'rhymes', 'anagrams', 'crossword', 'spelling', 'definitions',
    'latin', 'french words', 'acronyms', 'abbreviations', 'slang', 'quotes',
    'quotations', 'proverbs', 'sayings', 'wordplay', 'homonyms', 'synonyms',
  ],
  'Food & Drink': [
    'food', 'drinks', 'cuisine', 'cooking', 'recipes', 'restaurants', 'chefs',
    'wine', 'beer', 'cocktails', 'fruits', 'vegetables', 'desserts', 'baking',
    'ingredients', 'spices', 'cheeses', 'meats', 'seafood', 'coffee', 'tea',
  ],
  'People & Celebrities': [
    'celebrities', 'famous', 'biography', 'biographies', 'royalty', 'nobility',
    'inventors', 'scientists', 'explorers', 'philosophers', 'musicians',
    'athletes', 'businessmen', 'entrepreneurs', 'nobel laureates', 'first ladies',
    'vice presidents', 'astronauts', 'generals', 'admirals',
  ],
  'Potpourri': [], // catch-all
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Cache the compiled patterns — this runs for every category of every game whenever
// the heat map, weakness tracker or Coryat prediction is rebuilt.
const KEYWORD_PATTERNS = Object.fromEntries(
  Object.entries(META_CATEGORIES)
    .filter(([meta]) => meta !== 'Potpourri')
    .map(([meta, keywords]) => [
      meta,
      // Whole words only, matching singular and plural in both directions: the list
      // holds 'olympics' but a category reads OLYMPIC, and holds 'novel' where a
      // category reads NOVELS. Plain substring matching meant 'war' fired on WARHOL
      // and HOWARD, 'uk' on DUKE, and 'pop' on POPULATION — quietly misfiling the
      // categories the study recommendations are built from.
      keywords.map(kw => {
        const stem = kw.length > 3 && kw.endsWith('s') ? kw.slice(0, -1) : kw
        return { weight: stem.length, re: new RegExp(`(^|[^a-z])${escapeRe(stem)}s?([^a-z]|$)`, 'i') }
      }),
    ])
)

export function getMetaCategory(categoryName) {
  const lower = (categoryName || '').toLowerCase()
  if (!lower) return 'Potpourri'

  // Score every meta-category and take the best match rather than the first one that
  // happens to hit. Object key order used to decide ties, so "SPORTS MOVIES" landed
  // in Arts purely because Arts is declared above Sports.
  // Weight matches by keyword length so a specific hit ("swimming") outranks a vague
  // one ("tv"), instead of every keyword counting equally and ties falling to
  // whichever meta-category happens to be declared first.
  let best = 'Potpourri'
  let bestScore = 0
  for (const [meta, patterns] of Object.entries(KEYWORD_PATTERNS)) {
    let score = 0
    for (const { re, weight } of patterns) if (re.test(lower)) score += weight
    if (score > bestScore) { bestScore = score; best = meta }
  }
  return best
}

export const META_CATEGORY_NAMES = Object.keys(META_CATEGORIES)

// ─── Analytics ────────────────────────────────────────────────────────────────

export function buildCategoryHeatMap(gameHistory) {
  const metaMap = {}
  META_CATEGORY_NAMES.forEach(m => {
    metaMap[m] = { meta: m, totalScore: 0, games: 0, cluesCorrect: 0, cluesTotal: 0 }
  })

  gameHistory.forEach(game => {
    const processBreakdown = (breakdown) => {
      if (!breakdown) return
      breakdown.forEach(cat => {
        const meta = getMetaCategory(cat.name)
        metaMap[meta].totalScore += cat.score
        metaMap[meta].games++
      })
    }
    processBreakdown(game.singleBreakdown)
    processBreakdown(game.doubleBreakdown)
  })

  return Object.values(metaMap).filter(m => m.games > 0).map(m => ({
    ...m,
    avg: Math.round(m.totalScore / m.games),
  })).sort((a, b) => a.avg - b.avg)
}

export function buildValueBreakdown(gameHistory) {
  // Track performance by dollar value tier
  const tiers = { 200: { correct: 0, incorrect: 0, pass: 0 }, 400: { correct: 0, incorrect: 0, pass: 0 }, 600: { correct: 0, incorrect: 0, pass: 0 }, 800: { correct: 0, incorrect: 0, pass: 0 }, 1000: { correct: 0, incorrect: 0, pass: 0 } }

  gameHistory.forEach(game => {
    if (!game.valueBreakdown) return
    Object.entries(game.valueBreakdown).forEach(([val, stats]) => {
      const tier = parseInt(val)
      if (tiers[tier]) {
        tiers[tier].correct += stats.correct || 0
        tiers[tier].incorrect += stats.incorrect || 0
        tiers[tier].pass += stats.pass || 0
      }
    })
  })

  return Object.entries(tiers).map(([val, stats]) => {
    const total = stats.correct + stats.incorrect + stats.pass
    return {
      value: parseInt(val),
      ...stats,
      total,
      accuracy: total > 0 ? Math.round((stats.correct / total) * 100) : null,
    }
  })
}

export function predictCoryat(gameHistory, currentBoard) {
  if (gameHistory.length < 10) return null

  // Build per-meta-category average score per game
  const metaAvgs = {}
  META_CATEGORY_NAMES.forEach(m => { metaAvgs[m] = { scores: [] } })

  gameHistory.forEach(game => {
    const combined = [...(game.singleBreakdown || []), ...(game.doubleBreakdown || [])]
    combined.forEach(cat => {
      const meta = getMetaCategory(cat.name)
      metaAvgs[meta].scores.push(cat.score)
    })
  })

  // Calculate mean and std dev per meta-category
  const metaStats = {}
  Object.entries(metaAvgs).forEach(([meta, { scores }]) => {
    if (scores.length === 0) { metaStats[meta] = { mean: 0, std: 0 }; return }
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length
    const std = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length)
    metaStats[meta] = { mean, std, n: scores.length }
  })

  if (!currentBoard?.categories) return null

  // Sum up predictions for each category in current board
  let predictedMean = 0
  let predictedVariance = 0
  const allCats = [...(currentBoard.categories || [])]

  allCats.forEach(cat => {
    const meta = getMetaCategory(cat.name)
    const stats = metaStats[meta]
    if (stats && stats.n > 0) {
      predictedMean += stats.mean
      predictedVariance += stats.std ** 2
    }
  })

  const std = Math.sqrt(predictedVariance)
  return {
    low: Math.round(predictedMean - std),
    mid: Math.round(predictedMean),
    high: Math.round(predictedMean + std),
  }
}

// ─── Anki .apkg export ────────────────────────────────────────────────────────
export async function exportToApkg(cards) {
  const initSqlJs = (await import('sql.js')).default
  const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' })

  const db = new SQL.Database()

  // Create Anki schema
  db.run(`CREATE TABLE notes (
    id INTEGER PRIMARY KEY,
    guid TEXT,
    mid INTEGER,
    mod INTEGER,
    usn INTEGER DEFAULT -1,
    tags TEXT DEFAULT '',
    flds TEXT,
    sfld TEXT,
    csum INTEGER DEFAULT 0,
    flags INTEGER DEFAULT 0,
    data TEXT DEFAULT ''
  )`)

  db.run(`CREATE TABLE cards (
    id INTEGER PRIMARY KEY,
    nid INTEGER,
    did INTEGER DEFAULT 1,
    ord INTEGER DEFAULT 0,
    mod INTEGER,
    usn INTEGER DEFAULT -1,
    type INTEGER DEFAULT 0,
    queue INTEGER DEFAULT 0,
    due INTEGER DEFAULT 0,
    ivl INTEGER DEFAULT 0,
    factor INTEGER DEFAULT 2500,
    reps INTEGER DEFAULT 0,
    lapses INTEGER DEFAULT 0,
    left INTEGER DEFAULT 0,
    odue INTEGER DEFAULT 0,
    odid INTEGER DEFAULT 0,
    flags INTEGER DEFAULT 0,
    data TEXT DEFAULT ''
  )`)

  db.run(`CREATE TABLE col (
    id INTEGER PRIMARY KEY,
    crt INTEGER,
    mod INTEGER,
    scm INTEGER,
    ver INTEGER DEFAULT 11,
    dty INTEGER DEFAULT 0,
    usn INTEGER DEFAULT 0,
    ls INTEGER DEFAULT 0,
    conf TEXT,
    models TEXT,
    decks TEXT,
    dconf TEXT,
    tags TEXT DEFAULT '{}'
  )`)

  db.run(`CREATE TABLE graves (usn INTEGER, oid INTEGER, type INTEGER)`)
  db.run(`CREATE TABLE revlog (id INTEGER PRIMARY KEY, cid INTEGER, usn INTEGER, ease INTEGER, ivl INTEGER, lastIvl INTEGER, factor INTEGER, time INTEGER, type INTEGER)`)

  const now = Math.floor(Date.now() / 1000)
  const modelId = Date.now()
  const deckId = Date.now() + 1

  const model = {
    [modelId]: {
      id: String(modelId),
      name: 'Jeo Trainer',
      type: 0,
      mod: now,
      usn: -1,
      sortf: 0,
      did: deckId,
      tmpls: [{
        name: 'Card 1',
        ord: 0,
        qfmt: '{{Front}}',
        afmt: '{{FrontSide}}<hr id=answer>{{Back}}',
        did: null,
        bqfmt: '',
        bafmt: '',
      }],
      flds: [
        { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
        { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
      ],
      css: '.card { font-family: Arial; font-size: 20px; }',
      latexPre: '',
      latexPost: '',
      tags: [],
      vers: [],
    }
  }

  const deck = {
    [deckId]: {
      id: deckId,
      name: 'Jeo Trainer',
      desc: 'Exported from Jeo Trainer',
      mod: now,
      usn: -1,
      collapsed: false,
      newToday: [0, 0],
      timeToday: [0, 0],
      revToday: [0, 0],
      lrnToday: [0, 0],
      browserCollapsed: false,
      extendNew: 10,
      extendRev: 50,
      conf: 1,
      dyn: 0,
    }
  }

  db.run(`INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')`,
    [now, now, now, JSON.stringify(model), JSON.stringify(deck)])

  // Insert notes and cards
  cards.forEach((card, i) => {
    const noteId = now * 1000 + i
    const cardId = now * 1000 + i + 500000
    const flds = `${card.front}\x1f${card.back}`
    const tags = card.category ? card.category.replace(/[,·]/g, ' ').trim() : ''

    // Map our SRS state to Anki intervals
    const ivl = card.interval || 0
    const factor = Math.round((card.easeFactor || 2.5) * 1000)
    const reps = card.repetitions || 0
    const dueDay = ivl > 0 ? Math.round(ivl) : 0
    const queue = ivl > 0 ? 2 : 0 // 2=review, 0=new

    db.run(`INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, 0, 0, '')`,
      [noteId, `jt-${card.id}`, modelId, now, tags, flds, card.front])

    db.run(`INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, '')`,
      [cardId, noteId, deckId, now, queue > 0 ? 2 : 0, queue, dueDay, ivl, factor, reps])
  })

  const dbData = db.export()
  db.close()

  // Build .apkg (zip with collection.anki2 + media)
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('collection.anki2', dbData)
  zip.file('media', '{}')

  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'jeo-trainer-deck.apkg'
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Daily Double wagering ────────────────────────────────────────────────────
// Coryat deliberately ignores Daily Doubles, so this is the one part of board play
// the score can't tell you anything about. Games from v2.5.8 carry a per-wager log;
// older games only have ddNet, derived from the score identity, so counts and rates
// are computed from the logged subset while the net uses everything available.
export function buildDailyDoubleStats(gameHistory) {
  let net = 0, gamesWithNet = 0
  let hits = 0, misses = 0, passes = 0
  let wagerTotal = 0, wagerCount = 0, biggestWin = 0, biggestLoss = 0
  let trueDDs = 0 // wagered the whole score or more

  for (const g of gameHistory) {
    if (typeof g.ddNet === 'number') { net += g.ddNet; gamesWithNet++ }

    if (!Array.isArray(g.dailyDoubles)) continue
    for (const d of g.dailyDoubles) {
      const w = d.wager || 0
      if (d.result === 'correct') { hits++; biggestWin = Math.max(biggestWin, w) }
      else if (d.result === 'incorrect') { misses++; biggestLoss = Math.max(biggestLoss, w) }
      else passes++
      if (d.wagered) { wagerTotal += w; wagerCount++ }
      if (d.wagered && w >= (d.value || 0) * 5) trueDDs++
    }
  }

  const attempted = hits + misses
  return {
    net,
    gamesWithNet,
    netPerGame: gamesWithNet ? Math.round(net / gamesWithNet) : null,
    // Null rather than 0 when nothing is logged yet — "no data" and "0%" are
    // different claims, and per-wager logging only began in v2.5.8.
    hitRate: attempted ? Math.round((hits / attempted) * 100) : null,
    hits, misses, passes,
    logged: hits + misses + passes,
    avgWager: wagerCount ? Math.round(wagerTotal / wagerCount) : null,
    biggestWin, biggestLoss, trueDDs,
  }
}

// ─── Retention ────────────────────────────────────────────────────────────────
// Retention counts only cards that were already learned (repetitions > 0 at review
// time). A first-ever encounter being wrong says nothing about how well the schedule
// is holding — including those would drag the number down and hide the real trend.
export function buildRetentionSeries(log, { bucketDays = 7, buckets = 8 } = {}) {
  const DAY = 86400000
  const now = Date.now()
  const out = []

  for (let i = buckets - 1; i >= 0; i--) {
    const end = now - i * bucketDays * DAY
    const start = end - bucketDays * DAY
    const inRange = log.filter(e => e.l && e.t > start && e.t <= end)
    const passed = inRange.filter(e => e.q > 0).length
    out.push({
      // Weeks back from now, so the axis reads right-to-left as recency.
      label: i === 0 ? 'now' : `-${i * bucketDays}d`,
      n: inRange.length,
      retention: inRange.length ? Math.round((passed / inRange.length) * 100) : null,
    })
  }
  return out
}

// A snapshot of deck health from card state alone, available immediately rather than
// waiting for the log to fill. Mature = an interval long enough that remembering it
// actually means something.
export function buildDeckHealth(cards, { matureDays = 21 } = {}) {
  let mature = 0, learned = 0, lapsed = 0, easeSum = 0, easeCount = 0, leeches = 0
  for (const c of cards) {
    if ((c.repetitions || 0) > 0) learned++
    if ((c.interval || 0) >= matureDays) mature++
    if ((c.lapses || 0) > 0) lapsed++
    if ((c.lapses || 0) >= 4) leeches++
    if (c.easeFactor) { easeSum += c.easeFactor; easeCount++ }
  }
  return {
    total: cards.length,
    learned,
    mature,
    lapsed,
    leeches,
    maturePct: cards.length ? Math.round((mature / cards.length) * 100) : 0,
    avgEase: easeCount ? +(easeSum / easeCount).toFixed(2) : null,
  }
}

// ─── Study streak ─────────────────────────────────────────────────────────────
// calcStreak in training.jsx counts days you played a *game*. This counts days you
// *studied*, which is the habit the daily goal is trying to build. Derived from the
// review log, so it starts from when that log began rather than claiming false history.
export function buildStudyStreak(log = [], { now = Date.now() } = {}) {
  const DAY = 86400000
  const dayKey = t => {
    const d = new Date(t)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const days = [...new Set(log.map(e => dayKey(e.t)))].sort().reverse()
  if (!days.length) return { current: 0, longest: 0, studiedToday: false, totalDays: 0 }

  const today = dayKey(now)
  const yesterday = dayKey(now - DAY)
  const studiedToday = days[0] === today

  // A streak survives until you miss a whole day: if you studied yesterday but not yet
  // today, the streak still stands — it only breaks once yesterday is also missed.
  let current = 0
  if (days[0] === today || days[0] === yesterday) {
    current = 1
    for (let i = 1; i < days.length; i++) {
      const gap = (Date.parse(days[i - 1]) - Date.parse(days[i])) / DAY
      if (gap <= 1.5) current++
      else break
    }
  }

  let longest = 1, run = 1
  for (let i = 1; i < days.length; i++) {
    const gap = (Date.parse(days[i - 1]) - Date.parse(days[i])) / DAY
    if (gap <= 1.5) { run++; longest = Math.max(longest, run) } else run = 1
  }

  return { current, longest: Math.max(longest, current), studiedToday, totalDays: days.length }
}
