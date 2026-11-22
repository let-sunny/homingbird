import type { AsRead, GroupId, MemberId } from '@homingbird/protocol'
import { type Lifetime, h, region, signal } from '@homingbird/ui'
import type { Actions } from '../actions.ts'
import { featureOn } from '../features.ts'
import { showsInvites } from '../models/invites.ts'
import {
  type FilterOption,
  type PeopleModel,
  type PersonAction,
  type PersonCard,
  peopleModel,
} from '../models/people.ts'
import { strings } from '../strings.ts'
import { renderAvatar } from './character-avatar.ts'
import type { ViewContext } from './context.ts'
import { invitesSection } from './invites.ts'
import { type MenuParts, actionMenu } from './menu.ts'
import { button, channelChips, empty, field, loadFailed, loading, page, presenceBadges } from './parts.ts'

/** People: everyone in the organization the person may see, and what they may do with each. */
export const peopleView = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state, actions } = context
  const failed = signal(false)
  const load = (): void => {
    failed.set(false)
    actions.loadPeople({ failed: () => failed.set(true) })
  }
  load()
  actions.loadKnownChannels()
  actions.loadGroups()
  const query = signal('')
  const channelFilter = signal('')
  const groupFilter = signal('')
  const groupMembers = signal<ReadonlySet<MemberId> | null>(null)
  const chooseGroup = (value: string): void => {
    groupFilter.set(value)
    groupMembers.set(null)
    if (value !== '')
      actions.listPeopleInGroup(value as GroupId, {
        done: (memberIds) => {
          if (groupFilter.get() === value) groupMembers.set(new Set(memberIds))
        },
      })
  }
  const search = h('input', {
    type: 'search',
    placeholder: strings.peopleSearchPlaceholder,
    on: { input: () => query.set(search.value) },
  })
  const model = (): PeopleModel =>
    peopleModel({
      contactMode: me.contactMode,
      directory: state.directory.get(),
      loaded: state.directoryLoaded.get(),
      failed: failed.get(),
      query: query.get(),
      channelFilter: channelFilter.get(),
      channels: state.channels.get(),
      charactersOn: featureOn('characters', state.serverInfo.get()),
      groups: state.groups.get(),
      groupsOn: featureOn('groups', state.serverInfo.get()),
      groupFilter: groupFilter.get(),
      groupMembers: groupMembers.get(),
    })
  const shown = model()
  const list = region(
    life,
    [
      state.directory,
      state.directoryLoaded,
      failed,
      query,
      channelFilter,
      state.channels,
      state.groups,
      groupFilter,
      groupMembers,
    ],
    () => renderPeople(model(), context, load),
  )
  return page(
    strings.people,
    shown.contactsNotice !== null && h('p', { class: 'banner' }, shown.contactsNotice),
    h(
      'div',
      { class: 'people-filters' },
      field(strings.peopleSearchLabel, search),
      region(
        life,
        [state.channels],
        () =>
          filter(strings.peopleChannelFilter, 'channel', model().channelFilter, (value) =>
            channelFilter.set(value),
          ),
        {
          class: 'channel-filter-host',
        },
      ),
      region(
        life,
        [state.groups],
        () => filter(strings.groups.filter, 'group', model().groupFilter, chooseGroup),
        {
          class: 'group-filter-host',
        },
      ),
    ),
    list,
    showsInvites('people', me, state.serverInfo.get()) && invitesSection(context, life),
  )
}

const renderPeople = (
  model: PeopleModel,
  context: Pick<ViewContext, 'actions' | 'clock' | 'page' | 'document'>,
  retry: () => void,
): HTMLElement => {
  const list = model.list
  if (list.kind === 'loading') return loading()
  if (list.kind === 'failed') return loadFailed(retry)
  if (list.kind === 'empty') return empty(list.text)
  return h(
    'ul',
    { class: 'people' },
    list.people.map((person) => personCard(person, context)),
  )
}

