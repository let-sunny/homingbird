import { describe, expect, it } from 'vitest'
import type { ConventionalCommit } from '../conventional-commit.ts'
import { renderNotes } from '../release-notes.ts'

const commit = (overrides: Partial<ConventionalCommit>): ConventionalCommit => ({
  type: 'fix',
  scope: null,
  breaking: false,
  summary: 'do a thing',
  firstParagraph: '',
  breakingNote: '',
  ...overrides,
})

describe('the release notes', () => {
  it('group breaking changes, additions, fixes and performance, in that order and oldest first', () => {
    expect(
      renderNotes([
        commit({ type: 'perf', summary: 'render once' }),
        commit({
          type: 'fix',
          scope: 'dovecote',
          summary: 'refuse an archived room',
          firstParagraph: 'Why.',
        }),
        commit({ type: 'feat', scope: 'pwa', summary: 'show the basis' }),
        commit({
          type: 'feat',
          scope: 'protocol',
          breaking: true,
          summary: 'require archivedAt',
          firstParagraph: 'Because.',
          breakingNote: 'Clients must send it.',
        }),
        commit({ type: 'fix', summary: 'keep the cursor' }),
      ]),
    ).toBe(
      [
        '### Breaking changes',
        '',
        '- **protocol:** require archivedAt',
        '',
        '  Because.',
        '',
        '  Clients must send it.',
        '',
        '### Added',
        '',
        '- **pwa:** show the basis',
        '',
        '### Fixed',
        '',
        '- **dovecote:** refuse an archived room',
        '',
        '  Why.',
        '- keep the cursor',
        '',
        '### Performance',
        '',
        '- render once',
      ].join('\n'),
    )
  })

  it('leave out what is only for contributors, unless it breaks something', () => {
    const forContributors = ['chore', 'docs', 'test', 'ci', 'build', 'refactor'].map((type) =>
      commit({ type }),
    )
    expect(renderNotes(forContributors)).toBe('')
    expect(renderNotes([commit({ type: 'build', breaking: true, summary: 'need Node 24' })])).toBe(
      '### Breaking changes\n\n- need Node 24',
    )
  })
})
