import type { Channel, ChannelMember, MemberId } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, replaceChildren, signal } from '@homingbird/ui'
import {
  joinChannel,
  launch,
  leaveChannel,
  loadChannelMembers,
  setAnswering,
  setChannelManager,
  setChannelMember,
  setChannelVisibility,
} from '../actions.ts'
import { type Roster, channelLabel, isPrivate, rosterFacts } from '../channels.ts'
import { directory, members, signedIn } from '../state.ts'
import { strings } from '../strings.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { button, youMark } from './parts.ts'

export const rosters = signal<ReadonlyMap<string, Roster>>(new Map())

export const roomControls = (channel: Channel): HTMLElement => {
  const facts = rosterFacts(rosterOf(channel), signedIn()?.member.id ?? null)
  return h(
    'div',
    { class: 'room-controls' },
    channel.joined && answeringToggle(channel),
    h(
      'div',
      { class: 'room-actions' },
      channel.managing &&
        h(
          'button',
          {
            type: 'button',
            class: 'manage-members',
            ...opensDialog(strings.membersTitle({ channel: channelLabel(channel.slug) }), (life) =>
              membersPanel(life, channel),
            ),
          },
          strings.manageMembers,
        ),
      channel.joined &&
        (facts.viewerIsLastManager
          ? disabledWithReason(strings.leaveChannel, strings.lastManagerCannotLeave, 'leave-channel')
          : h(
              'button',
              {
                type: 'button',
                class: 'leave-channel',
                ...opensDialog(strings.leaveChannelTitle({ channel: channelLabel(channel.slug) }), () =>
                  leaveForm(channel),
                ),
              },
              strings.leaveChannel,
            )),
    ),
  )
}

export const privateMark = (channel: Channel): Child =>
  isPrivate(channel) &&
  h(
    'span',
    { class: 'private-mark' },
    h('span', { class: 'lock-mark', 'aria-hidden': 'true' }),
    strings.privateChannel,
  )

export const joinButtons = (channel: Channel): HTMLElement =>
  h(
    'span',
    { class: 'join-buttons' },
    button(strings.join, () => launch(joinChannel(channel.slug, false)), { class: 'join' }),
    button(strings.joinAndAnswer, () => launch(joinChannel(channel.slug, true)), {
      class: 'primary join-and-answer',
    }),
  )

export const answeringToggle = (channel: Channel): HTMLElement => {
  const labelId = `answering-label-${channel.slug}`
  const hintId = `answering-${channel.slug}`
  return h(
    'div',
    { class: 'answering-toggle' },
    h(
      'button',
      {
        type: 'button',
        class: 'switch',
        role: 'switch',
        'aria-checked': String(channel.answering),
        'aria-labelledby': labelId,
        'aria-describedby': hintId,
        on: { click: () => launch(setAnswering(channel.slug, !channel.answering)) },
      },
      h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-thumb' })),
      h('span', { class: 'switch-label', id: labelId }, strings.answerHere),
      h(
        'span',
        { class: 'switch-state', 'aria-hidden': 'true' },
        channel.answering ? strings.switchOn : strings.switchOff,
      ),
    ),
    h('small', { id: hintId }, strings.answerHereHint),
  )
}

const rosterOf = (channel: Channel): Roster | null => {
  if (!channel.managing || !channel.joined) return null
  const cached = rosters.get().get(channel.slug)
  if (cached?.memberCount !== channel.memberCount) refreshRoster(channel)
  return cached ?? null
}

const loading = new Set<string>()

const refreshRoster = (channel: Channel): void => {
  const key = `${channel.slug}:${channel.memberCount}`
  if (loading.has(key)) return
  loading.add(key)
  launch(loadChannelMembers(channel.slug), (found) => {
    loading.delete(key)
    remember(channel, found)
  })
}

const remember = (channel: Channel, found: ReadonlyArray<ChannelMember>): void =>
  rosters.update((all) => new Map(all).set(channel.slug, { memberCount: found.length, members: found }))

const disabledWithReason = (label: string, reason: string, kind: string): HTMLElement =>
  h(
    'span',
    { class: 'disabled-control' },
    h('button', { type: 'button', class: kind, disabled: true, 'aria-describedby': `${kind}-reason` }, label),
    h('small', { id: `${kind}-reason` }, reason),
  )

