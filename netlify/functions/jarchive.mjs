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
      const homeRes = await fetch('https://j-archive.com/', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
      })
      const homeHtml = await homeRes.text()
      const homeDoc = parse(homeHtml)

      // Find highest game_id across all showgame links
      let maxId = 0
      for (const link of homeDoc.querySelectorAll('a[href*="showgame"]')) {
        const match = (link.getAttribute('href') || '').match(/game_id=(\d+)/)
        if (match && parseInt(match[1]) > maxId) maxId = parseInt(match[1])
      }
      episodeId = maxId > 0 ? String(maxId) : '8000'
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
          let isDailyDouble = false
          const parentTd = clueTextEl?.parentNode
          const tdClass = (parentTd?.getAttribute('class') || '') + (parentTd?.parentNode?.getAttribute('class') || '')
          if (tdClass.includes('daily_double')) isDailyDouble = true
          if ((parentTd?.getAttribute('onmouseover') || '').toLowerCase().includes('daily double')) isDailyDouble = true

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
      body: JSON.stringify({ episodeId, episodeNumber, airDate, url, singleJeopardy, doubleJeopardy, finalJeopardy })
    }

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message, stack: err.stack?.slice(0, 500) })
    }
  }
}
