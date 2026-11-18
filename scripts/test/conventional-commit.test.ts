import { describe, expect, it } from 'vitest'
import { parseCommit } from '../conventional-commit.ts'

describe('reading a commit message', () => {
  it('takes the type, scope, summary and the first paragraph of the body as one line', () => {
    expect(
      parseCommit(
        'fix(dovecote): refuse drafts in an archived room\n\nThe archived room accepted drafts,\nso it still collected questions.\n\nA second paragraph.\n\nCo-Authored-By: Someone <someone@example.com>\n',
      ),
    ).toEqual({
      type: 'fix',
      scope: 'dovecote',
      breaking: false,
      summary: 'refuse drafts in an archived room',
      firstParagraph: 'The archived room accepted drafts, so it still collected questions.',
      breakingNote: '',
    })
  })

  it('marks a breaking change by its exclamation mark or its footer, and keeps the footer text', () => {
    expect(parseCommit('feat(protocol)!: require archivedAt\n\nClients need it.')).toMatchObject({
      breaking: true,
      breakingNote: '',
    })
    expect(
      parseCommit(
        'refactor: rename the event\n\nOne name everywhere.\n\nBREAKING CHANGE: clients must listen\n  for channel.changed.\nCo-Authored-By: Someone <someone@example.com>',
      ),
    ).toMatchObject({
      type: 'refactor',
      scope: null,
      breaking: true,
      firstParagraph: 'One name everywhere.',
      breakingNote: 'clients must listen for channel.changed.',
    })
    expect(parseCommit('fix: x\n\nBREAKING-CHANGE: also this spelling')).toMatchObject({
      breaking: true,
      breakingNote: 'also this spelling',
      firstParagraph: '',
    })
  })

  it('has no first paragraph when the body is only trailers, and ignores comment lines and CRLF', () => {
    expect(
      parseCommit('perf(pwa): render the list once\r\n# a comment\r\n\r\nSigned-off-by: A <a@example.com>'),
    ).toMatchObject({ type: 'perf', scope: 'pwa', firstParagraph: '' })
    expect(parseCommit('docs: say it\n\nNote: the tool sends nothing.')?.firstParagraph).toBe(
      'Note: the tool sends nothing.',
    )
  })

  it('reads nothing from a merge, a revert, the release commit or an empty message', () => {
    for (const message of [
      'Merge pull request #1 from let-sunny/release/main',
      'Version Packages',
      'Revert "fix: x"',
      'update stuff',
      '',
    ])
      expect(parseCommit(message)).toBeNull()
  })
})
