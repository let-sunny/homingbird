import type { AsRead } from '@homingbird/protocol'
import { type Lifetime, h, region, signal } from '@homingbird/ui'
import type { Actions } from '../actions.ts'
import { featureOn } from '../features.ts'
import { type PeopleModel, type PersonAction, type PersonCard, peopleModel } from '../models/people.ts'
import { strings } from '../strings.ts'
import { renderAvatar } from './character-avatar.ts'
import type { ViewContext } from './context.ts'
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
  const query = signal('')
  const channelFilter = signal('')
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
    })
  const shown = model()
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
        () => renderChannelFilter(model(), (value) => channelFilter.set(value)),
        {
          class: 'channel-filter-host',
        },
      ),
    ),
    region(life, [state.directory, state.directoryLoaded, failed, query, channelFilter, state.channels], () =>
      renderPeople(model(), context, load),
    ),
  )
}

const renderPeople = (
  model: PeopleModel,
  context: Pick<ViewContext, 'actions' | 'clock' | 'page'>,
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
  context: Pick<ViewContext, 'actions' | 'clock' | 'page'>,
): HTMLElement =>
  h(
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
        presenceBadges(person.presence, true),
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
        h(
          'details',
          { class: 'person-profile', open: person.profile.open },
          h('summary', {}, strings.profileAbout),
          h('p', {}, person.profile.text),
        ),
        person.agentIntroduction.length > 0 &&
          h(
            'section',
            { class: 'person-agent', 'aria-label': strings.agentIntroduction },
            h('strong', {}, strings.agentIntroduction),
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
        person.actions.map((one) => actionButton(one, person, context.actions)),
      ),
    ),
  )

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

const renderChannelFilter = (model: PeopleModel, choose: (slug: string) => void): HTMLElement | null => {
  if (model.channelFilter === null) return null
  const select = h(
    'select',
    { name: 'channel', on: { change: () => choose(select.value) } },
    model.channelFilter.map((option) =>
      h('option', { value: option.value, selected: option.selected }, option.label),
    ),
  )
  return field(strings.peopleChannelFilter, select)
}
