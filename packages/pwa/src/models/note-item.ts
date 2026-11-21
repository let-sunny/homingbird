import { type AsRead, type MemberId, type NoteId, summarize } from '@homingbird/protocol'
import { authorshipOf, showsStateMark, stateMarkOf } from '../authorship.ts'
import { draftBasisOf } from '../draft-basis.ts'
import { unavailableOf } from '../presence.ts'
import { spriteOwner } from '../sprite-owner.ts'
import { formats, listOf, strings } from '../strings.ts'
import {
  type SingleStatus,
  type ThreadItem,
  answeredBy,
  excerpt,
  isArchived,
  isUnreadBy,
  readProgress,
  showsAuthors,
  statusOf,
} from '../thread.ts'
import { type AvatarModel, memberAvatarOf } from './avatar.ts'
import { agentAuthorshipLine, approvalLine } from './channel-agent.ts'
import { type ThreadInput, isOn, nameIn, noteIn, roomOf } from './thread-room.ts'
import { type TimeShown, timeShown } from './time.ts'

/** One sent note: who wrote it and how, what it answers, how far it got, and what the person may do. */
export const noteItemModel = (
  input: ThreadInput,
  item: Extract<ThreadItem, { type: 'note' }>,
): NoteItemModel => {
  const { note, leadsRun, next } = item
  const mine = note.authorId === input.me.member.id
  const quoted = noteIn(input, note.inReplyTo)
  const room = roomOf(input)
  const archived = isArchived(room)
  const inRoom = showsAuthors(room)
  const isChannelQuestion = room?.kind === 'channel' && note.inReplyTo === null
  const answerers = isChannelQuestion ? answeredBy(note) : []
  const sentAt = note.sentAt === null ? null : formats.full.format(new Date(note.sentAt))
  const authorship = authorshipLine(input, note, mine)
  const charactersOn = isOn(input, 'characters')
  const markShown = mine && showsStateMark(note, next)
  const basis = mine ? draftBasisOf(note) : null
  const side = mine ? 'is-mine' : 'is-theirs'
  return {
    noteId: note.id,
    className: `note ${side} ${leadsRun ? 'leads-run' : 'follows-run'} is-${authorshipOf(note)}`,
    unread: isUnreadBy(note, input.me.member.id),
    author: leadsRun ? authorModel(input, note, authorship, sentAt, charactersOn) : null,
    spokenAuthorship: leadsRun ? null : authorship,
    spokenSent: sentAt === null ? null : strings.authorship.sent({ time: sentAt }),
    authorName: inRoom && leadsRun ? (mine ? strings.you : nameIn(input, note.authorId)) : null,
    bubbleTitle: next !== null && sentAt !== null ? sentAt : null,
    quote: quoted === null ? null : excerpt(quoted.body),
    body: note.body,
    basis:
      basis === null || basis.kind === 'none'
        ? null
        : { className: `note-basis ${side}`, lines: basis.lines },
    approval: approvalLine(note, room, input.channels, input.members),
    answeredBy:
      answerers.length === 0
        ? null
        : {
            avatar: memberAvatarOf(
              input.members.get(spriteOwner({ kind: 'note', authorId: answerers[0]! }) as MemberId),
              charactersOn,
              {
                state: 'accepted',
                labelled: false,
              },
            ),
            text: strings.answeredBy({ names: listOf(answerers.map((memberId) => nameIn(input, memberId))) }),
          },
    release: !mine && !archived ? releaseModel(input, note) : null,
    meta:
      next === null || markShown
        ? {
            time: next === null && note.sentAt !== null ? timeShown(note.sentAt, input.now) : null,
            mark: markShown ? stateMarkModel(input, note, inRoom) : null,
          }
        : null,
    actions: [
      ...(!mine && !archived ? [{ kind: 'reply' as const, label: strings.reply }] : []),
      ...(!mine && !archived && isOn(input, 'draftRequests')
        ? [{ kind: 'ask-agent' as const, label: strings.askAgentToReply }]
        : []),
    ],
  }
}

export interface NoteItemModel {
  readonly noteId: NoteId
  readonly className: string
  readonly unread: boolean
  readonly author: AuthorModel | null
  readonly spokenAuthorship: string | null
  readonly spokenSent: string | null
  readonly authorName: string | null
  readonly bubbleTitle: string | null
  readonly quote: string | null
  readonly body: string
  readonly basis: { readonly className: string; readonly lines: ReadonlyArray<string> } | null
  /** Where a channel's agent answered and who approved it, for everyone who reads the note. */
  readonly approval: string | null
  readonly answeredBy: { readonly avatar: AvatarModel; readonly text: string } | null
  readonly release: { readonly text: string; readonly askAnyway: string | null } | null
  readonly meta: { readonly time: TimeShown | null; readonly mark: StateMarkModel | null } | null
  readonly actions: ReadonlyArray<{ readonly kind: 'reply' | 'ask-agent'; readonly label: string }>
}

