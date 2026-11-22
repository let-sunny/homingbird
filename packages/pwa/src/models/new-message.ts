import { type AsRead, type MemberId, RECIPIENTS_MAX } from '@homingbird/protocol'
import { hrefFor } from '../routes.ts'
import { listOf, strings } from '../strings.ts'
import { roomWith } from '../thread.ts'
import { agentAskReach } from './agent-ask.ts'
import { bodyToSend } from './composer.ts'
import { type PickerCandidate, chosenAmong } from './people-picker.ts'

/**
 * The new-message screen: who will read the note, where it goes, and whether it may be sent or drafted.
 * No room is made here; the first note sent or asked for makes it.
 */
export const newMessageModel = (input: NewMessageInput): NewMessageModel => {
  const recipients = recipientsOf(input)
  const names = recipients.map((memberId) => input.candidates.find((one) => one.memberId === memberId)!.name)
  const room = roomWith(input.conversations, input.viewerId, recipients)
  const waiting = recipients.length === 0 ? strings.newMessage.chooseFirst : null
  const reach = agentAskReach(input.draftRequestsOn, input.myPresence)
  return {
    title: strings.newMessage.title,
    to: strings.newMessage.to,
    audience:
      names.length === 0
        ? strings.newMessage.nobody
        : names.length === 1
          ? strings.newMessage.onlyOne({ name: names[0]! })
          : strings.newMessage.several({ names: listOf(names) }),
    where:
      room !== undefined
        ? {
            text:
              recipients.length === 1 ? strings.newMessage.existingDirect : strings.newMessage.existingGroup,
            link: {
              label: strings.newMessage.openExisting,
              href: hrefFor({ name: 'conversation', id: room.id, draft: null }),
            },
          }
        : names.length === 0
          ? null
          : {
              text: names.length === 1 ? strings.newMessage.newDirect : strings.newMessage.newGroup,
              link: null,
            },
    send: {
      label: input.sending ? strings.sending : strings.send,
      enabled: !input.sending && waiting === null && bodyToSend(input.typed) !== null,
      reason: waiting,
    },
    ask: input.draftRequestsOn
      ? {
          enabled: !input.sending && waiting === null && reach.may,
          reason: waiting ?? (reach.may ? null : reach.reason),
        }
      : null,
  }
}

/** Whom the note goes to: the people chosen who may be written to, at most as many as a room holds. */
export const recipientsOf = (
  input: Pick<NewMessageInput, 'candidates' | 'chosen'>,
): ReadonlyArray<MemberId> => chosenAmong(input.candidates, input.chosen, RECIPIENTS_MAX)

export interface NewMessageInput {
  readonly candidates: ReadonlyArray<PickerCandidate>
  readonly chosen: ReadonlyArray<MemberId>
  readonly conversations: ReadonlyArray<AsRead.Conversation>
  readonly viewerId: MemberId
  readonly typed: string
  readonly sending: boolean
  readonly draftRequestsOn: boolean
  readonly myPresence: AsRead.Presence | undefined
}

export interface NewMessageModel {
  readonly title: string
  readonly to: string
  /** Who will read the note, in one sentence. */
  readonly audience: string
  /** Where the note goes: the room there already is, with a way to open it, or the one it starts. */
  readonly where: {
    readonly text: string
    readonly link: { readonly label: string; readonly href: string } | null
  } | null
  readonly send: { readonly label: string; readonly enabled: boolean; readonly reason: string | null }
  /** Asking the person's agent for the note instead; null where the server takes no draft requests. */
  readonly ask: { readonly enabled: boolean; readonly reason: string | null } | null
}
