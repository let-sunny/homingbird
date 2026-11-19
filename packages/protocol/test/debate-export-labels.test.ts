import { describe, expect, it } from 'vitest'
import { exportLabelsIn } from '../src/debate-export-labels.ts'
import { LOCALES } from '../src/model.ts'

describe('export labels', () => {
  it('falls back to English when the person chose no language', () => {
    expect(exportLabelsIn(null)).toBe(exportLabelsIn('en'))
    expect(exportLabelsIn('ko').title('Q')).toBe('토론방: Q')
  })

  it('words every ending, status, category and credit in each language, and differently from English', () => {
    const english = exportLabelsIn('en')
    for (const locale of LOCALES) {
      const labels = exportLabelsIn(locale)
      for (const group of ['endings', 'statuses', 'categories', 'credits', 'visibilities'] as const)
        expect(Object.keys(labels[group]).sort()).toEqual(Object.keys(english[group]).sort())
      expect(labels.step(null, 'Ana')).toContain('Ana')
      expect(labels.step('Ben', 'Ana')).toContain('Ben')
      expect(labels.limits({ perAgent: 1, total: 2, minutes: 3, characters: 400 })).toMatch(/1.*2.*3.*400/)
      expect(labels.votedFor('Ana', 'Ben')).toMatch(/Ana.*Ben/)
      expect(labels.droppedOutWithoutVote('Ana')).toContain('Ana')
      expect(labels.didNotVote('Ana')).toContain('Ana')
      expect(labels.turnHeading(2, 'Ana', 'Laptop', 'T')).toMatch(/^2\. .*Ana.*Laptop.*T$/)
      expect(labels.participantAgent('Ana', 'Laptop')).toMatch(/Ana.*Laptop/)
      expect(labels.created('T', 'Ana')).toMatch(/T.*Ana/)
      expect(labels.contribution('Ana')).toContain('Ana')
    }
    expect(exportLabelsIn('ko').endings.one_agent_left).not.toBe(english.endings.one_agent_left)
  })
})
