import type { AsRead, ChannelMember, GroupId, MemberId } from '@homingbird/protocol'
import {
  type Child,
  type Lifetime,
  type ReadableSignal,
  h,
  onAnyChange,
  replaceChildren,
  signal,
  slice,
} from '@homingbird/ui'
import { isPrivate } from '../channels.ts'
import { featureOn } from '../features.ts'
import { groupById } from '../groups.ts'
import {
  type AnsweringModel,
  type Choice,
  type Confirmation,
  type MemberRow,
  type MembersPanelModel,
  type RoomControls,
  answeredByAgent,
  answeringModel,
  membersPanelModel,
  roomControlsModel,
  rosterNeed,
} from '../models/channel-membership.ts'
import { hrefFor } from '../routes.ts'
import { signedIn } from '../state.ts'
import { strings } from '../strings.ts'
import { type Block, blocks } from './blocks.ts'
import { agentButtons } from './channel-agent.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, opensDialog } from './dialog.ts'
import { hinted } from './hint.ts'
import {
  type Unsaved,
  button,
  chosenIn,
  copyWithNotice,
  dialogActions,
  disabledWithReason,
  keepChoice,
  loading,
  privateMarkOf,
  youMark,
} from './parts.ts'
import { peoplePicker } from './people-picker.ts'
import { profileName } from './profile-card.ts'

/** A channel's own controls on its page: answering there, and the menu of the rest. */
export const roomControls = (context: ViewContext, channel: AsRead.Channel): HTMLElement => {
  const note = channel.joined ? answeredByAgent(channel) : null
  return h(
    'div',
    { class: 'room-controls' },
    answeringChip(context, channel),
    roomMenu(context, channel),
    note !== null && h('p', { class: 'trust-footnote answering-agent-note' }, note),
  )
}

/** The answering switch of a channel the person is in, as a chip, and a "?" that explains it underneath. */
export const answeringChip = (context: ViewContext, channel: AsRead.Channel): Child => {
  if (!channel.joined) return null
  const model = answeringModel(channel)
  return [answeringSwitch(context, channel, model), answeringHelp(model)]
}

const answeringSwitch = (context: ViewContext, channel: AsRead.Channel, model: AnsweringModel): HTMLElement =>
  h(
    'button',
    {
      type: 'button',
      class: 'switch answering-chip',
      role: 'switch',
      title: model.agentNote ?? model.hint,
      'aria-checked': String(model.checked),
      'aria-labelledby': model.labelId,
      'aria-describedby': model.hintId,
      on: { click: () => context.actions.setAnswering(channel.slug, !channel.answering) },
    },
    h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-thumb' })),
    h('span', { class: 'switch-label', id: model.labelId }, model.label),
    h('span', { class: 'switch-state', 'aria-hidden': 'true' }, model.state),
    h('span', { id: model.hintId, hidden: true }, model.agentNote ?? model.hint),
  )

const answeringHelp = (model: AnsweringModel): Child => {
  const id = `${model.hintId}-help`
  return [
    h(
      'button',
      { type: 'button', class: 'answering-help', popovertarget: id, 'aria-label': model.helpLabel },
      '?',
    ),
    h(
      'div',
      { id, class: 'menu answering-explained', popover: 'auto' },
      model.agentNote !== null && h('p', {}, model.agentNote),
      h('p', {}, model.hint),
    ),
  ]
}

/** A channel's other controls behind ⋯: managing its members, its agent, and leaving it. */
export const roomMenu = (context: ViewContext, channel: AsRead.Channel): Child => {
  const { state } = context
  const need = rosterNeed(channel, state.rosters.get())
  if (need.stale) refreshRoster(context, channel)
  const model = roomControlsModel(
    channel,
    need.roster,
    signedIn(state)?.member.id ?? null,
    signedIn(state)?.member.role === 'admin',
  )
  return renderRoomMenu(model, channel, context)
}

/** The lock beside a private channel's name. */
export const privateMark = (channel: AsRead.Channel): Child =>
  isPrivate(channel) && privateMarkOf(strings.privateChannel)

export const joinButtons = (context: ViewContext, channel: AsRead.Channel): Child => {
  const note = answeredByAgent(channel)
  return [
    h(
      'span',
      { class: 'join-buttons' },
      button(strings.join, () => context.actions.joinChannel(channel.slug, false), { class: 'join' }),
      button(strings.joinAndAnswer, () => context.actions.joinChannel(channel.slug, true), {
        class: 'primary join-and-answer',
      }),
    ),
    note !== null && h('p', { class: 'trust-footnote answering-agent-note' }, note),
  ]
}

