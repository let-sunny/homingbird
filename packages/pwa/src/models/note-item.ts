import { type AsRead, type MemberId, type NoteId, mayRecall, summarize } from '@homingbird/protocol'
import { authorshipOf, showsStateMark, stateMarkOf } from '../authorship.ts'
import { type AnswerersLine, questionWaits } from '../channel-answerers.ts'
import { debateNoteParts } from '../debate-note.ts'
import { type SourceShown, draftBasisOf } from '../draft-basis.ts'
import { unavailableOf } from '../presence.ts'
import { hrefFor } from '../routes.ts'
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
import { agentAskReach } from './agent-ask.ts'
import { type AvatarModel, memberAvatarOf } from './avatar.ts'
import { agentAuthorshipLine, approvalLine } from './channel-agent.ts'
import { confirmedPreviewLine } from './draft-previews.ts'
import { type TeachSeed, teachSeedOf } from './teaching.ts'
import { type ThreadInput, channelAskedIn, isOn, nameIn, noteIn, notesOf, roomOf } from './thread-room.ts'
import { type TimeShown, noteTimeShown } from './time.ts'

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
  const isChannelQuestion =
    room?.kind === 'channel' && note.inReplyTo === null && note.fromDebate === undefined
  const answerers = isChannelQuestion ? answeredBy(note) : []
  const sentAt = note.sentAt === null ? null : formats.full.format(new Date(note.sentAt))
  const authorship = authorshipLine(input, note, mine)
  const charactersOn = isOn(input, 'characters')
  const withdrawn = note.status === 'withdrawn'
  const markShown = mine && !withdrawn && showsStateMark(note, next)
  const basis = mine ? draftBasisOf(note) : null
  const waits =
    mine && answerers.length === 0 && note.fromDebate === undefined ? questionLine(input, note) : null
  const side = mine ? 'is-mine' : 'is-theirs'
  const discardedBy = input.discardedAnswers?.get(note.id)
  return {
    noteId: note.id,
    className: `note ${side} ${leadsRun ? 'leads-run' : 'follows-run'} is-${authorshipOf(note)}${withdrawn ? ' is-withdrawn' : ''}`,
    unread: isUnreadBy(note, input.me.member.id),
    author: leadsRun ? authorModel(input, note, authorship, sentAt, charactersOn) : null,
    spokenAuthorship: leadsRun ? null : authorship,
    spokenSent: sentAt === null ? null : strings.authorship.sent({ time: sentAt }),
    authorName: inRoom && leadsRun ? (mine ? strings.you : nameIn(input, note.authorId)) : null,
    bubbleTitle: next !== null && sentAt !== null ? sentAt : null,
    quote:
      quoted === null
        ? null
        : {
            text: excerpt(quoted.body),
            href: hrefFor({ name: 'conversation', id: input.conversationId, draft: null, note: quoted.id }),
            label: strings.quotedNote,
          },
    body: note.body,
    debateResult: debateResultOf(note),
    longBody: isLongBody(note.body) ? { more: strings.showMoreNote, less: strings.showLessNote } : null,
    basis:
      basis === null || basis.kind === 'none'
        ? null
        : {
            className: `note-basis ${side}`,
            title: strings.basedOn,
            lines: basis.lines,
            sources: basis.sources,
          },
    approval: approvalLine(note, room, input.channels, input.members) ?? confirmedPreviewLine(input, note),
    autoSent: autoSentModel(input, note, mine),
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
    noAnswer:
      isChannelQuestion &&
      asksSomething(note.body) &&
      !archived &&
      waits === null &&
      answerers.length === 0 &&
      !isBeingAnswered(note) &&
      !hasReplyIn(input, note) &&
      discardedBy === undefined
        ? strings.noAnswerYet
        : null,
    answerDiscarded:
      discardedBy === undefined || archived || answerers.length > 0 || hasReplyIn(input, note)
        ? null
        : {
            text: strings.channelAgent.answerDiscarded({ agent: discardedBy }),
            reply: strings.activity.replyYourself,
          },
    release: !mine && !archived ? releaseModel(input, note) : null,
    waits,
    meta:
      next === null || markShown
        ? {
            time: next === null && note.sentAt !== null ? noteTimeShown(note.sentAt, input.now) : null,
            mark: markShown ? stateMarkModel(input, note, inRoom) : null,
          }
        : null,
    reply: archived ? null : strings.reply,
    menu: {
      id: `note-menu-${note.id}`,
      label: strings.noteMore,
      items: menuItems(input, { reply: !archived, askAgent: !mine && !archived }),
      fixed: mine ? strings.noteFixed : null,
    },
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
  /** The excerpt of the note this one replies to, as a link that opens the thread at it. */
  readonly quote: { readonly text: string; readonly href: string; readonly label: string } | null
  readonly body: string
  /**
   * A debate room's posted result, read first for what the agents settled and what happens next, with the
   * whole note folded and a way into the room. A result is not a question: nobody is asked to answer it.
   */
  readonly debateResult: DebateResultNote | null
  /** A body long enough to be shown collapsed, with the words of the button that opens and closes it. */
  readonly longBody: { readonly more: string; readonly less: string } | null
  /** What the person's own sent note rested on, collapsed under "Based on". */
  readonly basis: {
    readonly className: string
    readonly title: string
    readonly lines: ReadonlyArray<string>
    readonly sources: ReadonlyArray<SourceShown>
  } | null
  /** Where a channel's agent answered and who approved it, or that a draft seen early was checked. */
  readonly approval: string | null
  /** That a saved answer sent the note without a click, and the author's Recall while it may still be taken back. */
  readonly autoSent: { readonly text: string; readonly recall: string | null } | null
  readonly answeredBy: { readonly avatar: AvatarModel; readonly text: string } | null
  /** Under a channel's question nobody answered or is answering, a discarded answer's included. */
  readonly noAnswer: string | null
  /** The manager discarded the channel agent's answer to this question, and may answer it themself. */
  readonly answerDiscarded: { readonly text: string; readonly reply: string } | null
  readonly release: {
    readonly text: string
    readonly askAnyway: string | null
    /** Teaching the agent what to do with notes like this one, from the guided form filled in. */
    readonly teach: { readonly label: string; readonly seed: TeachSeed } | null
  } | null
  /** Under the person's latest question in a channel while no answer came: who answers, then drafting. */
  readonly waits: AnswerersLine | null
  readonly meta: { readonly time: TimeShown | null; readonly mark: StateMarkModel | null } | null
  /** The toolbar's Reply, where the person may answer the note. */
  readonly reply: string | null
  /** The note's other actions, behind the toolbar's ⋯ and a right-click or long press on the note. */
  readonly menu: {
    readonly id: string
    readonly label: string
    readonly items: ReadonlyArray<NoteMenuItem>
    /** Under the person's own note: that a sent note stays as it is, and a reply corrects it. */
    readonly fixed: string | null
  }
}

