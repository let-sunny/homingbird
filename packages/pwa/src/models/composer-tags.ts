import type { AsRead, MemberId } from '@homingbird/protocol'
import { listOf, strings } from '../strings.ts'
import { type TagsToSend, tagsToSend } from '../tagging.ts'
import { type PeoplePickerModel, candidatesAmong, peoplePickerModel } from './people-picker.ts'
import { type ThreadInput, isOn, nameIn, noteIn, roomOf } from './thread-room.ts'

/**
 * Who a note written here asks, in a group message: the people tagged with @, a reply's author when it
 * tags nobody, or everyone. Null where nobody can be tagged: a direct message, a channel, a private
 * question, or while tagging is off.
 */
export const composerTagsModel = (input: ComposerTagsInput): ComposerTagsModel | null => {
  const room = roomOf(input)
  const sending = tagsToSend({
    room,
    authorId: input.me.member.id,
    chosen: input.chosen,
    answered: noteIn(input, input.replyTarget),
    taggingOn: isOn(input, 'tagging'),
  })
  if (room === undefined || sending === null) return null
  const picker = peoplePickerModel({
    id: TAG_PICKER_ID,
    candidates: candidatesAmong(
      input.directory.filter((entry) => room.participantIds.includes(entry.member.id)),
      new Set([input.me.member.id]),
    ),
    chosen: sending.tags,
    query: input.mention?.query ?? '',
    active: input.active,
    open: input.mention !== null,
    limit: null,
  })
  return { picker, notice: noticeOf(input, sending), hint: strings.hints.tagging }
}

/** The @ tag being typed just before the caret: the text after an @ that starts a word. */
export const mentionAt = (text: string, caret: number): Mention | null => {
  const found = MENTION.exec(text.slice(0, caret))
  return found === null ? null : { start: caret - found[1]!.length - 1, query: found[1]! }
}

/** The text with the mention typed replaced by the chosen name, and the caret just after it. */
export const withMentionChosen = (
  text: string,
  mention: Mention,
  name: string,
): { readonly text: string; readonly caret: number } => {
  const before = text.slice(0, mention.start)
  const after = text.slice(mention.start + 1 + mention.query.length).replace(/^ /, '')
  const inserted = `@${name} `
  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length }
}

/** "Asks Ben and Cy", for a note or a draft that tags people; null for one that tags nobody. */
export const asksLine = (
  input: Pick<ThreadInput, 'members' | 'serverInfo'>,
  note: Pick<AsRead.Note, 'tags'>,
): string | null =>
  note.tags === undefined || note.tags.length === 0 || !isOn(input, 'tagging')
    ? null
    : strings.tags.asks({ names: listOf(note.tags.map((id) => nameIn(input, id))) })

export interface ComposerTagsInput extends ThreadInput {
  readonly chosen: ReadonlyArray<MemberId>
  readonly mention: Mention | null
  readonly active: MemberId | null
}

export interface ComposerTagsModel {
  /** The people tagged, as chips, and the people in the group matching the @ being typed. */
  readonly picker: PeoplePickerModel
  /** One plain line saying whose agents will draft a reply. */
  readonly notice: string
  readonly hint: string
}

export interface Mention {
  /** Where the @ is in the text. */
  readonly start: number
  readonly query: string
}

export const TAG_PICKER_ID = 'composer-tags'

const noticeOf = (input: ComposerTagsInput, sending: TagsToSend): string => {
  const names = sending.asked.map((id) => nameIn(input, id))
  if (names.length === 0) return strings.tags.everyone
  if (sending.tags.length === 0) return strings.tags.reply({ name: names[0]! })
  return names.length === 1
    ? strings.tags.onlyOne({ name: names[0]! })
    : strings.tags.onlyMany({ names: listOf(names) })
}

const MENTION = /(?:^|\s)@([^\s@]{0,40})$/u
