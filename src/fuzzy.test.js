import { describe, it, expect } from 'vitest'
import { matchesAnswer, answerCandidates, fuzzyMatch, normalize } from './fuzzy.js'

describe('fuzzyMatch (behaviour inherited from the drills)', () => {
  it('accepts an exact match and forgives punctuation and case', () => {
    expect(fuzzyMatch('cleopatra', 'Cleopatra')).toBe(true)
    expect(fuzzyMatch("O'Brien", 'OBrien')).toBe(true)
    expect(fuzzyMatch('F. Scott Fitzgerald', 'F Scott Fitzgerald')).toBe(true)
  })

  it('accepts a surname alone', () => {
    expect(fuzzyMatch('Fitzgerald', 'F Scott Fitzgerald')).toBe(true)
  })

  it('forgives a small typo but not a different word', () => {
    expect(fuzzyMatch('Cleopatrra', 'Cleopatra')).toBe(true)
    expect(fuzzyMatch('Napoleon', 'Cleopatra')).toBe(false)
  })

  it('rejects a trivially short guess', () => {
    expect(fuzzyMatch('a', 'Cleopatra')).toBe(false)
    expect(fuzzyMatch('', 'Cleopatra')).toBe(false)
  })
})

describe('answerCandidates', () => {
  it('strips Anki markup', () => {
    expect(answerCandidates('<b>Cleopatra</b><br>')).toContain('Cleopatra')
  })

  it('strips the Jeopardy response phrasing', () => {
    expect(answerCandidates('Who is Cleopatra?')).toContain('Cleopatra')
  })

  it('offers parenthetical and slashed alternatives', () => {
    const c = answerCandidates('Mark Twain (Samuel Clemens)')
    expect(c.some(x => /Samuel Clemens/.test(x))).toBe(true)
    const d = answerCandidates('Holland / the Netherlands')
    expect(d).toContain('Holland')
  })
})

describe('matchesAnswer', () => {
  it('accepts the bare answer whether or not it is phrased as a question', () => {
    expect(matchesAnswer('Cleopatra', 'Who is Cleopatra?')).toBe(true)
    expect(matchesAnswer('Who is Cleopatra?', 'Who is Cleopatra?')).toBe(true)
    expect(matchesAnswer('who is cleopatra', 'Cleopatra')).toBe(true)
  })

  it('accepts an alternative form', () => {
    expect(matchesAnswer('Samuel Clemens', 'Mark Twain (Samuel Clemens)')).toBe(true)
    expect(matchesAnswer('the Netherlands', 'Holland / the Netherlands')).toBe(true)
  })

  it('handles an HTML Anki back', () => {
    expect(matchesAnswer('mitochondria', '<div><b>Mitochondria</b></div>')).toBe(true)
  })

  it('rejects a wrong answer and an empty one', () => {
    expect(matchesAnswer('Napoleon', 'Who is Cleopatra?')).toBe(false)
    expect(matchesAnswer('', 'Cleopatra')).toBe(false)
    expect(matchesAnswer('   ', 'Cleopatra')).toBe(false)
  })

  it('survives a missing or empty back', () => {
    expect(matchesAnswer('anything', undefined)).toBe(false)
    expect(matchesAnswer('anything', '')).toBe(false)
  })

  it('does not let the question phrasing alone count as correct', () => {
    // "What is" must not fuzzy-match its way to a pass on a short answer.
    expect(matchesAnswer('what is', 'What is Ohio?')).toBe(false)
  })
})

describe('normalize', () => {
  it('collapses whitespace and case', () => {
    expect(normalize('  The   Great  Gatsby ')).toBe('the great gatsby')
  })
  it('survives nullish input', () => {
    expect(normalize(undefined)).toBe('')
  })
})
