import type { AsRead, ChannelMember, GroupId, MemberId } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, replaceChildren, signal } from '@homingbird/ui'
import { isPrivate } from '../channels.ts'
import { featureOn } from '../features.ts'
import {
  type Choice,
  type Confirmation,
  type MemberRow,
  type MembersPanelModel,
  type RoomControls,
  answeringModel,
  membersPanelModel,
  roomControlsModel,
  rosterNeed,
} from '../models/channel-membership.ts'
import { signedIn } from '../state.ts'
import { strings } from '../strings.ts'
import { agentButtons } from './channel-agent.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, opensDialog } from './dialog.ts'
import { button, dialogActions, disabledWithReason, loading, privateMarkOf, youMark } from './parts.ts'

/** A channel's own controls: answering there, managing its members, and leaving it. */
export const roomControls = (context: ViewContext, channel: AsRead.Channel): HTMLElement => {
  const { state } = context
  const need = rosterNeed(channel, state.rosters.get())
  if (need.stale) refreshRoster(context, channel)
  return renderRoomControls(
    roomControlsModel(
      channel,
      need.roster,
      signedIn(state)?.member.id ?? null,
      signedIn(state)?.member.role === 'admin',
    ),
    channel,
    context,
  )
}

/** The lock beside a private channel's name. */
export const privateMark = (channel: AsRead.Channel): Child =>
  isPrivate(channel) && privateMarkOf(strings.privateChannel)

export const joinButtons = (context: ViewContext, channel: AsRead.Channel): HTMLElement =>
  h(
    'span',
    { class: 'join-buttons' },
    button(strings.join, () => context.actions.joinChannel(channel.slug, false), { class: 'join' }),
    button(strings.joinAndAnswer, () => context.actions.joinChannel(channel.slug, true), {
      class: 'primary join-and-answer',
    }),
  )

export const answeringToggle = (context: ViewContext, channel: AsRead.Channel): HTMLElement => {
  const model = answeringModel(channel)
  return h(
    'div',
    { class: 'answering-toggle' },
    h(
      'button',
      {
        type: 'button',
        class: 'switch',
        role: 'switch',
        'aria-checked': String(model.checked),
        'aria-labelledby': model.labelId,
        'aria-describedby': model.hintId,
        on: { click: () => context.actions.setAnswering(channel.slug, !channel.answering) },
      },
      h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-thumb' })),
      h('span', { class: 'switch-label', id: model.labelId }, strings.answerHere),
      h('span', { class: 'switch-state', 'aria-hidden': 'true' }, model.state),
    ),
    h('small', { id: model.hintId }, strings.answerHereHint),
  )
}

const refreshRoster = (context: ViewContext, channel: AsRead.Channel): void => {
  const key = `${channel.slug}:${channel.memberCount}`
  const loading = context.state.rostersLoading
  if (loading.has(key)) return
  loading.add(key)
  context.actions.loadChannelMembers(channel.slug, { done: () => loading.delete(key) })
}

const leaveForm = (context: ViewContext, channel: AsRead.Channel, body: string): Child =>
  h(
    'form',
    {
      class: 'dialog-body',
      on: {
        submit: (event) => {
          event.preventDefault()
          context.actions.leaveChannel(channel.slug, {
            done: () => closeDialog(context),
            attempt: 'managers',
          })
        },
      },
    },
    h('p', {}, body),
    dialogActions(strings.leaveChannel, 'danger'),
  )

const membersPanel = (context: ViewContext, life: Lifetime, channel: AsRead.Channel): Child => {
  const { state, actions } = context
  const listed = signal<ReadonlyArray<ChannelMember> | null>(null)
  const reload = (): void => actions.loadChannelMembers(channel.slug, { done: (found) => listed.set(found) })
  const changes = { done: reload, attempt: 'managers' as const }
  reload()
  actions.loadGroups()
  const host = h('div', { class: 'dialog-body members-panel' })
  const confirm = (content: HTMLElement): void => replaceChildren(host, content)
  const model = (): MembersPanelModel => {
    const me = signedIn(state)
    return membersPanelModel({
      channel,
      roster: listed.get(),
      viewerId: me?.member.id ?? null,
      viewerIsAdmin: me?.member.role === 'admin',
      members: state.members.get(),
      directory: state.directory.get(),
      groups: state.groups.get(),
      groupsOn: featureOn('groups', state.serverInfo.get()),
    })
  }
  const panel = {
    confirm,
    addTeam: (groupId: GroupId) => actions.addTeam(channel.slug, groupId, changes),
    setManagers: (groupId: GroupId, memberIds: ReadonlyArray<MemberId>) =>
      actions.setGroupMembers(groupId, memberIds, changes),
    setMember: (memberId: MemberId, isMember: boolean) =>
      actions.setChannelMember(channel.slug, memberId, isMember, changes),
  }
  const shown = model()
  replaceChildren(
    host,
    shown.managedByAdmin !== null && h('p', { class: 'hint' }, shown.managedByAdmin),
    region(
      life,
      [listed, state.members, state.directory, state.groups],
      () => renderMembers(model(), context, channel, panel),
      {
        class: 'members-host',
      },
    ),
  )
  return host
}

interface Panel {
  readonly confirm: (content: HTMLElement) => void
  readonly addTeam: (groupId: GroupId) => void
  readonly setManagers: (groupId: GroupId, memberIds: ReadonlyArray<MemberId>) => void
  readonly setMember: (memberId: MemberId, isMember: boolean) => void
}

