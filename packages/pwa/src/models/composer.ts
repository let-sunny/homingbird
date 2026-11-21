import type { AsRead, DraftRequest } from '@homingbird/protocol'
import { waitingRequests } from '../draft-requests.ts'
import { theirAgentUnavailable } from '../presence.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { excerpt, isArchived, otherParticipants } from '../thread.ts'
import { agentAskReach } from './agent-ask.ts'
import { type AvatarModel, memberAvatarOf } from './avatar.ts'
import { type ThreadInput, isOn, mayMessageIn, noteIn, roomOf } from './thread-room.ts'

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
    replyingTo: target === null ? null : strings.replyingTo({ excerpt: excerpt(target.body, 60) }),
    asksAgent: draftRequestsOn,
    askAgentReason: draftRequestsOn ? reasonOf(agentAskReach(true, mine?.presence)) : null,
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
      readonly replyingTo: string | null
      /** Whether the composer offers to ask the person's agent for a draft: only where the server takes requests. */
      readonly asksAgent: boolean
      /** Why the person's agent cannot be asked for a draft now, if it cannot. */
      readonly askAgentReason: string | null
    }

const reasonOf = (reach: ReturnType<typeof agentAskReach>): string | null => (reach.may ? null : reach.reason)

const recipientPresence = (input: ThreadInput): AsRead.Presence | undefined => {
  const room = roomOf(input)
  if (room?.kind !== 'direct') return undefined
  const [other] = otherParticipants(room, input.me.member.id)
  return input.directory.find((entry) => entry.member.id === other)?.presence
}