const leaveForm = (channel: Channel): Child =>
  h(
    'form',
    {
      class: 'dialog-body',
      on: {
        submit: (event) => {
          event.preventDefault()
          launch(leaveChannel(channel.slug), closeDialog, 'managers')
        },
      },
    },
    h('p', {}, leaveConsequence(channel)),
    dialogActions(strings.leaveChannel, 'danger'),
  )

const membersPanel = (life: Lifetime, channel: Channel): Child => {
  const listed = signal<ReadonlyArray<ChannelMember> | null>(null)
  const reload = (): void =>
    launch(loadChannelMembers(channel.slug), (found) => {
      listed.set(found)
      remember(channel, found)
    })
  const changing = (change: ReturnType<typeof setChannelMember>): void => launch(change, reload, 'managers')
  reload()
  const host = h('div', { class: 'dialog-body members-panel' })
  const confirm = (content: HTMLElement): void => replaceChildren(host, content)
  replaceChildren(
    host,
    signedIn()?.member.role === 'admin' &&
      !channel.joined &&
      h('p', { class: 'hint' }, strings.managedByAdmin),
    region(
      life,
      [listed, members, directory],
      () => {
        const roster = listed.get()
        if (roster === null) return h('p', { class: 'loading' }, strings.loading)
        const facts = rosterFacts(
          { memberCount: roster.length, members: roster },
          signedIn()?.member.id ?? null,
        )
        return [
          h(
            'ul',
            { class: 'channel-members' },
            roster.map((member) =>
              member.memberId === signedIn()?.member.id
                ? ownRow(channel, member, facts.viewerIsLastManager, confirm)
                : memberRow(
                    channel,
                    member,
                    facts.lastManagerId === member.memberId && roster.length > 1,
                    changing,
                  ),
            ),
          ),
          isPrivate(channel) && addMemberForm(channel, roster, changing),
          visibilitySwitch(channel, facts.hasManager, confirm),
        ]
      },
      { class: 'members-host' },
    ),
  )
  return host
}

const nameOf = (memberId: MemberId): string => members.get().get(memberId)?.name ?? strings.formerMember

const roleMarks = (member: ChannelMember): HTMLElement =>
  h(
    'span',
    { class: 'channel-member-roles' },
    member.manager && h('span', { class: 'kind is-manager' }, strings.managerLabel),
    member.answering && h('span', { class: 'kind is-helping' }, strings.answersLabel),
  )

const ownRow = (
  channel: Channel,
  member: ChannelMember,
  isLastManager: boolean,
  confirm: (content: HTMLElement) => void,
): HTMLElement =>
  h(
    'li',
    { class: 'channel-member is-self', data: { member: member.memberId } },
    h('span', { class: 'channel-member-name' }, nameOf(member.memberId), youMark()),
    roleMarks(member),
    h(
      'span',
      { class: 'channel-member-actions' },
      isLastManager
        ? h(
            'span',
            { class: 'disabled-control' },
            h(
              'span',
              { class: 'disabled-buttons' },
              h(
                'button',
                { type: 'button', class: 'step-down', disabled: true, 'aria-describedby': 'own-row-reason' },
                strings.stepDown,
              ),
              h(
                'button',
                { type: 'button', class: 'leave-own', disabled: true, 'aria-describedby': 'own-row-reason' },
                strings.leaveChannel,
              ),
            ),
            h('small', { id: 'own-row-reason' }, strings.lastManagerOwnRow),
          )
        : [
            member.manager &&
              button(strings.stepDown, () => confirm(stepDownConfirmation(channel, member.memberId)), {
                class: 'step-down',
              }),
            button(strings.leaveChannel, () => confirm(leaveConfirmation(channel)), {
              class: 'danger leave-own',
            }),
          ],
    ),
  )

const leaveConfirmation = (channel: Channel): HTMLElement =>
  h(
    'form',
    {
      class: 'self-confirmation',
      on: {
        submit: (event) => {
          event.preventDefault()
          launch(leaveChannel(channel.slug), closeDialog, 'managers')
        },
      },
    },
    h('h3', {}, strings.leaveChannelTitle({ channel: channelLabel(channel.slug) })),
    h('p', {}, leaveConsequence(channel)),
    dialogActions(strings.leaveChannel, 'danger'),
  )

const leaveConsequence = (channel: Channel): string =>
  isPrivate(channel)
    ? strings.leavePrivateChannelBody({ channel: channelLabel(channel.slug) })
    : strings.leaveChannelBody

