import type { MemberId, Topic, TopicMember } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, replaceChildren, signal } from '@homingbird/ui'
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
import { type Roster, isPrivate, rosterFacts, topicLabel } from '../topics.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { button, youMark } from './parts.ts'

export const rosters = signal<ReadonlyMap<string, Roster>>(new Map())

export const roomControls = (topic: Topic): HTMLElement => {
  const facts = rosterFacts(rosterOf(topic), signedIn()?.member.id ?? null)
  return h(
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
            ...opensDialog(strings.membersTitle({ topic: topicLabel(topic.slug) }), (life) =>
              membersPanel(life, topic),
            ),
          },
          strings.manageMembers,
        ),
      topic.joined &&
        (facts.viewerIsLastManager
          ? disabledWithReason(strings.leaveTopic, strings.lastManagerCannotLeave, 'leave-topic')
          : h(
              'button',
              {
                type: 'button',
                class: 'leave-topic',
                ...opensDialog(strings.leaveTopicTitle({ topic: topicLabel(topic.slug) }), () =>
                  leaveForm(topic),
                ),
              },
              strings.leaveTopic,
            )),
    ),
  )
}

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
  const labelId = `answering-label-${topic.slug}`
  const hintId = `answering-${topic.slug}`
  return h(
    'div',
    { class: 'answering-toggle' },
    h(
      'button',
      {
        type: 'button',
        class: 'switch',
        role: 'switch',
        'aria-checked': String(topic.answering),
        'aria-labelledby': labelId,
        'aria-describedby': hintId,
        on: { click: () => launch(setAnswering(topic.slug, !topic.answering)) },
      },
      h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-thumb' })),
      h('span', { class: 'switch-label', id: labelId }, strings.answerHere),
      h(
        'span',
        { class: 'switch-state', 'aria-hidden': 'true' },
        topic.answering ? strings.switchOn : strings.switchOff,
      ),
    ),
    h('small', { id: hintId }, strings.answerHereHint),
  )
}

const rosterOf = (topic: Topic): Roster | null => {
  if (!topic.managing || !topic.joined) return null
  const cached = rosters.get().get(topic.slug)
  if (cached?.memberCount !== topic.memberCount) refreshRoster(topic)
  return cached ?? null
}

const loading = new Set<string>()

const refreshRoster = (topic: Topic): void => {
  const key = `${topic.slug}:${topic.memberCount}`
  if (loading.has(key)) return
  loading.add(key)
  launch(loadTopicMembers(topic.slug), (found) => {
    loading.delete(key)
    remember(topic, found)
  })
}

const remember = (topic: Topic, found: ReadonlyArray<TopicMember>): void =>
  rosters.update((all) => new Map(all).set(topic.slug, { memberCount: found.length, members: found }))

const disabledWithReason = (label: string, reason: string, kind: string): HTMLElement =>
  h(
    'span',
    { class: 'disabled-control' },
    h('button', { type: 'button', class: kind, disabled: true, 'aria-describedby': `${kind}-reason` }, label),
    h('small', { id: `${kind}-reason` }, reason),
  )

const leaveForm = (topic: Topic): Child =>
  h(
    'form',
    {
      class: 'dialog-body',
      on: {
        submit: (event) => {
          event.preventDefault()
          launch(leaveTopic(topic.slug), closeDialog, 'managers')
        },
      },
    },
    h('p', {}, leaveConsequence(topic)),
    dialogActions(strings.leaveTopic, 'danger'),
  )

const membersPanel = (life: Lifetime, topic: Topic): Child => {
  const listed = signal<ReadonlyArray<TopicMember> | null>(null)
  const reload = (): void =>
    launch(loadTopicMembers(topic.slug), (found) => {
      listed.set(found)
      remember(topic, found)
    })
  const changing = (change: ReturnType<typeof setTopicMember>): void => launch(change, reload, 'managers')
  reload()
  const host = h('div', { class: 'dialog-body members-panel' })
  const confirm = (content: HTMLElement): void => replaceChildren(host, content)
  replaceChildren(
    host,
    signedIn()?.member.role === 'admin' && !topic.joined && h('p', { class: 'hint' }, strings.managedByAdmin),
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
            { class: 'topic-members' },
            roster.map((member) =>
              member.memberId === signedIn()?.member.id
                ? ownRow(topic, member, facts.viewerIsLastManager, confirm)
                : memberRow(
                    topic,
                    member,
                    facts.lastManagerId === member.memberId && roster.length > 1,
                    changing,
                  ),
            ),
          ),
          isPrivate(topic) && addMemberForm(topic, roster, changing),
          visibilitySwitch(topic, facts.hasManager, confirm),
        ]
      },
      { class: 'members-host' },
    ),
  )
  return host
}