const personCard = (
  person: PersonCard,
  context: Pick<ViewContext, 'actions' | 'clock' | 'page' | 'document'>,
): HTMLElement => {
  const more = person.more === null ? null : moreMenu(person, person.more, context)
  const card = h(
    'li',
    { class: 'person', data: { memberId: person.memberId } },
    h(
      'div',
      { class: 'person-card' },
      h('div', { class: 'person-face' }, renderAvatar(context, person.avatar)),
      h(
        'div',
        { class: 'person-main' },
        h(
          'div',
          { class: 'person-name' },
          h('strong', {}, person.name),
          person.relation !== null &&
            h('span', { class: `relation is-${person.relation.kind}` }, person.relation.text),
        ),
        h('span', { class: 'person-email', title: person.email }, person.email),
        presenceBadges(person.presence),
        person.channels !== null &&
          h(
            'div',
            { class: 'person-channels' },
            channelChips(person.channels.first),
            person.channels.rest.length > 0 &&
              h(
                'details',
                { class: 'more-channels' },
                h('summary', {}, person.channels.more),
                channelChips(person.channels.rest),
              ),
          ),
        person.groups.length > 0 &&
          h(
            'ul',
            { class: 'group-chips', 'aria-label': strings.groups.title },
            person.groups.map((group) =>
              h('li', {}, h('a', { class: 'group-chip', href: group.href }, group.label)),
            ),
          ),
        h(
          'details',
          { class: 'person-profile', open: person.profile.open },
          h('summary', {}, person.profile.summary),
          h('p', {}, person.profile.text),
        ),
        person.agentIntroduction.length > 0 &&
          h(
            'section',
            { class: 'person-agent', 'aria-label': person.agentIntroductionTitle },
            h('strong', {}, person.agentIntroductionTitle),
            h(
              'ul',
              { class: 'agent-introduction' },
              person.agentIntroduction.map((sentence) => h('li', {}, sentence)),
            ),
          ),
      ),
      h(
        'div',
        { class: 'person-actions' },
        person.actions.map((one) => [
          actionButton(one, person, context.actions),
          one.kind === 'message' &&
            person.withOthers !== null &&
            h(
              'a',
              {
                class: 'button with-others',
                href: person.withOthers.href,
                'aria-label': person.withOthers.label,
              },
              person.withOthers.text,
            ),
        ]),
        more?.trigger,
        more?.menu,
      ),
    ),
  )
  more?.opensFrom(card)
  return card
}

const moreMenu = (
  person: PersonCard,
  more: NonNullable<PersonCard['more']>,
  context: Pick<ViewContext, 'actions' | 'clock' | 'page' | 'document'>,
): MenuParts =>
  actionMenu(context, {
    id: `person-menu-${person.memberId}`,
    label: more.label,
    triggerClass: 'person-more',
    menuClass: 'person-menu',
    items: more.actions.map((one) =>
      button(one.label, () => ACTIONS[one.kind](context.actions, person), {
        class: `menu-item${one.style === null ? '' : ` ${one.style}`}`,
      }),
    ),
  })

const actionButton = (action: PersonAction, person: PersonCard, actions: Actions): HTMLElement => {
  const control = button(action.label, () => ACTIONS[action.kind](actions, person), {
    ...(action.style !== null && { class: action.style }),
  })
  return action.hint === null
    ? control
    : h('span', { class: 'action-with-hint' }, control, h('small', {}, action.hint))
}

const ACTIONS: Readonly<Record<PersonAction['kind'], (actions: Actions, person: PersonCard) => void>> = {
  unblock: (actions, person) => actions.unblockMember(person.memberId),
  message: (actions, person) => actions.openConversationWith(person.memberId),
  request: (actions, person) => actions.requestContact(person.memberId),
  accept: (actions, person) => actions.acceptContact(person.memberId),
  decline: (actions, person) => actions.removeContact(person.memberId),
  cancel: (actions, person) => actions.removeContact(person.memberId),
  remove: (actions, person) => actions.removeContact(person.memberId),
  block: (actions, person) => actions.blockMember(person.memberId),
}

const filter = (
  label: string,
  name: string,
  options: ReadonlyArray<FilterOption> | null,
  choose: (value: string) => void,
): HTMLElement | null => {
  if (options === null) return null
  const select = h(
    'select',
    { name, on: { change: () => choose(select.value) } },
    options.map((option) => h('option', { value: option.value, selected: option.selected }, option.label)),
  )
  return field(label, select)
}
