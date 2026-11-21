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
import { button, dialogActions, loading, youMark } from './parts.ts'

/** Administration → Members: every member, and their role and status to change. */
export const adminMembersSection = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const members = signal<ReadonlyArray<AsRead.Member> | null>(null)
  const reload = (): void => context.actions.listMembers({ done: (listed) => members.set(listed) })
  reload()
  context.actions.loadGroups()
  const charactersOn = (): boolean => featureOn('characters', context.state.serverInfo.get())
  return h(
    'div',
    { class: 'admin-members' },
    showsInvites('admin', me, context.state.serverInfo.get()) && invitesSection(context, life),
    region(life, [members], () =>
      renderAdminMembers(
        adminMembersModel(members.get(), me.member.id, charactersOn()),
        context,
        reload,
        charactersOn(),
      ),
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
  return h(
    'ul',
    { class: 'members admin-member-list' },
    model.map((row) =>
      h(
        'li',
        { class: `member is-${row.member.status}`, data: { memberId: row.member.id } },
        renderAvatar(context, memberAvatarOf(row.member, charactersOn)),
        h(
          'div',
          { class: 'member-main' },
          h('strong', {}, row.member.name, row.isYou && youMark()),
          h('span', { class: 'member-email' }, row.member.email),
          h(
            'span',
            { class: 'member-tags' },
            h('span', { class: row.role.className }, row.role.text),
            h('span', { class: row.status.className }, row.status.text),
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
