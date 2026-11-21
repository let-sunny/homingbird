import type { MemberId, Note } from '@homingbird/protocol'
import { replyLater } from './own-agent.ts'
import { memberById } from './reads.ts'
import { announceStatus, changeNote, reviewersOf, saveDraft, sendDraft } from './sending.ts'
import { VISITOR_ID } from './team.ts'
import type { Records, World } from './world.ts'

/**
 * What the demo's colleagues do after someone sends a note: a few seconds later the colleague's agent
 * starts drafting, then its answer arrives as that colleague approved it. A channel's agent's answer
 * waits for a manager who did not ask; when the visitor is one of them it waits for the visitor's click,
 * otherwise another manager approves it. A colleague answers the visitor's reply once with a question
 * back, which the visitor's own agent drafts a reply to. Nothing is ever sent as the visitor: only their
 * click sends.
 */
export const answerLater = (world: World, question: Note): void => {
  const responder = responderTo(world.records(), question)
  if (responder === null) return
  world.after(DRAFTING_AFTER_MS, () => markDrafting(world, question, responder))
  world.after(ANSWER_AFTER_MS, () => answer(world, question, responder))
}

/** How long a colleague's agent takes to start, and to finish, an answer; and a manager to approve one. */
export const DRAFTING_AFTER_MS = 2_000
export const ANSWER_AFTER_MS = 6_000
export const APPROVAL_AFTER_MS = 5_000

/** What a colleague asks back the first time the visitor replies to them. */
export const PERSON_FOLLOW_UP =
  'Thanks, that helps. One more thing: whom do I tell if something goes wrong while it runs?'

interface Responder {
  readonly id: MemberId
  readonly kind: 'person' | 'channel_agent'
  readonly agentName: string
  /** The channel it answers for, which names its words; null in a direct or group conversation. */
  readonly channel: string | null
}

/**
 * Who answers a note: nobody for a debate room's result, which is not a question; else a channel's agent
 * a new question in its room or asked privately of it, else the first colleague whose agent answers in
 * the channel, else the first other person in the conversation.
 */
const responderTo = (records: Records, note: Note): Responder | null => {
  if (note.fromDebate !== undefined) return null
  const room = records.conversations.find((each) => each.id === note.conversationId)
  if (room === undefined) return null
  const channel = records.channels.find((each) =>
    room.privateQuestionOf === undefined
      ? each.conversationId === room.id
      : each.slug === room.privateQuestionOf.slug,
  )
  if (channel !== undefined && channel.agentId !== null) {
    if (note.inReplyTo !== null) return null
    const agent = memberById(records, channel.agentId)
    return agent === null
      ? null
      : { id: agent.id, kind: 'channel_agent', agentName: agent.name, channel: channel.slug }
  }
  const candidates = room.kind === 'channel' ? (channel?.answering ?? []) : room.participantIds
  const colleague = candidates
    .filter((id) => id !== note.authorId && id !== VISITOR_ID && room.participantIds.includes(id))
    .map((id) => memberById(records, id))
    .find((member) => member?.kind === 'person' && member.status === 'active')
  return colleague === undefined || colleague === null
    ? null
    : {
        id: colleague.id,
        kind: 'person',
        agentName: `${colleague.name.split(' ')[0]}'s laptop`,
        channel: room.kind === 'channel' ? (channel?.slug ?? null) : null,
      }
}

/** The responder's receipt on the question turns to drafting, which the asker sees. */
const markDrafting = (world: World, question: Note, responder: Responder): void => {
  const current = world.records().notes.find((note) => note.id === question.id)
  if (!current?.receipts.some((receipt) => receipt.memberId === responder.id && receipt.state !== 'replied'))
    return
  const now = world.clock.now()
  announceStatus(
    world,
    changeNote(world, question.id, (note) => ({
      ...note,
      receipts: note.receipts.map((receipt) =>
        receipt.memberId === responder.id && receipt.state !== 'replied'
          ? { ...receipt, state: 'drafting', readAt: receipt.readAt ?? now, draftingAt: now }
          : receipt,
      ),
    })),
  )
}

const answer = (world: World, question: Note, responder: Responder): void => {
  const draft = saveDraft(world, {
    conversationId: question.conversationId,
    authorId: responder.id,
    body: answerText(world.records(), responder, question),
    inReplyTo: question.id,
    agentName: responder.agentName,
    basis: responder.kind === 'channel_agent' ? `Past answers in #${responder.channel}.` : null,
  })
  if (responder.kind === 'person') {
    const sent = sendDraft(world, draft, { body: draft.body, approvedBy: null })
    if (sent.body === PERSON_FOLLOW_UP && question.authorId === VISITOR_ID)
      replyLater(world, sent, VISITOR_ID)
    return
  }
  const reviewers = reviewersOf(world.records(), draft)
  const approver = reviewers[0]
  if (approver === undefined || reviewers.includes(VISITOR_ID)) return
  world.after(APPROVAL_AFTER_MS, () => {
    const waiting = world.records().notes.find((note) => note.id === draft.id && note.status === 'draft')
    if (waiting !== undefined) sendDraft(world, waiting, { body: waiting.body, approvedBy: approver })
  })
}

/** A person answers a new note, asks back once when a reply comes, then thanks; a channel's agent answers from its room. */
const answerText = (records: Records, responder: Responder, question: Note): string => {
  if (responder.kind !== 'person')
    return CHANNEL_ANSWERS[responder.channel ?? ''] ?? CHANNEL_ANSWER(responder.channel ?? '')
  if (question.inReplyTo === null) return PERSON_ANSWER
  const askedBack = records.notes.some(
    (note) =>
      note.conversationId === question.conversationId &&
      note.authorId === responder.id &&
      note.body === PERSON_FOLLOW_UP,
  )
  return askedBack ? PERSON_THANKS : PERSON_FOLLOW_UP
}

const PERSON_ANSWER =
  'Thanks, I have this. I will look at it this afternoon and write back here if anything is unclear.'

const PERSON_THANKS = 'Thanks, that is what I needed.'

const CHANNEL_ANSWERS: Readonly<Record<string, string>> = {
  billing:
    'From what #billing answered before: refunds follow the refund policy page, and the calculator under Refunds on the billing page gives the exact amount. Reply with the invoice number if your case is not covered there.',
}

const CHANNEL_ANSWER = (slug: string): string =>
  `From what #${slug} answered before: this has come up once, and the answer is in the channel's pinned notes. Reply here if that does not cover it.`