const renderMembers = (
  model: MembersPanelModel,
  context: ViewContext,
  channel: AsRead.Channel,
  panel: Panel,
): Child => {
  const managing = model.managedBy !== null && h('p', { class: 'managed-by' }, model.managedBy.text)
  if (model.rows === null) return [managing, loading()]
  const addManager = model.addManager
  return [
    managing,
    addManager !== null &&
      choiceForm('add-manager', addManager, (memberId) =>
        panel.setManagers(addManager.groupId, [...addManager.memberIds, memberId]),
      ),
    model.addTeam !== null &&
      choiceForm('add-team', model.addTeam, (groupId) => panel.addTeam(groupId), model.addTeam.hint),
    h(
      'ul',
      { class: 'channel-members' },
      model.rows.map((row) =>
        row.kind === 'own' ? ownRow(row, context, channel, panel) : memberRow(row, panel),
      ),
    ),
    model.addMember?.kind === 'nobody' && h('p', { class: 'hint' }, model.addMember.text),
    model.addMember?.kind === 'choose' && addMemberForm(model.addMember.choices, panel),
    model.visibility !== null && h('p', { class: 'visibility' }, model.visibility),
  ]
}

const roleMarks = (row: MemberRow): HTMLElement =>
  h(
    'span',
    { class: 'channel-member-roles' },
    row.roles.map((role) => h('span', { class: role.className }, role.text)),
  )

const ownRow = (
  row: Extract<MemberRow, { kind: 'own' }>,
  context: ViewContext,
  channel: AsRead.Channel,
  panel: Panel,
): HTMLElement =>
  h(
    'li',
    { class: 'channel-member is-self', data: { member: row.memberId } },
    h('span', { class: 'channel-member-name' }, row.name, youMark()),
    roleMarks(row),
    h(
      'span',
      { class: 'channel-member-actions' },
      unmanageButton(row, panel),
      row.blocked !== null
        ? disabledWithReason(strings.leaveChannel, row.blocked, 'leave-own')
        : button(
            strings.leaveChannel,
            () =>
              panel.confirm(
                confirmation('self-confirmation', row.leave, () =>
                  context.actions.leaveChannel(channel.slug, {
                    done: () => closeDialog(context),
                    attempt: 'managers',
                  }),
                ),
              ),
            { class: 'danger leave-own' },
          ),
    ),
  )

const memberRow = (row: Extract<MemberRow, { kind: 'other' }>, panel: Panel): HTMLElement =>
  h(
    'li',
    { class: 'channel-member', data: { member: row.memberId } },
    h('span', { class: 'channel-member-name' }, row.name),
    roleMarks(row),
    h(
      'span',
      { class: 'channel-member-actions' },
      unmanageButton(row, panel),
      row.remove !== null &&
        button(row.remove, () => panel.setMember(row.memberId, false), { class: 'danger' }),
    ),
  )

const unmanageButton = (row: MemberRow, panel: Panel): Child => {
  const unmanage = row.unmanage
  return (
    unmanage !== null &&
    button(unmanage.label, () => panel.setManagers(unmanage.groupId, unmanage.memberIds), {
      class: 'unmanage',
    })
  )
}

const confirmation = (className: string, words: Confirmation, confirm: () => void): HTMLElement =>
  h(
    'form',
    {
      class: className,
      on: {
        submit: (event) => {
          event.preventDefault()
          confirm()
        },
      },
    },
    h('h3', {}, words.title),
    h('p', {}, words.body),
    dialogActions(words.confirm, 'danger'),
  )

const choiceForm = <A extends string>(
  className: string,
  offer: Choice<A>,
  choose: (value: A) => void,
  hint: string | null = null,
): HTMLElement => {
  const choice = h(
    'select',
    { name: 'choice', 'aria-label': offer.label },
    offer.choices.map((one) => h('option', { value: one.value }, one.label)),
  )
  return h(
    'form',
    {
      class: className,
      on: {
        submit: (event) => {
          event.preventDefault()
          choose(choice.value as A)
        },
      },
    },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, offer.label), choice),
    hint !== null && h('p', { class: 'hint' }, hint),
    h('button', { type: 'submit' }, offer.label),
  )
}

const addMemberForm = (
  choices: ReadonlyArray<{ readonly value: MemberId; readonly label: string }>,
  panel: Panel,
): HTMLElement => {
  const choice = h(
    'select',
    { name: 'member', 'aria-label': strings.addMemberLabel },
    choices.map((one) => h('option', { value: one.value }, one.label)),
  )
  return h(
    'form',
    {
      class: 'add-member',
      on: {
        submit: (event) => {
          event.preventDefault()
          panel.setMember(choice.value as MemberId, true)
        },
      },
    },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, strings.addMemberLabel), choice),
    h('button', { type: 'submit', class: 'primary' }, strings.addMember),
  )
}

const renderRoomControls = (
  model: RoomControls,
  channel: AsRead.Channel,
  context: ViewContext,
): HTMLElement =>
  h(
    'div',
    { class: 'room-controls' },
    model.answering !== null && answeringToggle(context, channel),
    h(
      'div',
      { class: 'room-actions' },
      model.manage !== null &&
        h(
          'button',
          {
            type: 'button',
            class: 'manage-members',
            ...opensDialog(context, model.manage, (life) => membersPanel(context, life, channel)),
          },
          strings.manageMembers,
        ),
      agentButtons(context, channel),
      model.leave?.kind === 'blocked' &&
        disabledWithReason(strings.leaveChannel, model.leave.reason, 'leave-channel'),
      model.leave?.kind === 'allowed' &&
        h(
          'button',
          {
            type: 'button',
            class: 'leave-channel',
            ...opensDialog(context, model.leave.title, () => leaveForm(context, channel, model.leaveBody)),
          },
          strings.leaveChannel,
        ),
    ),
  )
