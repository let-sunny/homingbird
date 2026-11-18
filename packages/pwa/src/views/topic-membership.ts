import type { MemberId, Topic, TopicMember } from '@homingbird/protocol'
import { type Child, h, lifetime, region, replaceChildren, signal } from '@homingbird/ui'
import {
  joinTopic,
  launch,
  leaveTopic,
  loadTopicMembers,
  setAnswering,
  setTopicManager,
  setTopicMember,
  setTopicVisibility,
} from '../actions.ts'
import { directory, members, signedIn } from '../state.ts'
import { strings } from '../strings.ts'
import { isPrivate, topicLabel } from '../topics.ts'
import { DIALOG_ID, closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { button } from './parts.ts'

export const roomControls = (topic: Topic): HTMLElement =>
  h(
    'div',
    { class: 'room-controls' },
    topic.joined && answeringToggle(topic),
    h(
      'div',
      { class: 'room-actions' },
      topic.managing &&
        h(
          'button',
          {
            type: 'button',
            class: 'manage-members',
            ...opensDialog(strings.membersTitle({ topic: topicLabel(topic.slug) }), () =>
              membersPanel(topic),
            ),
          },
          strings.manageMembers,
        ),
      topic.joined &&
        h(
          'button',
          {
            type: 'button',
            class: 'leave-topic',
            ...opensDialog(strings.leaveTopicTitle({ topic: topicLabel(topic.slug) }), () =>
              leaveForm(topic),
            ),
          },
          strings.leaveTopic,
        ),
    ),
  )

export const privateMark = (topic: Topic): Child =>
  isPrivate(topic) &&
  h(
    'span',
    { class: 'private-mark' },
    h('span', { class: 'lock-mark', 'aria-hidden': 'true' }),
    strings.privateTopic,
  )

export const joinButtons = (topic: Topic): HTMLElement =>
  h(
    'span',
    { class: 'join-buttons' },
    button(strings.join, () => launch(joinTopic(topic.slug, false)), { class: 'join' }),
    button(strings.joinAndAnswer, () => launch(joinTopic(topic.slug, true)), {
      class: 'primary join-and-answer',
    }),
  )

export const answeringToggle = (topic: Topic): HTMLElement => {
  const toggle = h('input', {
    type: 'checkbox',
    role: 'switch',
    name: 'answering',
    checked: topic.answering,
    'aria-describedby': `answering-${topic.slug}`,
    on: { change: () => launch(setAnswering(topic.slug, toggle.checked)) },
  })
  return h(
    'div',
    { class: 'answering-toggle' },
    h('label', { class: 'switch' }, toggle, h('span', {}, strings.answerHere)),
    h('small', { id: `answering-${topic.slug}` }, strings.answerHereHint),
  )
}

const leaveForm = (topic: Topic): Child =>
  h(
    'form',
    {
      class: 'dialog-body',
      on: {
        submit: (event) => {
          event.preventDefault()
          launch(leaveTopic(topic.slug), closeDialog)
        },
      },
    },
    h(
      'p',
      {},
      isPrivate(topic)
        ? strings.leavePrivateTopicBody({ topic: topicLabel(topic.slug) })
        : strings.leaveTopicBody,
    ),
    dialogActions(strings.leaveTopic, 'danger'),
  )

const membersPanel = (topic: Topic): Child => {
  const listed = signal<ReadonlyArray<TopicMember> | null>(null)
  const reload = (): void => launch(loadTopicMembers(topic.slug), (found) => listed.set(found))
  const changing = (change: ReturnType<typeof setTopicMember>): void => launch(change, reload)
  reload()
  const life = lifetime()
  document.getElementById(DIALOG_ID)?.addEventListener('close', () => life.end(), { once: true })
  const host = h('div', { class: 'dialog-body members-panel' })
  replaceChildren(
    host,
    signedIn()?.member.role === 'admin' && !topic.joined && h('p', { class: 'hint' }, strings.managedByAdmin),
    region(
      life,
      [listed, members, directory],
      () => {
        const roster = listed.get()
        if (roster === null) return h('p', { class: 'loading' }, strings.loading)
        return [
          h(
            'ul',
            { class: 'topic-members' },
            roster.map((member) => memberRow(topic, member, isLastManager(roster, member), changing)),
          ),
          isPrivate(topic) && addMemberForm(topic, roster, changing),
        ]
      },
      { class: 'members-host' },
    ),
    visibilitySwitch(topic, host),
  )
  return host
}

const memberRow = (
  topic: Topic,
  member: TopicMember,
  keepsTheTopicManaged: boolean,
  changing: (change: ReturnType<typeof setTopicMember>) => void,
): HTMLElement =>
  h(
    'li',
    { class: 'topic-member', data: { member: member.memberId } },
    h(
      'span',
      { class: 'topic-member-name' },
      members.get().get(member.memberId)?.name ?? strings.formerMember,
      member.memberId === signedIn()?.member.id && h('small', { class: 'is-you' }, strings.you),
    ),
    h(
      'span',
      { class: 'topic-member-roles' },
      member.manager && h('span', { class: 'kind is-manager' }, strings.managerLabel),
      member.answering && h('span', { class: 'kind is-helping' }, strings.answersLabel),
    ),
    h(
      'span',
      { class: 'topic-member-actions' },
      !keepsTheTopicManaged &&
        button(member.manager ? strings.revokeManager : strings.makeManager, () =>
          changing(setTopicManager(topic.slug, member.memberId, !member.manager)),
        ),
      isPrivate(topic) &&
        !keepsTheTopicManaged &&
        button(strings.removeMember, () => changing(setTopicMember(topic.slug, member.memberId, false)), {
          class: 'danger',
        }),
    ),
  )

const isLastManager = (roster: ReadonlyArray<TopicMember>, member: TopicMember): boolean =>
  member.manager && roster.length > 1 && roster.filter((each) => each.manager).length === 1

const addMemberForm = (
  topic: Topic,
  roster: ReadonlyArray<TopicMember>,
  changing: (change: ReturnType<typeof setTopicMember>) => void,
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
          changing(setTopicMember(topic.slug, choice.value as MemberId, true))
        },
      },
    },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, strings.addMemberLabel), choice),
    h('button', { type: 'submit', class: 'primary' }, strings.addMember),
  )
}

const visibilitySwitch = (topic: Topic, host: HTMLElement): HTMLElement =>
  h(
    'div',
    { class: 'visibility-switch' },
    h('p', {}, isPrivate(topic) ? strings.visibilityPrivate : strings.visibilityOpen),
    button(isPrivate(topic) ? strings.makeOpen : strings.makePrivate, () =>
      replaceChildren(host, visibilityConfirmation(topic)),
    ),
  )

const visibilityConfirmation = (topic: Topic): HTMLElement => {
  const label = topicLabel(topic.slug)
  const toPrivate = !isPrivate(topic)
  return h(
    'form',
    {
      class: 'visibility-confirmation',
      on: {
        submit: (event) => {
          event.preventDefault()
          launch(setTopicVisibility(topic.slug, toPrivate ? 'private' : 'open'), closeDialog)
        },
      },
    },
    h(
      'h3',
      {},
      toPrivate ? strings.makePrivateTitle({ topic: label }) : strings.makeOpenTitle({ topic: label }),
    ),
    h(
      'p',
      {},
      toPrivate
        ? strings.makePrivateBody({ count: topic.memberCount, topic: label })
        : strings.makeOpenBody({ topic: label }),
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
