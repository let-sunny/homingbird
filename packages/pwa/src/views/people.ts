import { Task as T } from '@homingbird/kernel'
import type { ApiError, ContactMode, DirectoryEntry, Me } from '@homingbird/protocol'
import { type Child, type Lifetime, type Signal, h, region, signal } from '@homingbird/ui'
import {
  acceptContact,
  blockMember,
  launch,
  loadChannels,
  loadPeople,
  openConversationWith,
  removeContact,
  requestContact,
  unblockMember,
} from '../actions.ts'
import { channelLabel, chipsForPerson } from '../channels.ts'
import { shownRelation } from '../relations.ts'
import { channels, directory, directoryLoaded } from '../state.ts'
import { strings } from '../strings.ts'
import { memberAvatar } from './character-avatar.ts'
import { button, channelChips, empty, field, loadFailed, loading, page, presenceBadges } from './parts.ts'
import type { PipState } from './pip.ts'

export const peopleView = (life: Lifetime, me: Me): HTMLElement => {
  const failed = signal(false)
  const load = (): void => {
    failed.set(false)
    launch(T.tapError((_: ApiError) => T.sync(() => failed.set(true)))(loadPeople))
  }
  load()
  launch(loadChannels(''))
  const query = signal('')
  const channelFilter = signal('')
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
      region(life, [channels], () => channelFilterField(channelFilter), { class: 'channel-filter-host' }),
    ),
    region(life, [directory, directoryLoaded, failed, query, channelFilter, channels], () => {
      if (!directoryLoaded.get()) return failed.get() ? loadFailed(load) : loading()
      const matching = directory
        .get()
        .filter((entry) => matches(entry, query.get()))
        .filter((entry) => channelFilter.get() === '' || entry.channels.includes(channelFilter.get()))
      return matching.length === 0
        ? empty(strings.noPeople)
        : h(
            'ul',
            { class: 'people' },
            matching.sort(agentsFirst).map((entry) => personCard(entry, me.contactMode)),
          )
    }),
  )
}

const channelFilterField = (chosen: Signal<string>): Child => {
  const known = channels.get()
  if (known.length === 0) return null
  const select = h(
    'select',
    { name: 'channel', on: { change: () => chosen.set(select.value) } },
    h('option', { value: '' }, strings.anyChannel),
    known.map((channel) =>
      h(
        'option',
        { value: channel.slug, selected: chosen.get() === channel.slug },
        channelLabel(channel.slug),
      ),
    ),
  )
  return field(strings.peopleChannelFilter, select)
}

const matches = (entry: DirectoryEntry, query: string): boolean =>
  [entry.member.name, entry.member.email, entry.member.profile, ...entry.channels].some((text) =>
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
      h('div', { class: 'person-face' }, memberAvatar(entry.member, { state: personPip(entry) })),
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
        entry.channels.length > 0 && personChannels(entry.channels),
        h(
          'details',
          { class: 'person-profile', open: entry.member.profile !== '' },
          h('summary', {}, strings.profileAbout),
          h('p', {}, entry.member.profile || strings.noProfile),
        ),
        (entry.agentIntroduction ?? []).length > 0 &&
          h(
            'section',
            { class: 'person-agent', 'aria-label': strings.agentIntroduction },
            h('strong', {}, strings.agentIntroduction),
            h(
              'ul',
              { class: 'agent-introduction' },
              (entry.agentIntroduction ?? []).map((sentence) => h('li', {}, sentence)),
            ),
          ),
      ),
      h('div', { class: 'person-actions' }, actionsFor(entry, relation, mode)),
    ),
  )
}

const personChannels = (theirs: ReadonlyArray<string>): HTMLElement => {
  const mine = new Set(
    channels
      .get()
      .filter((channel) => channel.joined)
      .map((channel) => channel.slug),
  )
  const { first, rest } = chipsForPerson(theirs, mine)
  return h(
    'div',
    { class: 'person-channels' },
    channelChips(first),
    rest.length > 0 &&
      h(
        'details',
        { class: 'more-channels' },
        h('summary', {}, strings.moreChannels({ count: rest.length })),
        channelChips(rest),
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