const nameOf = (memberId: MemberId): string => members.get().get(memberId)?.name ?? strings.formerMember

const roleMarks = (member: TopicMember): HTMLElement =>
  h(
    'span',
    { class: 'topic-member-roles' },
    member.manager && h('span', { class: 'kind is-manager' }, strings.managerLabel),
    member.answering && h('span', { class: 'kind is-helping' }, strings.answersLabel),
  )

const ownRow = (
  topic: Topic,
  member: TopicMember,
  isLastManager: boolean,
  confirm: (content: HTMLElement) => void,
): HTMLElement =>
  h(
    'li',
    { class: 'topic-member is-self', data: { member: member.memberId } },
    h('span', { class: 'topic-member-name' }, nameOf(member.memberId), youMark()),
    roleMarks(member),
    h(
      'span',
      { class: 'topic-member-actions' },
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
                strings.leaveTopic,
              ),
            ),
            h('small', { id: 'own-row-reason' }, strings.lastManagerOwnRow),
          )
        : [
            member.manager &&
              button(strings.stepDown, () => confirm(stepDownConfirmation(topic, member.memberId)), {
                class: 'step-down',
              }),
            button(strings.leaveTopic, () => confirm(leaveConfirmation(topic)), {
              class: 'danger leave-own',
            }),
          ],
    ),
  )

const leaveConfirmation = (topic: Topic): HTMLElement =>
  h(
    'form',
    {
      class: 'self-confirmation',
      on: {
        submit: (event) => {
          event.preventDefault()
          launch(leaveTopic(topic.slug), closeDialog, 'managers')
        },
      },
    },
    h('h3', {}, strings.leaveTopicTitle({ topic: topicLabel(topic.slug) })),
    h('p', {}, leaveConsequence(topic)),
    dialogActions(strings.leaveTopic, 'danger'),
  )

const leaveConsequence = (topic: Topic): string =>
  isPrivate(topic) ? strings.leavePrivateTopicBody({ topic: topicLabel(topic.slug) }) : strings.leaveTopicBody

const memberRow = (
  topic: Topic,
  member: TopicMember,
  keepsTheTopicManaged: boolean,
  changing: (change: ReturnType<typeof setTopicMember>) => void,
): HTMLElement =>
  h(
    'li',
    { class: 'topic-member', data: { member: member.memberId } },
    h('span', { class: 'topic-member-name' }, nameOf(member.memberId)),
    roleMarks(member),
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

const stepDownConfirmation = (topic: Topic, me: MemberId): HTMLElement =>
  h(
    'form',
    {
      class: 'self-confirmation',
      on: {
        submit: (event) => {
          event.preventDefault()
          launch(setTopicManager(topic.slug, me, false), closeDialog, 'managers')
        },
      },
    },
    h('h3', {}, strings.stepDownTitle({ topic: topicLabel(topic.slug) })),
    h('p', {}, strings.stepDownBody({ topic: topicLabel(topic.slug) })),
    dialogActions(strings.stepDown, 'danger'),
  )

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

const visibilitySwitch = (
  topic: Topic,
  hasManager: boolean,
  confirm: (content: HTMLElement) => void,
): HTMLElement =>
  h(
    'div',
    { class: 'visibility-switch' },
    h('p', {}, isPrivate(topic) ? strings.visibilityPrivate : strings.visibilityOpen),
    isPrivate(topic)
      ? button(strings.makeOpen, () => confirm(visibilityConfirmation(topic)))
      : hasManager
        ? button(strings.makePrivate, () => confirm(visibilityConfirmation(topic)))
        : disabledWithReason(strings.makePrivate, strings.privateNeedsManager, 'make-private'),
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
          launch(setTopicVisibility(topic.slug, toPrivate ? 'private' : 'open'), closeDialog, 'visibility')
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
