import type { AsRead } from '@homingbird/protocol'
import { type Lifetime, h, region, signal } from '@homingbird/ui'
import { featureOn } from '../features.ts'
import {
  type AdminMembersModel,
  type MemberActionKind,
  adminMembersModel,
  deactivationModel,
} from '../models/admin.ts'
import { memberAvatarOf } from '../models/avatar.ts'
import { showsInvites } from '../models/invites.ts'
import { strings } from '../strings.ts'
import { renderAvatar } from './character-avatar.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, showDialog } from './dialog.ts'
import { invitesSection } from './invites.ts'
import { button, dialogActions, field, loading, youMark } from './parts.ts'

/** Administration → Members: every member, how recently they were active, and their role and status to change. */
export const adminMembersSection = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const members = signal<ReadonlyArray<AsRead.Member> | null>(null)
  const query = signal('')
  const reload = (): void => context.actions.listMembers({ done: (listed) => members.set(listed) })
  reload()
  context.actions.loadGroups()
  context.actions.loadPeople()
  const charactersOn = (): boolean => featureOn('characters', context.state.serverInfo.get())
  const model = (): AdminMembersModel =>
    adminMembersModel({
      members: members.get(),
      viewerId: me.member.id,
      charactersOn: charactersOn(),
      directory: context.state.directory.get(),
      groups: context.state.groups.get(),
      query: query.get(),
      now: context.clock.now(),
    })
  const search = h('input', {
    type: 'search',
    class: 'admin-member-search',
    placeholder: strings.adminMemberList.searchPlaceholder,
    on: { input: () => query.set(search.value) },
  })
  return h(
    'div',
    { class: 'admin-members' },
    showsInvites('admin', me, context.state.serverInfo.get()) && invitesSection(context, life),
    field(strings.adminMemberList.searchLabel, search),
    region(life, [members, query, context.state.directory, context.state.groups], () =>
      renderAdminMembers(model(), context, reload, charactersOn()),
    ),
  )
}

const renderAdminMembers = (
  model: AdminMembersModel,
  context: ViewContext,
  reload: () => void,
  charactersOn: boolean,
): HTMLElement => {
  if (model === null) return loading()
  if (model.noMatch !== null) return h('p', { class: 'hint admin-member-none' }, model.noMatch)
  return h(
    'ul',
    { class: 'members admin-member-list' },
    model.rows.map((row) =>
      h(
        'li',
        {
          class: `member is-${row.member.status}${row.dormant === null ? '' : ' is-dormant'}`,
          data: { memberId: row.member.id },
        },
        renderAvatar(context, memberAvatarOf(row.member, charactersOn)),
        h(
          'div',
          { class: 'member-main' },
          h('strong', { class: 'member-name' }, row.member.name, row.isYou && youMark()),
          h('span', { class: 'member-email' }, row.member.email),
          h(
            'span',
            { class: 'member-tags' },
            h('span', { class: row.role.className }, row.role.text),
            h('span', { class: row.status.className }, row.status.text),
            row.dormant !== null && h('span', { class: 'kind is-dormant' }, row.dormant),
            row.agent !== null &&
              h('span', { class: row.agent.className, title: row.agent.title }, row.agent.text),
            row.lastActive !== null &&
              h(
                'span',
                { class: 'member-last-active', title: row.lastActive.title ?? undefined },
                row.lastActive.text,
              ),
            row.groups !== null && h('span', { class: 'member-groups' }, row.groups),
          ),
        ),
        row.isYou
          ? h('p', { class: 'hint own-row-reason' }, strings.cannotChangeOwnRole)
          : h(
              'div',
              { class: 'member-actions' },
              row.actions.map((action) =>
                button(action.label, () => ACTIONS[action.kind](context, row.member, reload), {
                  ...(action.danger && { class: 'danger' }),
                }),
              ),
            ),
      ),
    ),
  )
}

const ACTIONS: Readonly<
  Record<MemberActionKind, (context: ViewContext, member: AsRead.Member, reload: () => void) => void>
> = {
  'make-member': (context, member, reload) =>
    context.actions.updateMember(member.id, { role: 'member' }, { done: reload }),
  'make-admin': (context, member, reload) =>
    context.actions.updateMember(member.id, { role: 'admin' }, { done: reload }),
  deactivate: (context, member, reload) => {
    const deactivate = (then: () => void): void =>
      context.actions.updateMember(member.id, { status: 'deactivated' }, { done: then })
    const warning = deactivationModel(member, context.state.groups.get())
    if (warning === null) return deactivate(reload)
    showDialog(context, warning.title, () =>
      h(
        'form',
        {
          class: 'dialog-body deactivate-form',
          on: {
            submit: (event) => {
              event.preventDefault()
              deactivate(() => {
                closeDialog(context)
                reload()
                context.actions.loadGroups()
              })
            },
          },
        },
        h('p', {}, warning.body),
        dialogActions(warning.confirm, 'danger'),
      ),
    )
  },
  reactivate: (context, member, reload) =>
    context.actions.updateMember(member.id, { status: 'active' }, { done: reload }),
  'reset-character': (context, member, reload) =>
    context.actions.resetMemberCharacter(member.id, {
      done: () => {
        context.state.notice.set({
          kind: 'info',
          text: strings.character.resetMemberDone({ name: member.name }),
        })
        reload()
      },
    }),
}
