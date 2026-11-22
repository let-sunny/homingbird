import { type Child, h } from '@homingbird/ui'
import { type ConversationActions, type LeaveGroup, offersAny } from '../models/conversation-actions.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, opensDialog } from './dialog.ts'
import { type MenuParts, actionMenu } from './menu.ts'
import { button, dialogActions } from './parts.ts'

/** The items a direct or group message's menus share: hide, a new group with its people, and leave. */
export const conversationActionItems = (context: ViewContext, actions: ConversationActions): Child[] => {
  const { hide, newGroup, leave } = actions
  return [
    hide !== null &&
      button(hide.label, () => context.actions.setHidden(hide.conversationId, !hide.hidden, hide.done), {
        class: 'menu-item hide-conversation',
        title: hide.hint,
      }),
    newGroup !== null &&
      h(
        'a',
        {
          class: 'menu-item new-group',
          href: newGroup.href,
          role: 'menuitem',
          tabindex: '-1',
          title: newGroup.hint,
        },
        newGroup.label,
      ),
    leave !== null &&
      h(
        'button',
        {
          type: 'button',
          class: 'menu-item danger leave-group',
          ...opensDialog(context, leave.title, () => leaveGroupForm(context, leave)),
        },
        leave.label,
      ),
  ]
}

/** The ⋯ menu in a direct or group message's head; none when it offers nothing. */
export const threadActionsMenu = (
  context: ViewContext,
  label: string,
  actions: ConversationActions,
): MenuParts | null =>
  offersAny(actions)
    ? actionMenu(context, {
        id: THREAD_MENU_ID,
        label,
        triggerClass: 'thread-more',
        menuClass: 'conversation-menu',
        items: conversationActionItems(context, actions),
      })
    : null

/** Confirms leaving a group, saying what the person loses and that nobody can add them back. */
const leaveGroupForm = (context: ViewContext, leave: LeaveGroup): Child =>
  h(
    'form',
    {
      class: 'dialog-body',
      on: {
        submit: (event) => {
          event.preventDefault()
          context.actions.leaveGroup(leave.conversationId, leave.done, {
            done: () => closeDialog(context),
            attempt: 'leave',
          })
        },
      },
    },
    h('p', {}, leave.body),
    dialogActions(leave.label, 'danger'),
  )

const THREAD_MENU_ID = 'thread-menu'
