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
        const seasonMatches = [...seasonsHtml.matchAll(/showseason\.php\?season=(\d+)/g)]
        const maxSeason = seasonMatches.reduce((max, m) => Math.max(max, parseInt(m[1])), 0)
        if (maxSeason > 0) {
          const epRes = await fetch(`https://j-archive.com/showseason.php?season=${maxSeason}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
          })
          const epHtml = await epRes.text()
          const gameIds = [...epHtml.matchAll(/game_id=(\d+)/g)].map(m => parseInt(m[1]))
          const maxId = gameIds.length > 0 ? Math.max(...gameIds) : 0
          if (maxId > 0) {
            // Probe forward from the season's max to find the true latest
            // (season page may be truncated by server, missing newest episodes)
            let probeId = maxId
            for (let i = 1; i <= 20; i++) {
              try {
                const probeRes = await fetch(`https://j-archive.com/showgame.php?game_id=${maxId + i}`, {
                  method: 'HEAD',
                  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
                })
                if (probeRes.ok) probeId = maxId + i
                else break
              } catch { break }
            }
            episodeId = String(probeId)
          } else {
            episodeId = '9466'
          }
        } else {
          episodeId = '9466'
        }
      } catch {
        episodeId = '9466'
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
          hasDoubleJeopardyRound: !!doc.querySelector('#double_jeopardy_round'),
          doubleJeopardyCategories: (() => {
            const djEl = doc.querySelector('#double_jeopardy_round')
            if (!djEl) return 'DJ element not found'
            const cats = djEl.querySelectorAll('.category_name').map(el => el.text.trim())
            return cats
          })(),
          contestantHtml: (() => {
            // Find score-related HTML
            const scoreIdx = html.toLowerCase().indexOf('score')
            const contestantIdx = html.toLowerCase().indexOf('contestant')
            return {
              scoreContext: scoreIdx >= 0 ? html.slice(Math.max(0, scoreIdx - 50), scoreIdx + 300) : 'not found',
              contestantContext: contestantIdx >= 0 ? html.slice(Math.max(0, contestantIdx - 50), contestantIdx + 300) : 'not found',
              finalScoresSection: (() => {
                const idx = html.indexOf('final_scores')
                return idx >= 0 ? html.slice(idx - 100, idx + 500) : 'final_scores not found'
              })(),
            }
          })(),
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
      let roundEl = doc.querySelector(`#${roundId}`)

      // Fallback: extract section from raw HTML and re-parse if querySelector fails
      if (!roundEl) {
        const startMarker = 'id="' + roundId + '"'
        const startIdx = html.indexOf(startMarker)
        if (startIdx >= 0) {
          const nextRoundId = roundId === 'jeopardy_round' ? 'double_jeopardy_round' : 'final_jeopardy_round'
          const endMarker = 'id="' + nextRoundId + '"'
          const endIdx = html.indexOf(endMarker, startIdx)
          const section = endIdx > startIdx
            ? html.slice(startIdx - 5, endIdx)
            : html.slice(startIdx - 5, startIdx + 60000)
          roundEl = parse('<div ' + section + '</div>').querySelector('#' + roundId)
        }
      }

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
    // J-archive stores final scores in a table with class "score_td"
    // Format: <td class="score_td">$12,345</td> adjacent to contestant name
    let contestants = []
    try {
      // Try: final scores table at bottom of page
      // j-archive uses a scores section with player names and final scores
      const finalScoreSection = doc.querySelector('#final_jeopardy_round')
      if (finalScoreSection) {
        // Look for score rows: each contestant has a <td class="right"> with score
        const rightTds = finalScoreSection.querySelectorAll('td.right')
        const wrongTds = finalScoreSection.querySelectorAll('td.wrong')
        const allScoreTds = [...rightTds, ...wrongTds]
        allScoreTds.forEach(td => {
          const scoreText = td.text?.trim()
          const score = parseInt((scoreText || '0').replace(/[$,]/g, ''))
          if (!isNaN(score) && score > 0) {
            // Try to get contestant name from nearby context
            contestants.push({ name: `Player`, score })
          }
        })
      }

      // Better approach: parse the scores from the HTML directly
      // j-archive has a section like: <td class="score_td">$15,200</td>
      if (contestants.length === 0) {
        const scoreTds = doc.querySelectorAll('.score_td')
        scoreTds.forEach(td => {
          const score = parseInt((td.text?.trim() || '').replace(/[$,]/g, ''))
          if (!isNaN(score) && score >= 0) contestants.push({ score })
        })
      }

      // Try regex on raw HTML as fallback
      // j-archive final scores appear as: "Matt $15,200" in a score table
      if (contestants.length === 0) {
        // Find the scores table HTML
        const scoresIdx = html.indexOf('class="score_td"')
        if (scoresIdx >= 0) {
          const scoresSection = html.slice(Math.max(0, scoresIdx - 2000), scoresIdx + 2000)
          const scoreMatches = [...scoresSection.matchAll(/class="score_td"[^>]*>\$?([\d,]+)/g)]
          scoreMatches.forEach((m, i) => {
            const score = parseInt(m[1].replace(/,/g, ''))
            if (!isNaN(score)) contestants.push({ name: `Contestant ${i + 1}`, score })
          })
        }
      }

      // Name extraction: look for contestant names near scores
      // j-archive format: contestant names appear in .contestant_name or similar
      const nameTds = doc.querySelectorAll('.contestant_name, .player_nick')
      if (nameTds.length > 0 && contestants.length > 0) {
        nameTds.forEach((td, i) => {
          if (contestants[i]) contestants[i].name = td.text?.trim() || contestants[i].name
        })
      }

      // Filter to valid scores only (remove 0s which are parsing artifacts)
      contestants = contestants.filter(c => c.score > 0)
    } catch {}

    if (!singleJeopardy || singleJeopardy.categories.length === 0) {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({
          error: `Episode ${episodeId} not yet available or could not be parsed.`,
          titleFound: titleText,
          hint: titleText ? 'Page found but clues could not be extracted — episode may not be archived yet.' : 'Episode not found — try a different episode ID.',
          episodeId,
        })
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
