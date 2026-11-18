import { HEADER } from './check-commit-message.ts'

export interface ConventionalCommit {
  readonly type: string
  readonly scope: string | null
  readonly breaking: boolean
  readonly summary: string
  readonly firstParagraph: string
  readonly breakingNote: string
}

/** Reads a commit message, or returns null for one that is not a Conventional Commit: a merge, a revert, the release commit. */
export const parseCommit = (message: string): ConventionalCommit | null => {
  const lines = message
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .map((line) => line.trimEnd())
  const parts = HEADER.exec(lines[0] ?? '')
  if (parts === null) return null
  const paragraphs = paragraphsOf(lines.slice(1))
  const breakingNote = breakingFooter(paragraphs)
  const body = paragraphs.filter((paragraph) => !isTrailerBlock(paragraph))
  return {
    type: parts.groups!.type!,
    scope: parts.groups!.scope ?? null,
    breaking: parts.groups!.breaking === '!' || breakingNote !== '',
    summary: parts.groups!.summary!,
    firstParagraph: oneLine(body[0] ?? []),
    breakingNote,
  }
}

const BREAKING = /^BREAKING[ -]CHANGE: /
const TRAILER =
  /^(?:Co-authored-by|Signed-off-by|Reviewed-by|Acked-by|Claude-Session|Refs|Fixes|BREAKING CHANGE|BREAKING-CHANGE): \S/i

const paragraphsOf = (lines: ReadonlyArray<string>): string[][] => {
  const paragraphs: string[][] = []
  let current: string[] = []
  for (const line of lines) {
    if (line.trim() !== '') current.push(line)
    else if (current.length > 0) {
      paragraphs.push(current)
      current = []
    }
  }
  if (current.length > 0) paragraphs.push(current)
  return paragraphs
}

const breakingFooter = (paragraphs: ReadonlyArray<ReadonlyArray<string>>): string => {
  const paragraph = paragraphs.find((lines) => lines.some((line) => BREAKING.test(line))) ?? []
  const start = paragraph.findIndex((line) => BREAKING.test(line))
  if (start < 0) return ''
  const rest = paragraph.slice(start + 1)
  const end = rest.findIndex((line) => TRAILER.test(line))
  return oneLine([paragraph[start]!.replace(BREAKING, ''), ...(end < 0 ? rest : rest.slice(0, end))])
}

const isTrailerBlock = (paragraph: ReadonlyArray<string>): boolean => TRAILER.test(paragraph[0] ?? '')

const oneLine = (lines: ReadonlyArray<string>): string =>
  lines
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ')
