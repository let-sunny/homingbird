import type { ContactMode, DirectoryEntry, Me } from '@homingbird/protocol'
import { type Child, type Lifetime, type Signal, h, region, signal } from '@homingbird/ui'
import {
  acceptContact,
  blockMember,
  launch,
  loadPeople,
  loadTopics,
  openConversationWith,
  removeContact,
  requestContact,
  unblockMember,
} from '../actions.ts'
import { shownRelation } from '../relations.ts'
import { directory, topics } from '../state.ts'
import { strings } from '../strings.ts'
import { chipsForPerson, topicLabel } from '../topics.ts'
import { memberAvatar } from './character-avatar.ts'
import { button, emptyWithPip, field, page, presenceBadges, topicChips } from './parts.ts'
import type { PipState } from './pip.ts'

export const peopleView = (life: Lifetime, me: Me): HTMLElement => {
  launch(loadPeople)
  launch(loadTopics(''))
  const query = signal('')
  const topicFilter = signal('')
  const search = h('input', {
    type: 'search',
    placeholder: strings.peopleSearchPlaceholder,
    on: { input: () => query.set(search.value.trim().toLowerCase()) },
  })
  return page(
    strings.people,
    me.contactMode === 'contacts' && h('p', { class: 'banner' }, strings.contactsModeNotice),
    h(
      'div',
      { class: 'people-filters' },
      field(strings.peopleSearchLabel, search),
      region(life, [topics], () => topicFilterField(topicFilter), { class: 'topic-filter-host' }),
    ),
    region(life, [directory, query, topicFilter, topics], () => {
      const matching = directory
        .get()
        .filter((entry) => matches(entry, query.get()))
        .filter((entry) => topicFilter.get() === '' || entry.topics.includes(topicFilter.get()))
      return matching.length === 0
        ? emptyWithPip('searching', 4, strings.noPeople)
        : h(
            'ul',
            { class: 'people' },
            matching.sort(agentsFirst).map((entry) => personCard(entry, me.contactMode)),
          )
    }),
  )
}

const topicFilterField = (chosen: Signal<string>): Child => {
  const known = topics.get()
  if (known.length === 0) return null
  const select = h(
    'select',
    { name: 'topic', on: { change: () => chosen.set(select.value) } },
    h('option', { value: '' }, strings.anyTopic),
    known.map((topic) =>
      h('option', { value: topic.slug, selected: chosen.get() === topic.slug }, topicLabel(topic.slug)),
    ),
  )
  return field(strings.peopleTopicFilter, select)
}

const matches = (entry: DirectoryEntry, query: string): boolean =>
  [entry.member.name, entry.member.email, entry.member.profile, ...entry.topics].some((text) =>
    text.toLowerCase().includes(query),
  )

const agentsFirst = (a: DirectoryEntry, b: DirectoryEntry): number =>
  Number(b.presence.agentOnline) - Number(a.presence.agentOnline) ||
  a.member.name.localeCompare(b.member.name)

const personCard = (entry: DirectoryEntry, mode: ContactMode): HTMLElement => {
  const relation = shownRelation(entry, mode)
  return h(
    'li',
    { class: 'person', data: { memberId: entry.member.id } },
    h(
      'div',
      { class: 'person-card' },
      h('div', { class: 'person-face' }, memberAvatar(entry.member, { scale: 3, state: personPip(entry) })),
      h(
        'div',
        { class: 'person-main' },
        h(
          'div',
          { class: 'person-name' },
          h('strong', {}, entry.member.name),
          strings.relation[relation] !== '' &&
            h('span', { class: `relation is-${relation}` }, strings.relation[relation]),
        ),
        h('span', { class: 'person-email', title: entry.member.email }, entry.member.email),
        presenceBadges(entry.presence, true),
        entry.topics.length > 0 && personTopics(entry.topics),
        h(
          'details',
          { class: 'person-profile', open: entry.member.profile !== '' },
          h('summary', {}, strings.profileAbout),
          h('p', {}, entry.member.profile || strings.noProfile),
        ),
      ),
      h('div', { class: 'person-actions' }, actionsFor(entry, relation, mode)),
    ),
  )
}

const personTopics = (theirs: ReadonlyArray<string>): HTMLElement => {
  const mine = new Set(
    topics
      .get()
      .filter((topic) => topic.joined)
      .map((topic) => topic.slug),
  )
  const { first, rest } = chipsForPerson(theirs, mine)
  return h(
    'div',
    { class: 'person-topics' },
    topicChips(first),
    rest.length > 0 &&
      h(
        'details',
        { class: 'more-topics' },
        h('summary', {}, strings.moreTopics({ count: rest.length })),
        topicChips(rest),
      ),
  )
}

const personPip = (entry: DirectoryEntry): PipState =>
  entry.relation === 'blocked'
    ? 'blocked'
    : entry.presence.agentOnline || entry.presence.humanOnline
      ? 'idle'
      : 'offline'

const actionsFor = (
  entry: DirectoryEntry,
  relation: DirectoryEntry['relation'],
  mode: ContactMode,
): Child => {
  const id = entry.member.id
  if (relation === 'self') return null
  if (relation === 'blocked') return button(strings.unblock, () => launch(unblockMember(id)))
  const contacts = mode === 'contacts'
  return [
    entry.canMessage && button(strings.message, () => launch(openConversationWith(id)), { class: 'primary' }),
    contacts &&
      relation === 'none' &&
      h(
        'span',
        { class: 'action-with-hint' },
        button(strings.addContact, () => launch(requestContact(id))),
        h('small', {}, strings.addContactHint({ name: entry.member.name })),
      ),
    contacts &&
      relation === 'request_received' &&
      button(strings.acceptContact, () => launch(acceptContact(id)), { class: 'primary' }),
    contacts &&
      relation === 'request_received' &&
      button(strings.declineRequest, () => launch(removeContact(id))),
    contacts && relation === 'request_sent' && button(strings.cancelRequest, () => launch(removeContact(id))),
    contacts && relation === 'contact' && button(strings.removeContact, () => launch(removeContact(id))),
    button(strings.block, () => launch(blockMember(id)), { class: 'danger' }),
  ]
}
