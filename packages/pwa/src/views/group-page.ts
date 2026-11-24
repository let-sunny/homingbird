import { type AsRead, GROUP_NAME_MAX, type MemberId } from '@homingbird/protocol'
import { type Child, type Lifetime, type ReadableSignal, h, region, slice } from '@homingbird/ui'
import { featureOn } from '../features.ts'
import {
  type GroupMessage,
  type GroupPageModel,
  groupNameFrom,
  groupPageModel,
} from '../models/group-page.ts'
import { firstAnswersStep } from '../models/start.ts'
import { strings } from '../strings.ts'
import { renderAvatar } from './character-avatar.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, opensDialog } from './dialog.ts'
import { button, dialogActions, emptyWithPip, field, listWait, page, youMark } from './parts.ts'

/** A team's page: its name and its members, changed where the person may. */
export const groupPageView = (
  context: ViewContext,
  life: Lifetime,
  viewerId: MemberId,
  id: string,
): HTMLElement => {
  const shown = loadedGroup(context, viewerId, id)
  return region(life, shown.sources, () => renderGroupPage(shown.model(), context, shown.retry))
}

/** Loads the groups and the people a team's page needs, and the page's model over them as they change. */
export const loadedGroup = (
  context: ViewContext,
  viewerId: MemberId,
  id: string,
): {
  readonly model: () => GroupPageModel
  readonly sources: ReadonlyArray<ReadableSignal<unknown>>
  readonly retry: () => void
} => {
  const { state, actions } = context
  actions.loadGroups()
  actions.loadPeople()
  const awaited = slice([state.groups.load], () => firstAnswersStep([state.groups.load.get()]))
  return {
    model: () =>
      groupPageModel({
        id,
        groups: state.groups.get(),
        awaited: awaited.get(),
        workspace: state.workspace.get(),
        members: state.members.get(),
        directory: state.directory.get(),
        conversations: state.conversations.get(),
        viewerId,
        charactersOn: featureOn('characters', state.serverInfo.get()),
      }),
    sources: [state.groups, awaited, state.workspace, state.members, state.directory, state.conversations],
    retry: actions.loadGroupsAgain,
  }
}

const renderGroupPage = (model: GroupPageModel, context: ViewContext, retry: () => void): Child => {
  switch (model.kind) {
    case 'waiting':
      return page(strings.groups.title, listWait(model.wait, retry))
    case 'missing':
      return emptyWithPip('failed', model.text, h('a', { class: 'button', href: '#/' }, strings.backHome))
    case 'group':
      return groupPage(model, context)
  }
}

const groupPage = (model: GroupModel, context: ViewContext): HTMLElement =>
  page(model.title, groupEditor(model, context))

/**
 * A team's members and what the person may do with them: write to one or all of them, rename the team, add
 * or remove people. `more` goes beside renaming; the group page and the administration's editor share this.
 */
export const groupEditor = (model: GroupModel, context: ViewContext, more: Child = null): Child => {
  const group = model.group
  const changes = { attempt: 'managers' as const }
  const setMembers = (memberIds: ReadonlyArray<MemberId>): void =>
    context.actions.setGroupMembers(group.id, memberIds, changes)
  const actions = [
    model.groupMessage !== null && groupMessageAction(model.groupMessage, context),
    model.rename !== null &&
      h(
        'button',
        {
          type: 'button',
          class: 'rename-group',
          ...opensDialog(context, model.rename.label, () => renameForm(context, group, model.rename!.value)),
        },
        model.rename.label,
      ),
    more,
  ]
  return [
    actions.some((one) => one !== null && one !== false) && h('div', { class: 'group-actions' }, actions),
    h('h2', {}, model.membersHeading),
    h(
      'ul',
      { class: 'group-members' },
      model.members.map((row) =>
        h(
          'li',
          {
            class: `group-member${row.message === null ? '' : ' is-messageable'}`,
            data: { memberId: row.memberId },
          },
          renderAvatar(context, row.avatar),
          row.message === null
            ? h('span', { class: 'group-member-name' }, row.name, row.isYou && youMark())
            : h(
                'button',
                {
                  type: 'button',
                  class: 'group-member-name',
                  title: row.message,
                  'aria-label': row.message,
                  on: { click: () => context.actions.openConversationWith(row.memberId) },
                },
                row.name,
              ),
          row.remove !== null &&
            button(row.remove, () => setMembers(group.memberIds.filter((one) => one !== row.memberId)), {
              class: 'danger',
            }),
        ),
      ),
    ),
    model.addMember !== null &&
      addMemberForm(model.addMember, (memberId) => setMembers([...group.memberIds, memberId])),
  ]
}

const groupMessageAction = (message: GroupMessage, context: ViewContext): HTMLElement =>
  message.href !== null
    ? h('a', { class: 'button primary group-message', href: message.href }, message.label)
    : button(message.label, () => context.actions.openConversationAmong(message.memberIds), {
        class: 'primary group-message',
      })

type GroupModel = Extract<GroupPageModel, { kind: 'group' }>

const renameForm = (context: ViewContext, group: AsRead.Group, value: string): HTMLElement => {
  const name = h('input', {
    name: 'name',
    maxlength: String(GROUP_NAME_MAX),
    value,
    required: '',
    autocomplete: 'off',
  })
  return h(
    'form',
    {
      class: 'dialog-body rename-group-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          context.actions.renameGroup(group.id, groupNameFrom(name.value), {
            done: () => closeDialog(context),
            attempt: 'channel-name',
          })
        },
      },
    },
    field(strings.groups.nameLabel, name, strings.groups.nameHint),
    dialogActions(strings.save, 'primary'),
  )
}

const addMemberForm = (
  add: NonNullable<Extract<GroupPageModel, { kind: 'group' }>['addMember']>,
  choose: (memberId: MemberId) => void,
): HTMLElement => {
  const choice = h(
    'select',
    { name: 'member', 'aria-label': add.label },
    add.choices.map((one) => h('option', { value: one.value }, one.label)),
  )
  return h(
    'form',
    {
      class: 'add-member',
      on: {
        submit: (event) => {
          event.preventDefault()
          choose(choice.value as MemberId)
        },
      },
    },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, add.label), choice),
    h('button', { type: 'submit', class: 'primary' }, strings.addMember),
  )
}
