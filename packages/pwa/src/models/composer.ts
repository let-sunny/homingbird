import type { AsRead, DraftRequest } from '@homingbird/protocol'
import { type AnswerersLine, whoAnswers } from '../channel-answerers.ts'
import { waitingRequests } from '../draft-requests.ts'
import { theirAgentUnavailable } from '../presence.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { excerpt, isArchived, otherParticipants } from '../thread.ts'
import { type AvatarModel, memberAvatarOf } from './avatar.ts'
import { type ThreadInput, channelAskedIn, isOn, mayMessageIn, noteIn, roomOf } from './thread-room.ts'

/** Where the person writes: sending, what they asked their agent for, what they answer, and whether they may. */
export const composerModel = (input: ThreadInput): ComposerModel => {
  if (isArchived(roomOf(input))) return { kind: 'archived', notice: strings.archivedRoomNotice }
  const charactersOn = isOn(input, 'characters')
  const draftRequestsOn = isOn(input, 'draftRequests')
  const waiting = draftRequestsOn ? waitingRequests(input.draftRequests, input.conversationId, input.now) : []
  const mine = input.directory.find((entry) => entry.member.id === input.me.member.id)
  const target = noteIn(input, input.replyTarget)
  const self = input.members.get(input.me.member.id) ?? input.me.member
  return {
    kind: 'open',
    blocked: mayMessageIn(input) ? null : strings.cannotMessage,
    sending: input.sending
      ? {
          avatar: memberAvatarOf(self, charactersOn, { state: 'sending', motion: 'loop', labelled: false }),
          text: strings.sending,
        }
      : null,
    asked: waiting.map((request) => ({
      request,
      avatar: memberAvatarOf(self, charactersOn, { state: 'drafting', labelled: false }),
      text:
        request.instruction === ''
          ? strings.askedAgent
          : strings.askedAgentFor({ instruction: excerpt(request.instruction, 60) }),
    })),
    noAgent:
      waiting.length > 0 && mine?.presence.agentOnline === false
        ? {
            text: strings.noAgentOnline,
            href: hrefFor({ name: 'agent', section: 'connection' }),
            link: strings.connectAgent,
          }
        : null,
    theirAgent: theirAgentUnavailable(recipientPresence(input)),
    answers: answerersIn(input),
    replyingTo: target === null ? null : strings.replyingTo({ excerpt: excerpt(target.body, 60) }),
    asksAgent: draftRequestsOn,
    lookUpEarlierAnswers: isOn(input, 'earlierAnswers') && mayMessageIn(input),
  }
}

/** The text to send from what was typed, or null when there is nothing to send. */
export const bodyToSend = (typed: string): string | null => {
  const body = typed.trim()
  return body === '' ? null : body
}

export type ComposerModel =
  | { readonly kind: 'archived'; readonly notice: string }
  | {
      readonly kind: 'open'
      readonly blocked: string | null
      readonly sending: { readonly avatar: AvatarModel; readonly text: string } | null
      readonly asked: ReadonlyArray<{
        readonly request: DraftRequest
        readonly avatar: AvatarModel
        readonly text: string
      }>
      readonly noAgent: { readonly text: string; readonly href: string; readonly link: string } | null
      /** Said before sending when the one recipient's desk runs but their agent cannot answer. */
      readonly theirAgent: string | null
      /** In a channel, who answers a question asked there, and a warning when nobody can now. */
      readonly answers: AnswerersLine | null
      readonly replyingTo: string | null
      readonly asksAgent: boolean
      /** Whether "Answered before" looks up earlier answers to the question being written here. */
      readonly lookUpEarlierAnswers: boolean
    }

const answerersIn = (input: ThreadInput): AnswerersLine | null => {
  const channel = channelAskedIn(input)
  return channel === null
    ? null
    : whoAnswers({
        channel,
        directory: input.directory,
        viewerId: input.me.member.id,
        agentsOn: isOn(input, 'channelAgents'),
      })
}

const recipientPresence = (input: ThreadInput): AsRead.Presence | undefined => {
  const room = roomOf(input)
  if (room?.kind !== 'direct') return undefined
  const [other] = otherParticipants(room, input.me.member.id)
  return input.directory.find((entry) => entry.member.id === other)?.presence
}