/** Confirms leaving a channel, from its room's menu or its row's. */
export const leaveForm = (context: ViewContext, slug: string, body: string): Child =>
  h(
    'form',
    {
      class: 'dialog-body',
      on: {
        submit: (event) => {
          event.preventDefault()
          context.actions.leaveChannel(slug, {
            done: () => closeDialog(context),
            attempt: 'leave',
          })
        },
      },
    },
    h('p', {}, body),
    dialogActions(strings.leaveChannel, 'danger'),
  )

const refreshRoster = (context: ViewContext, channel: AsRead.Channel): void => {
  const key = `${channel.slug}:${channel.memberCount}`
  const loading = context.state.rostersLoading
  if (loading.has(key)) return
  loading.add(key)
  context.actions.loadChannelMembers(channel.slug, { done: () => loading.delete(key) })
}

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
  const adding = signal<ReadonlyArray<MemberId>>([])
  const picker = peoplePicker(life, {
    id: `add-member-${channel.slug}`,
    label: strings.addMemberLabel,
    placeholder: strings.newMessage.placeholder,
    candidates: () => {
      const offer = model().addMember
      return offer?.kind === 'choose' ? offer.candidates : []
    },
    sources: [listed, state.directory],
    chosen: adding,
    limit: null,
  })
  const panel = {
    confirm,
    picker: picker.element,
    adding,
    addChosen: () => {
      const chosen = adding.get()
      adding.set([])
      for (const memberId of chosen) actions.setChannelMember(channel.slug, memberId, true, changes)
    },
    back: () => back(),
    unsaved: new Map<string, string>(),
    addTeam: (groupId: GroupId) => actions.addTeam(channel.slug, groupId, changes),
    changeManagers: (groupId: GroupId, change: (now: ReadonlyArray<MemberId>) => ReadonlyArray<MemberId>) => {
      const group = groupById(state.groups.get(), groupId)
      if (group !== null) actions.setGroupMembers(groupId, change(group.memberIds), changes)
    },
    setMember: (memberId: MemberId, isMember: boolean) =>
      actions.setChannelMember(channel.slug, memberId, isMember, changes),
  }
  const shown = model()
  const now = slice([listed, state.members, state.directory, state.groups], model)
  const body = [
    shown.managedByAdmin !== null && h('p', { class: 'hint' }, shown.managedByAdmin),
    blocks(life, h('div', { class: 'members-host' }), now, () =>
      memberBlocks(model(), context, channel, panel),
    ),
  ]
  const back = (): void => replaceChildren(host, ...body)
  back()
  return host
}

interface Panel {
  readonly confirm: (content: HTMLElement) => void
  /** Shows the members again after a confirmation that keeps the panel open. */
  readonly back: () => void
  /** What is chosen and not yet added, so that it survives a redraw. */
  readonly unsaved: Unsaved
  readonly addTeam: (groupId: GroupId) => void
  /** Changes the managers there are when it is called, which may not be those shown when it was offered. */
  readonly changeManagers: (
    groupId: GroupId,
    change: (now: ReadonlyArray<MemberId>) => ReadonlyArray<MemberId>,
  ) => void
  readonly setMember: (memberId: MemberId, isMember: boolean) => void
  /** The people picker for adding members, made once so what is typed in it survives a redraw. */
  readonly picker: HTMLElement
  readonly adding: ReadableSignal<ReadonlyArray<MemberId>>
  readonly addChosen: () => void
}

