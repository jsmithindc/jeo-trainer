import { parse } from 'node-html-parser'

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }

  const debug = event.queryStringParameters?.debug === '1'

  try {
    let episodeId = event.queryStringParameters?.episode || 'latest'

    // ── Find latest episode ID ────────────────────────────────────────────────
    if (episodeId === 'latest') {
      try {
        // Fetch the latest season page and find the highest game_id
        const seasonsRes = await fetch('https://j-archive.com/listseasons.php', {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
        })
        const seasonsHtml = await seasonsRes.text()
        // Find highest season number
        const seasonMatches = [...seasonsHtml.matchAll(/showseason\.php\?season=(\d+)/g)]
        const maxSeason = seasonMatches.reduce((max, m) => Math.max(max, parseInt(m[1])), 0)
        if (maxSeason > 0) {
          const epRes = await fetch(`https://j-archive.com/showseason.php?season=${maxSeason}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
          })
          const epHtml = await epRes.text()
          const gameIds = [...epHtml.matchAll(/game_id=(\d+)/g)].map(m => parseInt(m[1]))
          const maxId = gameIds.length > 0 ? Math.max(...gameIds) : 0
          episodeId = maxId > 0 ? String(maxId) : '9200'
        } else {
          episodeId = '9200'
        }
      } catch {
        episodeId = '9200' // fallback to a known recent episode
      }
    }

    // ── Fetch episode page ────────────────────────────────────────────────────
    const url = `https://j-archive.com/showgame.php?game_id=${episodeId}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://j-archive.com/',
      }
    })

    if (!res.ok) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: `Episode ${episodeId} not found (HTTP ${res.status})` }) }
    }

    const html = await res.text()
    const doc = parse(html)

    // ── Debug mode ────────────────────────────────────────────────────────────
    if (debug) {
      const titleEl = doc.querySelector('#game_title h1')
      const clueEl = doc.querySelector('#clue_J_1_1')
      const responseEl = doc.querySelector('#clue_J_1_1_r')
      const tdsWithMouseover = doc.querySelectorAll('td[onmouseover]')

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          debug: true,
          episodeId,
          pageLength: html.length,
          title: titleEl?.text?.trim(),
          hasJeopardyRound: !!doc.querySelector('#jeopardy_round'),
          clueJ11Text: clueEl?.text?.trim(),
          clueJ11ParentClass: clueEl?.parentNode?.getAttribute('class'),
          responseJ11Html: responseEl?.toString()?.slice(0, 400),
          responseJ11Text: responseEl?.querySelector('.correct_response')?.text?.trim(),
          firstTdOnmouseover: tdsWithMouseover[0]?.getAttribute('onmouseover')?.slice(0, 400),
          rawAroundClue: html.includes('clue_J_1_1')
            ? html.slice(html.indexOf('clue_J_1_1') - 100, html.indexOf('clue_J_1_1') + 800)
            : 'NOT FOUND',
          ddClassSearch: (() => {
            const idx = html.indexOf('clue_value_daily_double')
            const idx2 = html.indexOf('daily_double')
            return {
              clue_value_daily_double: idx >= 0 ? html.slice(Math.max(0,idx-200), idx+400) : 'NOT FOUND',
              daily_double_class: idx2 >= 0 ? html.slice(Math.max(0,idx2-100), idx2+300) : 'NOT FOUND',
            }
          })(),
          ddSearch: (() => {
            // Find any Daily Double references in the HTML
            const ddIdx = html.toLowerCase().indexOf('daily_double')
            const ddIdx2 = html.toLowerCase().indexOf('daily double')
            return {
              hasDailyDoubleClass: ddIdx >= 0,
              hasDailyDoubleText: ddIdx2 >= 0,
              ddClassContext: ddIdx >= 0 ? html.slice(Math.max(0, ddIdx - 100), ddIdx + 200) : 'not found',
              ddTextContext: ddIdx2 >= 0 ? html.slice(Math.max(0, ddIdx2 - 100), ddIdx2 + 200) : 'not found',
            }
          })(),
        })
      }
    }

    // ── Episode metadata ──────────────────────────────────────────────────────
    const titleText = doc.querySelector('#game_title h1')?.text?.trim() || ''
    const showMatch = titleText.match(/Show #(\d+)/)
    const dateMatch = titleText.match(/[-–]\s*(.+)$/)
    const episodeNumber = showMatch ? showMatch[1] : episodeId
    const airDate = dateMatch ? dateMatch[1].trim() : ''

    // ── Parse a round ─────────────────────────────────────────────────────────
    function parseRound(roundId) {
      const roundEl = doc.querySelector(`#${roundId}`)
      if (!roundEl) return null

      const categoryNames = roundEl.querySelectorAll('.category_name').map(el => el.text.trim())
      if (categoryNames.length === 0) return null

      const prefix = roundId === 'jeopardy_round' ? 'J' : 'DJ'
      const baseValue = roundId === 'jeopardy_round' ? 200 : 400

      const categories = categoryNames.map((name, colIdx) => {
        const clues = []
        for (let row = 1; row <= 5; row++) {
          const clueId = `clue_${prefix}_${colIdx + 1}_${row}`

          const clueTextEl = doc.querySelector(`#${clueId}`)
          const answerText = clueTextEl?.text?.trim() || '(unavailable)'

          // Correct response lives in a hidden div: #clue_J_1_1_r .correct_response
          const responseEl = doc.querySelector(`#${clueId}_r`)
          let question = '(unavailable)'
          if (responseEl) {
            const crEl = responseEl.querySelector('.correct_response')
            if (crEl) question = crEl.text.trim()
          }

          // Daily double detection
          // Structure: clue_text td → tr → inner table → td (outer) → tr → outer table
          // The DD class "clue_value_daily_double" is in the clue_header table
          // which is a sibling row in the same inner table as the clue text
          let isDailyDouble = false
          if (clueTextEl) {
            // Walk up to the inner <table> that wraps both the header and clue text rows
            let node = clueTextEl.parentNode // <td>
            if (node) node = node.parentNode  // <tr>
            if (node) node = node.parentNode  // <table> (inner)
            if (node) {
              const tableHtml = node.toString() || ''
              isDailyDouble = tableHtml.includes('clue_value_daily_double')
            }
          }

          clues.push({ value: baseValue * row, answer: answerText, question, isDailyDouble })
        }
        return { name, clues }
      })

      return { categories }
    }

    const singleJeopardy = parseRound('jeopardy_round')
    const doubleJeopardy = parseRound('double_jeopardy_round')

    // ── Final Jeopardy ────────────────────────────────────────────────────────
    let finalJeopardy = null
    const fjEl = doc.querySelector('#final_jeopardy_round')
    if (fjEl) {
      finalJeopardy = {
        category: fjEl.querySelector('.category_name')?.text?.trim() || 'FINAL JEOPARDY',
        clue: fjEl.querySelector('.clue_text')?.text?.trim() || '',
        answer: fjEl.querySelector('[id$="_r"] .correct_response')?.text?.trim() || '',
      }
    }

    // ── Contestant scores ─────────────────────────────────────────────────────
    let contestants = []
    try {
      const playerDivs = doc.querySelectorAll('.contestants .contestant')
      if (playerDivs.length === 0) {
        // Try alternate selector
        const scoreRows = doc.querySelectorAll('#final_jeopardy_round .score_td, .final_scores td')
        // Parse scores from the scores table
        const scoreTable = doc.querySelector('#score_table, .final_round')
        if (scoreTable) {
          const cells = scoreTable.querySelectorAll('td')
          let i = 0
          while (i < cells.length - 1) {
            const name = cells[i]?.text?.trim()
            const score = cells[i+1]?.text?.trim()?.replace(/[$,]/g, '')
            if (name && score && !isNaN(parseInt(score))) {
              contestants.push({ name, score: parseInt(score) })
            }
            i += 2
          }
        }
      } else {
        playerDivs.forEach(div => {
          const name = div.querySelector('.contestant_name')?.text?.trim() ||
                       div.querySelector('a')?.text?.trim() || ''
          const scoreEl = div.querySelector('.score')
          const score = parseInt((scoreEl?.text?.trim() || '0').replace(/[$,]/g, '')) || 0
          if (name) contestants.push({ name, score })
        })
      }
      // Also try parsing from the final scores section
      if (contestants.length === 0) {
        const finalScoresHtml = html.match(/final scores[^<]*<[^>]+>([\s\S]{0,500})/i)?.[1] || ''
        const scoreMatches = [...finalScoresHtml.matchAll(/\$([\d,]+)/g)]
        const nameMatches = [...finalScoresHtml.matchAll(/([A-Z][a-z]+ [A-Z][a-z]+)/g)]
        nameMatches.forEach((m, i) => {
          if (scoreMatches[i]) {
            contestants.push({ name: m[1], score: parseInt(scoreMatches[i][1].replace(/,/g, '')) })
          }
        })
      }
    } catch {}

    if (!singleJeopardy || singleJeopardy.categories.length === 0) {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({ error: `Could not parse episode ${episodeId}. Add ?debug=1 to diagnose.`, titleFound: titleText })
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ episodeId, episodeNumber, airDate, url, singleJeopardy, doubleJeopardy, finalJeopardy, contestants })
    }

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message, stack: err.stack?.slice(0, 500) })
    }
  }
}
