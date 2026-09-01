import { describe, it, expect } from 'vitest'
import { getMetaCategory } from './analytics.js'

describe('getMetaCategory — substring false positives', () => {
  // Each of these was misfiled by plain substring matching, which quietly skewed the
  // heat map and the "what should I study" recommendations built on top of it.
  it('does not read "war" inside a name', () => {
    expect(getMetaCategory('ANDY WARHOL')).not.toBe('History')
    expect(getMetaCategory('HOWARD THE DUCK')).not.toBe('History')
    expect(getMetaCategory('EDWARD SCISSORHANDS')).not.toBe('History')
  })

  it('does not read "uk" inside DUKE', () => {
    expect(getMetaCategory('DUKE ELLINGTON')).not.toBe('Geography')
  })

  it('does not read "pop" inside POPULATION', () => {
    expect(getMetaCategory('POPULATION DENSITY')).not.toBe('Arts & Entertainment')
  })
})

describe('getMetaCategory — genuine matches still work', () => {
  it('matches whole words', () => {
    expect(getMetaCategory('WORLD CAPITALS')).toBe('Geography')
    expect(getMetaCategory('THE CIVIL WAR')).toBe('History')
    expect(getMetaCategory('US PRESIDENTS')).toBe('History')
    expect(getMetaCategory('HOLLYWOOD DIRECTORS')).toBe('Arts & Entertainment')
    expect(getMetaCategory('OLYMPIC SPORTS')).toBe('Sports & Games')
  })

  it('tolerates plurals in either direction', () => {
    expect(getMetaCategory('THE NOVEL')).toBe('Literature')
    expect(getMetaCategory('NOVELS')).toBe('Literature')
    expect(getMetaCategory('WORLD WARS')).toBe('History')
  })

  it('falls back to Potpourri when nothing matches', () => {
    expect(getMetaCategory('ZZZZZ QQQQQ')).toBe('Potpourri')
    expect(getMetaCategory('')).toBe('Potpourri')
    expect(getMetaCategory(undefined)).toBe('Potpourri')
  })

  it('picks the best match rather than whichever is declared first', () => {
    // Two Sports keywords ("olympic", "swimming") beat the single Arts hit ("tv").
    expect(getMetaCategory('OLYMPIC SWIMMING ON TV')).toBe('Sports & Games')
  })
})
