import type { DirectoryEntry, Me } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import {
  acceptContact,
  blockMember,
  launch,
  loadPeople,
  openConversationWith,
  removeContact,
  requestContact,
  unblockMember,
} from '../actions.ts'
import { directory } from '../state.ts'
import { strings } from '../strings.ts'
import { avatar, button, emptyWithPip, field, page, presenceBadges } from './parts.ts'
import { type PipState, pip } from './pip.ts'

export const peopleView = (life: Lifetime, me: Me): HTMLElement => {
  launch(loadPeople)
  const query = signal('')
  const search = h('input', {
    type: 'search',
    placeholder: strings.peopleSearchPlaceholder,
    on: { input: () => query.set(search.value.trim().toLowerCase()) },
  })
  return page(
    strings.people,
    me.contactMode === 'contacts' && h('p', { class: 'banner' }, strings.contactsModeNotice),
    field(strings.peopleSearchLabel, search),
    region(life, [directory, query], () => {
      const matching = directory.get().filter((entry) => matches(entry, query.get()))
      return matching.length === 0
        ? emptyWithPip('searching', 4, strings.noPeople)
        : h('ul', { class: 'people' }, matching.sort(agentsFirst).map(personCard))
    }),
  )
}

const matches = (entry: DirectoryEntry, query: string): boolean =>
  [entry.member.name, entry.member.email, entry.member.profile].some((text) =>
    text.toLowerCase().includes(query),
  )

const agentsFirst = (a: DirectoryEntry, b: DirectoryEntry): number =>
  Number(b.presence.agentOnline) - Number(a.presence.agentOnline) ||
  a.member.name.localeCompare(b.member.name)

const personCard = (entry: DirectoryEntry): HTMLElement =>
  h(
    'li',
    { class: 'person', data: { memberId: entry.member.id } },
    h('div', { class: 'person-face' }, avatar(entry.member.name), pip(personPip(entry), 2)),
    h(
      'div',
      { class: 'person-main' },
      h(
        'div',
        { class: 'person-name' },
        h('strong', {}, entry.member.name),
        strings.relation[entry.relation] !== '' &&
          h('span', { class: `relation is-${entry.relation}` }, strings.relation[entry.relation]),
      ),
      h('span', { class: 'person-email' }, entry.member.email),
      presenceBadges(entry.presence, true),
      h(
        'details',
        { class: 'person-profile', open: entry.member.profile !== '' },
        h('summary', {}, strings.profileAgent),
        h('p', {}, entry.member.profile || strings.noProfile),
      ),
    ),
    h('div', { class: 'person-actions' }, actionsFor(entry)),
  )

const personPip = (entry: DirectoryEntry): PipState =>
  entry.relation === 'blocked'
    ? 'blocked'
    : entry.presence.agentOnline || entry.presence.humanOnline
      ? 'idle'
      : 'offline'

const actionsFor = (entry: DirectoryEntry): Child => {
  const id = entry.member.id
  if (entry.relation === 'self') return null
  if (entry.relation === 'blocked') return button(strings.unblock, () => launch(unblockMember(id)))
  return [
    entry.canMessage && button(strings.message, () => launch(openConversationWith(id)), { class: 'primary' }),
    entry.relation === 'none' && button(strings.addContact, () => launch(requestContact(id))),
    entry.relation === 'request_received' &&
      button(strings.acceptContact, () => launch(acceptContact(id)), { class: 'primary' }),
    entry.relation === 'request_received' && button(strings.declineRequest, () => launch(removeContact(id))),
    entry.relation === 'request_sent' && button(strings.cancelRequest, () => launch(removeContact(id))),
    entry.relation === 'contact' && button(strings.removeContact, () => launch(removeContact(id))),
    button(strings.block, () => launch(blockMember(id)), { class: 'danger' }),
  ]
}
