import { describe, expect, it } from 'vitest'
import { HEADER, problemsWith } from '../check-commit-message.ts'

const WHY = '\n\nThe archived room accepted drafts, so a removed channel still collected questions.'

describe('a commit message', () => {
  it('passes with a type, an optional scope, a lower-case summary and a body that says why', () => {
    expect(problemsWith(`fix(dovecote): refuse drafts in an archived room${WHY}`)).toEqual([])
    expect(problemsWith(`docs: say how to release${WHY}`)).toEqual([])
    expect(
      problemsWith(
        `feat(protocol)!: require archivedAt on every conversation${WHY}\n\nBREAKING CHANGE: clients must send archivedAt.`,
      ),
    ).toEqual([])
  })

  it('accepts trailers after the body, and comment lines git adds, but not trailers alone', () => {
    expect(
      problemsWith(
        `chore(repo): pin changesets${WHY}\n\nCo-Authored-By: Someone <someone@example.com>\n# Please enter the commit message\n`,
      ),
    ).toEqual([])
    expect(
      problemsWith('chore(repo): pin changesets\n\nCo-Authored-By: Someone <someone@example.com>'),
    ).toEqual(['Add a body that says why the change was made.'])
    expect(problemsWith('test(mcp): cover skip_note\n\nNote: the tool sends nothing.')).toEqual([])
  })

  it('refuses an unknown type or scope, or a missing space after the colon', () => {
    for (const header of [
      'update: things',
      'fix(server): refuse it',
      'fix:refuse it',
      'Fix(dovecote): refuse it',
      'fix(): x',
    ])
      expect(problemsWith(`${header}${WHY}`)[0]).toMatch(
        /^The first line must read "<type>\(<scope>\): <summary>"/,
      )
  })

  it('refuses a summary that is too long, starts with a capital or ends with a period', () => {
    expect(problemsWith(`fix: ${'a'.repeat(73)}${WHY}`)).toEqual([
      'The summary has 73 characters; keep it to 72.',
    ])
    expect(problemsWith(`fix: ${'a'.repeat(72)}${WHY}`)).toEqual([])
    expect(problemsWith(`fix: Refuse it${WHY}`)).toEqual(['Start the summary with a lower-case letter.'])
    expect(problemsWith(`fix: refuse it.${WHY}`)).toEqual(['End the summary without a period.'])
  })

  it('wants an empty second line and a body', () => {
    expect(problemsWith('fix: refuse it\nbecause')).toEqual([
      'Leave the second line empty.',
      'Add a body that says why the change was made.',
    ])
    expect(problemsWith('fix: refuse it')).toEqual(['Add a body that says why the change was made.'])
  })

  it('leaves merge, revert and release-bot commits alone', () => {
    expect(problemsWith('Merge pull request #12 from let-sunny/channel')).toEqual([])
    expect(problemsWith('Version Packages')).toEqual([])
    expect(problemsWith('Revert "fix: refuse it"')).toEqual([])
    expect(problemsWith('')).toHaveLength(1)
  })

  it('reads the grammar from one regular expression', () => {
    expect(HEADER.source).toBe(
      '^(?<type>feat|fix|docs|test|refactor|perf|build|ci|chore)(?:\\((?<scope>kernel|protocol|dovecote|client|ui|pwa|cli|mcp|a2a|plugin|sprites|deploy|release|repo)\\))?(?<breaking>!)?: (?<summary>\\S.*)$',
    )
  })
})
