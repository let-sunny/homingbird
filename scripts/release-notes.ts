import type { ConventionalCommit } from './conventional-commit.ts'

/**
 * The release notes for some commits, oldest first: breaking changes, then what was added, fixed and
 * made faster. Commits for contributors only (chore, docs, test, ci, build, refactor) are left out.
 */
export const renderNotes = (commits: ReadonlyArray<ConventionalCommit>): string =>
  SECTIONS.map(({ heading, includes }) => {
    const entries = commits.filter(includes).map(entryFor)
    return entries.length === 0 ? '' : `### ${heading}\n\n${entries.join('\n')}`
  })
    .filter((section) => section !== '')
    .join('\n\n')

const SECTIONS: ReadonlyArray<{
  readonly heading: string
  readonly includes: (commit: ConventionalCommit) => boolean
}> = [
  { heading: 'Breaking changes', includes: (commit) => commit.breaking },
  { heading: 'Added', includes: (commit) => !commit.breaking && commit.type === 'feat' },
  { heading: 'Fixed', includes: (commit) => !commit.breaking && commit.type === 'fix' },
  { heading: 'Performance', includes: (commit) => !commit.breaking && commit.type === 'perf' },
]

const entryFor = (commit: ConventionalCommit): string =>
  [
    `- ${commit.scope === null ? '' : `**${commit.scope}:** `}${commit.summary}`,
    ...[commit.firstParagraph, commit.breaking ? commit.breakingNote : '']
      .filter((paragraph) => paragraph !== '')
      .map((paragraph) => `\n  ${paragraph}`),
  ].join('\n')