/** The author's character as a button, and the details it opens: who or what wrote the note, and when. */
export interface AuthorModel {
  readonly id: string
  readonly buttonClass: string
  readonly buttonLabel: string
  readonly avatar: AvatarModel
  readonly agentMark: boolean
  readonly line: string
  readonly debate: string | null
  readonly details: ReadonlyArray<{ readonly text: string; readonly className: string | null }>
  readonly sent: string | null
}

export interface StateMarkModel {
  readonly state: string
  readonly label: string
  readonly glyph: string
  readonly count: string | null
}

/** Asks for the text form of a glyph, so that no platform swaps in a coloured emoji. */
const TEXT_PRESENTATION = '︎'

const STATE_GLYPHS: Readonly<Record<SingleStatus, string>> = {
  sent: '·',
  delivered: '✓',
  read: '✓✓',
  drafting: '✎',
  replied: '↩',
}

const authorshipLine = (input: ThreadInput, note: AsRead.Note, mine: boolean): string => {
  const byAgent = agentAuthorshipLine(note, roomOf(input), input.channels, input.members)
  if (byAgent !== null) return byAgent
  const name = nameIn(input, note.authorId)
  switch (authorshipOf(note)) {
    case 'agent':
      return mine ? strings.authorship.agentYou : strings.authorship.agent({ name })
    case 'edited':
      return mine ? strings.authorship.editedYou : strings.authorship.edited({ name })
    case 'person':
      return mine ? strings.authorship.personYou : strings.authorship.person({ name })
  }
}

const authorModel = (
  input: ThreadInput,
  note: AsRead.Note,
  line: string,
  sentAt: string | null,
  charactersOn: boolean,
): AuthorModel => {
  const showsDetails = isOn(input, 'noteDetails')
  return {
    id: `author-${note.id}`,
    buttonClass: `author-button is-${authorshipOf(note)}`,
    buttonLabel: strings.authorship.who({ authorship: line }),
    avatar: memberAvatarOf(
      input.members.get(spriteOwner({ kind: 'note', authorId: note.authorId }) as MemberId),
      charactersOn,
      {
        labelled: false,
      },
    ),
    agentMark: note.origin !== 'human',
    line,
    debate:
      note.fromDebate === undefined
        ? null
        : strings.authorship.fromDebate({
            question: note.fromDebate.question,
            agents: listOf(
              note.fromDebate.agents.map((one) =>
                strings.debates.agentOf({ agent: one.agent, person: one.person }),
              ),
            ),
          }),
    details:
      showsDetails && note.fromDebate === undefined && note.origin !== 'human'
        ? [
            {
              text:
                note.agentModel == null
                  ? strings.authorship.modelNotStated
                  : strings.authorship.model({ model: note.agentModel }),
              className: null,
            },
            {
              text:
                note.agentClient == null
                  ? strings.authorship.clientUnknown
                  : strings.authorship.client({ client: note.agentClient }),
              className: null,
            },
            ...(note.agentName !== null
              ? [{ text: strings.authorship.connection({ name: note.agentName }), className: null }]
              : []),
            { text: strings.authorship.reported, className: 'author-reported' },
          ]
        : [],
    sent: showsDetails && sentAt !== null ? strings.authorship.sent({ time: sentAt }) : null,
  }
}

const releaseModel = (input: ThreadInput, note: AsRead.Note): NoteItemModel['release'] => {
  const released = input.releases.get(note.id)
  if (released === undefined) return null
  return {
    text:
      released.reason === null || released.reason.trim() === ''
        ? strings.agentReleasedWithoutReason
        : strings.agentReleased({ reason: released.reason }),
    askAnyway: isOn(input, 'draftRequests') ? strings.askAnyway : null,
  }
}

const stateMarkModel = (input: ThreadInput, note: AsRead.Note, inRoom: boolean): StateMarkModel => {
  const mark = stateMarkOf(note.receipts)
  return {
    state: mark.state,
    label: inRoom ? roomStatus(note) : dmStatus(input, note),
    glyph: `${STATE_GLYPHS[mark.state]}${TEXT_PRESENTATION}`,
    count:
      mark.count === null
        ? null
        : strings.readCount({
            read: formats.decimal.format(mark.count.read),
            of: formats.decimal.format(mark.count.of),
          }),
  }
}

const dmStatus = (input: ThreadInput, note: AsRead.Note): string => {
  const summary = summarize(note.receipts)
  if (summary.recipients > 1) return roomStatus(note)
  const status = statusOf(summary)
  if ((status === 'delivered' || status === 'read') && isUnavailableRecipient(input, note))
    return status === 'read' ? strings.readAgentUnavailable : strings.deliveredAgentUnavailable
  return strings.status[status]
}

/** Whether the one person a note went to runs a desk whose agent cannot answer now. */
const isUnavailableRecipient = (input: ThreadInput, note: AsRead.Note): boolean => {
  const [receipt] = note.receipts
  const entry = input.directory.find((candidate) => candidate.member.id === receipt?.memberId)
  return unavailableOf(entry?.presence) !== null
}

const roomStatus = (note: AsRead.Note): string => {
  const { read, of, drafting } = readProgress(note.receipts)
  return drafting > 0 ? strings.readByWhileDrafting({ read, of, drafting }) : strings.readBy({ read, of })
}