export interface DebateResultNote {
  /** The conclusion and next steps; null when the note is not in the shape the server writes. */
  readonly parts: {
    readonly heading: string
    readonly summary: string
    readonly nextStepsHeading: string
    readonly nextSteps: ReadonlyArray<string>
  } | null
  readonly whole: string
  readonly room: { readonly href: string; readonly label: string }
}

/** One of a note's menu actions; one the person cannot take now says why. */
export interface NoteMenuItem {
  readonly kind: 'reply' | 'ask-agent' | 'copy' | 'copy-link'
  readonly label: string
  readonly reason: string | null
}

/** The author's character as a button, and the details it opens: who or what wrote the note, and when. */
export interface AuthorModel {
  readonly id: string
  /** Whose profile card the face opens. */
  readonly memberId: MemberId
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

const menuItems = (
  input: ThreadInput,
  may: { readonly reply: boolean; readonly askAgent: boolean },
): ReadonlyArray<NoteMenuItem> => {
  const mine = input.directory.find((entry) => entry.member.id === input.me.member.id)
  const reach = agentAskReach(isOn(input, 'draftRequests'), mine?.presence)
  return [
    ...(may.reply ? [{ kind: 'reply' as const, label: strings.reply, reason: null }] : []),
    ...(may.askAgent
      ? [
          {
            kind: 'ask-agent' as const,
            label: strings.askAgentToReply,
            reason: reach.may ? null : reach.reason,
          },
        ]
      : []),
    { kind: 'copy', label: strings.copyNote, reason: null },
    { kind: 'copy-link', label: strings.copyNoteLink, reason: null },
  ]
}

const debateResultOf = (note: AsRead.Note): DebateResultNote | null => {
  if (note.fromDebate === undefined) return null
  const parts = debateNoteParts(note.body)
  return {
    parts:
      parts === null
        ? null
        : {
            heading: parts.agreed ? strings.debateNote.agreed : strings.debateNote.disagreed,
            summary: parts.summary,
            nextStepsHeading: strings.debateNote.nextSteps,
            nextSteps: parts.nextSteps,
          },
    whole: strings.debateNote.whole,
    room: {
      href: hrefFor({ name: 'debate', id: note.fromDebate.debateId, tab: 'result' }),
      label: strings.debateNote.openRoom,
    },
  }
}
/** A body past this many characters or lines is shown collapsed, about a screen of a bubble. */
const LONG_BODY_CHARACTERS = 1200
const LONG_BODY_LINES = 16

const isLongBody = (body: string): boolean =>
  body.length > LONG_BODY_CHARACTERS || body.split('\n').length > LONG_BODY_LINES

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
    memberId: note.authorId,
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

const questionLine = (input: ThreadInput, note: AsRead.Note): AnswerersLine | null => {
  const channel = note.inReplyTo === null && note.status === 'sent' ? channelAskedIn(input) : null
  if (channel === null) return null
  const notes = notesOf(input)
  const latest = notes.findLast(
    (other) => other.authorId === note.authorId && other.inReplyTo === null && other.status === 'sent',
  )
  const answered = notes.some((other) => other.inReplyTo === note.id && other.status === 'sent')
  return answered || latest?.id !== note.id
    ? null
    : questionWaits(
        {
          channel,
          directory: input.directory,
          viewerId: input.me.member.id,
          agentsOn: isOn(input, 'channelAgents'),
        },
        note,
      )
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
    teach: isOn(input, 'teaching')
      ? { label: strings.teach.add, seed: teachSeedOf(note.body, channelAskedIn(input)?.slug ?? null) }
      : null,
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

const hasReplyIn = (input: ThreadInput, note: AsRead.Note): boolean =>
  notesOf(input).some((reply) => reply.inReplyTo === note.id && reply.status === 'sent')

const isBeingAnswered = (note: AsRead.Note): boolean =>
  note.receipts.some((receipt) => receipt.state === 'drafting')

const roomStatus = (note: AsRead.Note): string => {
  const { read, of, drafting } = readProgress(note.receipts)
  return drafting > 0 ? strings.readByWhileDrafting({ read, of, drafting }) : strings.readBy({ read, of })
}

/** Whether a note asks something, so that an announcement is never marked as waiting for an answer. */
const asksSomething = (body: string): boolean => /[?？]/.test(body)

/** Whether a saved answer sent this note, said to everyone who reads it; recalled, said to its author. */
const autoSentModel = (input: ThreadInput, note: AsRead.Note, mine: boolean): NoteItemModel['autoSent'] => {
  if (note.autoSent !== true) return null
  if (note.status === 'withdrawn') return { text: strings.autoSend.recalledLine, recall: null }
  return {
    text: mine
      ? strings.autoSend.sentByYours
      : strings.autoSend.sentByTheirs({ name: nameIn(input, note.authorId) }),
    recall: mayRecall(note, input.me.member.id, input.now) ? strings.autoSend.recall : null,
  }
}
