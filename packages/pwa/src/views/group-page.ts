import { type AsRead, GROUP_NAME_MAX, type MemberId } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { featureOn } from '../features.ts'
import { type GroupPageModel, groupNameFrom, groupPageModel } from '../models/group-page.ts'
import { strings } from '../strings.ts'
import { renderAvatar } from './character-avatar.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, opensDialog } from './dialog.ts'
import { button, dialogActions, emptyWithPip, field, loadFailed, loading, page, youMark } from './parts.ts'

/** A team's page: its name and its members, changed where the person may. */
export const groupPageView = (
  context: ViewContext,
  life: Lifetime,
  viewerId: MemberId,
  id: string,
): HTMLElement => {
  const { state, actions } = context
  const failed = signal(false)
  const load = (): void => {
    failed.set(false)
    actions.loadGroups({ failed: () => failed.set(true) })
  }
  load()
  const model = (): GroupPageModel =>
    groupPageModel({
      id,
      groups: state.groups.get(),
      loaded: state.groupsLoaded.get(),
      failed: failed.get(),
      members: state.members.get(),
      directory: state.directory.get(),
      viewerId,
      charactersOn: featureOn('characters', state.serverInfo.get()),
    })
  return region(life, [state.groups, state.groupsLoaded, failed, state.members, state.directory], () =>
    renderGroupPage(model(), context, load),
  )
}

const renderGroupPage = (model: GroupPageModel, context: ViewContext, retry: () => void): Child => {
  switch (model.kind) {
    case 'loading':
      return page(strings.groups.title, loading())
    case 'failed':
      return page(strings.groups.title, loadFailed(retry))
    case 'missing':
      return emptyWithPip('failed', model.text, h('a', { class: 'button', href: '#/' }, strings.backHome))
    case 'group':
      return groupPage(model, context)
  }
}

const groupPage = (model: Extract<GroupPageModel, { kind: 'group' }>, context: ViewContext): HTMLElement => {
  const group = model.group
  const changes = { attempt: 'managers' as const }
  const setMembers = (memberIds: ReadonlyArray<MemberId>): void =>
    context.actions.setGroupMembers(group.id, memberIds, changes)
  return page(
    model.title,
    model.rename !== null &&
      h(
        'div',
        { class: 'group-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'rename-group',
            ...opensDialog(context, model.rename.label, () =>
              renameForm(context, group, model.rename!.value),
            ),
          },
          model.rename.label,
        ),
      ),
    h('h2', {}, model.membersHeading),
    h(
      'ul',
      { class: 'group-members' },
      model.members.map((row) =>
        h(
          'li',
          { class: 'group-member', data: { memberId: row.memberId } },
          renderAvatar(context, row.avatar),
          h('span', { class: 'group-member-name' }, row.name, row.isYou && youMark()),
          row.remove !== null &&
            button(row.remove, () => setMembers(group.memberIds.filter((one) => one !== row.memberId)), {
              class: 'danger',
            }),
        ),
      ),
    ),
    model.addMember !== null &&
      addMemberForm(model.addMember, (memberId) => setMembers([...group.memberIds, memberId])),
  )
}

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
