import type { AsRead, ConversationId, MemberId } from '@homingbird/protocol'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { isHidden, otherParticipants } from '../thread.ts'

/**
 * What a person can do with a direct or group message from its menus, beyond muting: hide it from their
 * own list, leave a group for good, and start a new group with the same people. A group's people never
 * change, so a new group is how someone is added or taken out; its notes stay in the old room.
 */
export const conversationActionsModel = (input: ConversationActionsInput): ConversationActions => {
  const { conversation, title } = input
  const isPeopleRoom =
    (conversation.kind === 'direct' || conversation.kind === 'group') &&
    conversation.privateQuestionOf === undefined &&
    conversation.archivedAt === null
  const isGroup = isPeopleRoom && conversation.kind === 'group'
  const others = otherParticipants(conversation, input.viewerId)
  const hidden = isHidden(conversation)
  const drafts = conversation.draftCount > 0
  return {
    hide:
      !isPeopleRoom || !input.hideOn
        ? null
        : {
            conversationId: conversation.id,
            hidden,
            label: (hidden ? strings.places.showName : strings.places.hideName)({ name: title }),
            hint: drafts && !hidden ? strings.places.hideWithDraft : strings.places.hideHint,
            done: hidden ? null : strings.places.hiddenNow({ name: title }),
          },
    leave:
      !isGroup || !input.leaveOn
        ? null
        : {
            conversationId: conversation.id,
            label: strings.places.leave,
            title: strings.places.leaveTitle({ name: title }),
            body: drafts ? strings.places.leaveBodyWithDrafts : strings.places.leaveBody,
            done: strings.places.left({ name: title }),
          },
    newGroup:
      !isGroup || others.length < 2
        ? null
        : {
            label: strings.places.newGroup,
            hint: strings.places.newGroupHint,
            href: hrefFor({ name: 'new', to: others }),
          },
  }
}

/** Whether the menus offer anything from this model. */
export const offersAny = (actions: ConversationActions): boolean =>
  actions.hide !== null || actions.leave !== null || actions.newGroup !== null

export interface ConversationActionsInput {
  readonly conversation: AsRead.Conversation
  /** The conversation's name as the person sees it. */
  readonly title: string
  readonly viewerId: MemberId
  readonly hideOn: boolean
  readonly leaveOn: boolean
}

export interface ConversationActions {
  readonly hide: HideToggle | null
  readonly leave: LeaveGroup | null
  readonly newGroup: NewGroup | null
}

export interface HideToggle {
  readonly conversationId: ConversationId
  readonly hidden: boolean
  readonly label: string
  readonly hint: string
  /** What the page says once it is hidden; nothing when it is shown again. */
  readonly done: string | null
}

/** Leaving a group, always confirmed first in a dialog with what it means. */
export interface LeaveGroup {
  readonly conversationId: ConversationId
  readonly label: string
  readonly title: string
  readonly body: string
  readonly done: string
}

export interface NewGroup {
  readonly label: string
  readonly hint: string
  readonly href: string
}
