import { parse } from 'node-html-parser'

// J-Archive episode fetcher & parser
// Called by the app as: GET /.netlify/functions/jarchive?episode=8000
// Or for latest:        GET /.netlify/functions/jarchive?episode=latest

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }

  try {
    let episodeId = event.queryStringParameters?.episode || 'latest'

    // If latest, fetch the j-archive home page to find the most recent episode ID
    if (episodeId === 'latest') {
      const homeRes = await fetch('https://j-archive.com/listseasons.php', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JeoTrainer/1.0)' }
      })
      const homeHtml = await homeRes.text()
      const homeDoc = parse(homeHtml)
      // Most recent episode link is the first showgame link
      const firstLink = homeDoc.querySelector('a[href*="showgame"]')
      if (firstLink) {
        const match = firstLink.getAttribute('href').match(/game_id=(\d+)/)
        if (match) episodeId = match[1]
      }
      if (episodeId === 'latest') episodeId = '8000' // fallback
    }

    const url = `https://j-archive.com/showgame.php?game_id=${episodeId}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JeoTrainer/1.0)' }
    })

    if (!res.ok) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: `Episode ${episodeId} not found` }) }
    }

    const html = await res.text()
    const doc = parse(html)

    // ── Episode metadata ──────────────────────────────────────────────────────
    const titleEl = doc.querySelector('#game_title h1')
    const titleText = titleEl?.text?.trim() || ''

    // Title format: "Show #8000 - Wednesday, November 1, 2023"
    const showMatch = titleText.match(/Show #(\d+)/)
    const dateMatch = titleText.match(/- (.+)$/)
    const episodeNumber = showMatch ? showMatch[1] : episodeId
    const airDate = dateMatch ? dateMatch[1].trim() : ''

    const commentsEl = doc.querySelector('#game_comments')
    const comments = commentsEl?.text?.trim() || ''

    // ── Parse a round ─────────────────────────────────────────────────────────
    function parseRound(roundId) {
      const roundEl = doc.querySelector(`#${roundId}`)
      if (!roundEl) return null

      // Categories
      const categoryEls = roundEl.querySelectorAll('.category_name')
      const categoryNames = categoryEls.map(el => el.text.trim())

      // Clues — j-archive lays them out in a table: 5 rows × 6 cols
      // Each clue cell has id like "clue_J_1_1" (col_row) or "clue_DJ_1_1"
      const prefix = roundId === 'jeopardy_round' ? 'J' : 'DJ'
      const baseValue = roundId === 'jeopardy_round' ? 200 : 400

      const categories = categoryNames.map((name, colIdx) => {
        const clues = []
        for (let row = 1; row <= 5; row++) {
          const colNum = colIdx + 1
          const clueId = `clue_${prefix}_${colNum}_${row}`
          const clueEl = doc.querySelector(`#${clueId}`)

          // The answer text lives in the clue td
          const answerText = clueEl?.text?.trim() || ''

          // The correct response is in a sibling div with id like "clue_J_1_1_r"
          // It's hidden in a <em class="correct_response"> inside a onmouseover
          // J-archive stores it in the mouseover HTML of the clue cell's parent td
          const clueCell = doc.querySelector(`td#clue_${prefix}_${colNum}_${row}`)?.parentNode
          let question = ''
          let isDailyDouble = false

          if (clueCell) {
            const onmouseover = clueCell.getAttribute('onmouseover') || ''
            // Extract correct_response from the embedded HTML string
            const crMatch = onmouseover.match(/<em class=\\"correct_response\\">(.*?)<\/em>/)
            if (crMatch) {
              question = crMatch[1]
                .replace(/\\"/g, '"')
                .replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .trim()
            }
            // Check for daily double
            isDailyDouble = onmouseover.includes('Daily Double') ||
              (clueCell.getAttribute('onmouseout') || '').includes('Daily Double')
          }

          // Also check the clue cell class for daily double
          const clueCellClass = doc.querySelector(`#clue_${prefix}_${colNum}_${row}`)?.parentNode?.getAttribute('class') || ''
          if (clueCellClass.includes('daily_double')) isDailyDouble = true

          const value = baseValue * row

          clues.push({
            value,
            answer: answerText || `(clue unavailable)`,
            question: question ? `${question}` : '(response unavailable)',
            isDailyDouble,
          })
        }
        return { name, clues }
      })

      return { categories }
    }

    const singleJeopardy = parseRound('jeopardy_round')
    const doubleJeopardy = parseRound('double_jeopardy_round')

    // Final jeopardy
    let finalJeopardy = null
    const fjEl = doc.querySelector('#final_jeopardy_round')
    if (fjEl) {
      const fjCat = fjEl.querySelector('.category_name')?.text?.trim() || 'FINAL JEOPARDY'
      const fjClue = fjEl.querySelector('.clue_text')?.text?.trim() || ''
      const fjOnmouseover = fjEl.querySelector('td.clue')?.getAttribute('onmouseover') || ''
      const fjMatch = fjOnmouseover.match(/<em class=\\"correct_response\\">(.*?)<\/em>/)
      const fjAnswer = fjMatch
        ? fjMatch[1].replace(/\\"/g, '"').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim()
        : ''
      finalJeopardy = { category: fjCat, clue: fjClue, answer: fjAnswer }
    }

    if (!singleJeopardy || singleJeopardy.categories.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: `Could not parse episode ${episodeId}. It may not exist or j-archive may have changed its format.` })
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        episodeId,
        episodeNumber,
        airDate,
        comments,
        url,
        singleJeopardy,
        doubleJeopardy,
        finalJeopardy,
      })
    }

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    }
  }
}