const memberBlocks = (
  model: MembersPanelModel,
  context: ViewContext,
  channel: AsRead.Channel,
  panel: Panel,
): ReadonlyArray<Block | null> => {
  const { managedBy, addManager, addTeam, addMember, rows, visibility } = model
  const block = (key: string, from: unknown, draw: (drawing: Lifetime) => HTMLElement): Block => ({
    key,
    from,
    draw,
  })
  const managing =
    managedBy === null
      ? null
      : block('managed-by', managedBy, () =>
          h(
            'div',
            { class: 'managed-by-host' },
            ...hinted(
              context,
              'channelManagers',
              strings.hints.channelManagers,
              h('p', { class: 'managed-by' }, managedBy.text),
            ),
          ),
        )
  if (rows === null) return [managing, block('loading', null, loading)]
  return [
    managing,
    addManager &&
      block('add-manager', [addManager.groupId, addManager.label, addManager.choices], () =>
        choiceForm(context, 'add-manager', addManager, panel.unsaved, (memberId) =>
          panel.changeManagers(addManager.groupId, (now) => [...now, memberId]),
        ),
      ),
    addTeam &&
      block('add-team', addTeam, () =>
        choiceForm(
          context,
          'add-team',
          addTeam,
          panel.unsaved,
          (groupId) => panel.addTeam(groupId),
          addTeam.hint,
        ),
      ),
    block('rows', rows, () =>
      h(
        'ul',
        { class: 'channel-members' },
        rows.map((row) =>
          row.kind === 'own' ? ownRow(row, context, channel, panel) : memberRow(row, panel),
        ),
      ),
    ),
    addMember?.kind === 'nobody'
      ? block('nobody', addMember.text, () => h('p', { class: 'hint' }, addMember.text))
      : null,
    addMember?.kind === 'choose'
      ? block('add-member', null, (drawing) => addMemberForm(panel, drawing))
      : null,
    visibility === null
      ? null
      : block('visibility', visibility, () => h('p', { class: 'visibility' }, visibility)),
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
    h('span', { class: 'channel-member-name' }, profileName(row.memberId, row.name), youMark()),
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
                    attempt: 'leave',
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
    h('span', { class: 'channel-member-name' }, profileName(row.memberId, row.name)),
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
    button(
      unmanage.label,
      () =>
        panel.confirm(
          confirmation('unmanage-confirmation', unmanage.confirm, () => {
            panel.back()
            panel.changeManagers(unmanage.groupId, (now) => now.filter((one) => one !== row.memberId))
          }),
        ),
      { class: 'unmanage' },
    )
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
  context: ViewContext,
  className: string,
  offer: Choice<A>,
  unsaved: Unsaved,
  choose: (value: A) => void,
  hint: string | null = null,
): HTMLElement => {
  const choice = h(
    'select',
    { name: 'choice', 'aria-label': offer.label },
    offer.choices.map((one) => h('option', { value: one.value }, one.label)),
  )
  keepChoice(unsaved, className, choice)
  return h(
    'form',
    {
      class: className,
      on: {
        submit: (event) => {
          event.preventDefault()
          const chosen = chosenIn(context, choice)
          if (chosen !== null) choose(chosen as A)
        },
      },
    },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, offer.label), choice),
    hint !== null && h('p', { class: 'hint' }, hint),
    h('button', { type: 'submit' }, offer.label),
  )
}

/** Adds everyone chosen in the picker at once; the button waits until someone is chosen. */
const addMemberForm = (panel: Panel, drawing: Lifetime): HTMLElement => {
  const add = h('button', { type: 'submit', class: 'primary' }, strings.addMember)
  const reflect = (): void => {
    add.disabled = panel.adding.get().length === 0
  }
  reflect()
  drawing.add(onAnyChange([panel.adding], reflect))
  return h(
    'form',
    {
      class: 'add-member',
      on: {
        submit: (event) => {
          event.preventDefault()
          panel.addChosen()
        },
      },
    },
    panel.picker,
    add,
  )
}

const renderRoomMenu = (model: RoomControls, channel: AsRead.Channel, context: ViewContext): Child => {
  const menu = h(
    'div',
    {
      id: model.more.id,
      class: 'menu room-menu',
      popover: 'auto',
      'aria-label': model.more.label,
      on: { click: (event) => closeAfterChoice(menu, event) },
    },
    h('p', { class: 'menu-who room-description' }, model.description),
    model.manage !== null &&
      h(
        'button',
        {
          type: 'button',
          class: 'menu-item manage-members',
          ...opensDialog(context, model.manage, (life) => membersPanel(context, life, channel)),
        },
        strings.manageMembers,
      ),
    h(
      'button',
      {
        type: 'button',
        class: 'menu-item copy-channel-link',
        on: {
          click: () =>
            copyWithNotice(
              context,
              context.page.linkTo(hrefFor({ name: 'channel', slug: channel.slug })),
              strings.channelLinkCopied,
            ),
        },
      },
      strings.copyChannelLink,
    ),
    agentButtons(context, channel),
    model.leave?.kind === 'blocked' &&
      disabledWithReason(strings.leaveChannel, model.leave.reason, 'leave-channel'),
    model.leave?.kind === 'allowed' &&
      h(
        'button',
        {
          type: 'button',
          class: 'menu-item danger leave-channel',
          ...opensDialog(context, model.leave.title, () => leaveForm(context, channel.slug, model.leaveBody)),
        },
        strings.leaveChannel,
      ),
  )
  return [
    h(
      'button',
      { type: 'button', class: 'room-more', popovertarget: model.more.id, 'aria-label': model.more.label },
      '⋯',
    ),
    menu,
  ]
}

/** A choice in the menu closes it; a dialog it opens closes it anyway, an action that goes elsewhere does not. */
const closeAfterChoice = (menu: HTMLElement, event: Event): void => {
  const chosen = (event.target as Element).closest('button')
  if (chosen === null || chosen.disabled || !('hidePopover' in menu)) return
  if (menu.matches(':popover-open')) menu.hidePopover()
}