const memberRow = (
  channel: Channel,
  member: ChannelMember,
  keepsTheChannelManaged: boolean,
  changing: (change: ReturnType<typeof setChannelMember>) => void,
): HTMLElement =>
  h(
    'li',
    { class: 'channel-member', data: { member: member.memberId } },
    h('span', { class: 'channel-member-name' }, nameOf(member.memberId)),
    roleMarks(member),
    h(
      'span',
      { class: 'channel-member-actions' },
      !keepsTheChannelManaged &&
        button(member.manager ? strings.revokeManager : strings.makeManager, () =>
          changing(setChannelManager(channel.slug, member.memberId, !member.manager)),
        ),
      isPrivate(channel) &&
        !keepsTheChannelManaged &&
        button(strings.removeMember, () => changing(setChannelMember(channel.slug, member.memberId, false)), {
          class: 'danger',
        }),
    ),
  )

const stepDownConfirmation = (channel: Channel, me: MemberId): HTMLElement =>
  h(
    'form',
    {
      class: 'self-confirmation',
      on: {
        submit: (event) => {
          event.preventDefault()
          launch(setChannelManager(channel.slug, me, false), closeDialog, 'managers')
        },
      },
    },
    h('h3', {}, strings.stepDownTitle({ channel: channelLabel(channel.slug) })),
    h('p', {}, strings.stepDownBody({ channel: channelLabel(channel.slug) })),
    dialogActions(strings.stepDown, 'danger'),
  )

const addMemberForm = (
  channel: Channel,
  roster: ReadonlyArray<ChannelMember>,
  changing: (change: ReturnType<typeof setChannelMember>) => void,
): HTMLElement => {
  const inside = new Set(roster.map((member) => member.memberId))
  const candidates = directory.get().filter((entry) => !inside.has(entry.member.id))
  if (candidates.length === 0) return h('p', { class: 'hint' }, strings.nobodyToAdd)
  const choice = h(
    'select',
    { name: 'member', 'aria-label': strings.addMemberLabel },
    candidates.map((entry) =>
      h('option', { value: entry.member.id }, `${entry.member.name} · ${entry.member.email}`),
    ),
  )
  return h(
    'form',
    {
      class: 'add-member',
      on: {
        submit: (event) => {
          event.preventDefault()
          changing(setChannelMember(channel.slug, choice.value as MemberId, true))
        },
      },
    },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, strings.addMemberLabel), choice),
    h('button', { type: 'submit', class: 'primary' }, strings.addMember),
  )
}

const visibilitySwitch = (
  channel: Channel,
  hasManager: boolean,
  confirm: (content: HTMLElement) => void,
): HTMLElement =>
  h(
    'div',
    { class: 'visibility-switch' },
    h('p', {}, isPrivate(channel) ? strings.visibilityPrivate : strings.visibilityOpen),
    isPrivate(channel)
      ? button(strings.makeOpen, () => confirm(visibilityConfirmation(channel)))
      : hasManager
        ? button(strings.makePrivate, () => confirm(visibilityConfirmation(channel)))
        : disabledWithReason(strings.makePrivate, strings.privateNeedsManager, 'make-private'),
  )

const visibilityConfirmation = (channel: Channel): HTMLElement => {
  const label = channelLabel(channel.slug)
  const toPrivate = !isPrivate(channel)
  return h(
    'form',
    {
      class: 'visibility-confirmation',
      on: {
        submit: (event) => {
          event.preventDefault()
          launch(
            setChannelVisibility(channel.slug, toPrivate ? 'private' : 'open'),
            closeDialog,
            'visibility',
          )
        },
      },
    },
    h(
      'h3',
      {},
      toPrivate ? strings.makePrivateTitle({ channel: label }) : strings.makeOpenTitle({ channel: label }),
    ),
    h(
      'p',
      {},
      toPrivate
        ? strings.makePrivateBody({ count: channel.memberCount, channel: label })
        : strings.makeOpenBody({ channel: label }),
    ),
    dialogActions(toPrivate ? strings.confirmMakePrivate : strings.confirmMakeOpen, 'danger'),
  )
}

const dialogActions = (label: string, kind: 'primary' | 'danger'): HTMLElement =>
  h(
    'div',
    { class: 'dialog-actions' },
    h('button', { type: 'button', ...closesDialog }, strings.cancel),
    h('button', { type: 'submit', class: kind }, label),
  )
