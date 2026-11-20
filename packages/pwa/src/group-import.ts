import { type AsRead, type MemberId, membershipChange } from '@homingbird/protocol'

/**
 * The email addresses in a file an administrator chose: the column named `email` when the first line
 * has one, otherwise the first value of each line. Lower case, each once, in the file's order. The
 * file is read in the browser and its addresses never leave it.
 */
export const emailsFromCsv = (text: string): string[] => {
  const rows = text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim() !== '')
    .map(cellsOf)
  const column = (rows[0] ?? []).findIndex((cell) => cell.trim().toLowerCase() === EMAIL_COLUMN)
  const values =
    column === -1 ? rows.map((cells) => cells[0]!) : rows.slice(1).map((cells) => cells[column] ?? '')
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => value !== ''))]
}

/** Who a list of addresses makes the group's members: whom it adds, whom it removes, and addresses nobody uses. */
export const importPreview = (
  emails: ReadonlyArray<string>,
  members: ReadonlyArray<AsRead.Member>,
  current: ReadonlyArray<MemberId>,
): ImportPreview => {
  const byEmail = new Map(
    members
      .filter((member) => member.status === 'active')
      .map((member) => [member.email.toLowerCase(), member.id]),
  )
  const memberIds = [...new Set(emails.flatMap((email) => byEmail.get(email.toLowerCase()) ?? []))]
  const change = membershipChange(current, memberIds)
  return {
    memberIds,
    added: change.added,
    removed: change.removed,
    unknown: emails.filter((email) => !byEmail.has(email.toLowerCase())),
  }
}

export interface ImportPreview {
  /** The group's members once the file is imported: exactly the people it names. */
  readonly memberIds: ReadonlyArray<MemberId>
  readonly added: ReadonlyArray<MemberId>
  readonly removed: ReadonlyArray<MemberId>
  readonly unknown: ReadonlyArray<string>
}

/** One line of comma-separated values, where a quoted value may hold commas and doubled quotes. */
const cellsOf = (line: string): string[] => {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!
    if (quoted && character === '"' && line[index + 1] === '"') {
      cell += '"'
      index++
    } else if (character === '"') quoted = !quoted
    else if (character === ',' && !quoted) {
      cells.push(cell)
      cell = ''
    } else cell += character
  }
  return [...cells, cell]
}

const EMAIL_COLUMN = 'email'
