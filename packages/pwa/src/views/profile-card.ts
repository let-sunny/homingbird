import type { AsRead, MemberId } from '@homingbird/protocol'
import { type Child, type Lifetime, type Properties, h, replaceChildren } from '@homingbird/ui'
import { featureOn } from '../features.ts'
import { type ProfileCard, profileCardModel } from '../models/profile-card.ts'
import { turningBirdOf } from '../models/turning-bird.ts'
import type { PageDocument } from '../page-document.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { placeMenu } from './menu.ts'
import { presenceDots, youMark } from './parts.ts'
import { renderTurningBird } from './turning-bird.ts'

/**
 * The one profile card of the page, which every name and face that `opensProfile` marks opens next to
 * itself: on a touch screen it is the sheet along the bottom edge that every menu there is. It is filled
 * as it opens, for the member pressed and the place on screen, and closes when the place changes.
 */
export const profileCardHost = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const card = h('div', {
    id: PROFILE_CARD_ID,
    class: 'menu action-menu profile-card',
    popover: 'auto',
    role: 'dialog',
  })
  let shownFrom: HTMLElement | null = null
  const isOpen = (): boolean => card.matches(':popover-open')
  const fill = (trigger: HTMLElement): void => {
    const model = profileCardModel(inputOf(context, me, trigger))
    card.setAttribute('aria-label', model.label)
    replaceChildren(
      card,
      renderProfileCard(context, model, () => card.hidePopover()),
    )
    if (shownFrom !== null)
      setAnchors(
        shownFrom,
        anchorsOf(shownFrom).filter((name) => name !== ANCHOR),
      )
    setAnchors(trigger, [...anchorsOf(trigger), ANCHOR])
    card.classList.remove('is-at-point')
    shownFrom = trigger
  }
  let home: Element | null = null
  /** A modal dialog leaves everything outside it inert, so a name inside one opens the card inside it. */
  const keepInside = (trigger: HTMLElement): void => {
    home ??= card.parentElement
    const into = trigger.closest('dialog') ?? home
    if (into !== null && card.parentElement !== into) into.append(card)
  }
  life.add(
    context.document.listen(
      'click',
      (event) => {
        const trigger = (event.target as Element).closest<HTMLElement>(`[data-${PROFILE_DATA}]`)
        if (trigger === null || (isOpen() && anchorsOf(trigger).includes(ANCHOR))) return
        fill(trigger)
        keepInside(trigger)
        if (!isOpen()) return
        event.preventDefault()
        placeMenu(context, card, null, trigger)
      },
      { capture: true },
    ),
  )
  card.addEventListener('toggle', (event) => {
    if ((event as ToggleEvent).newState === 'open' && shownFrom !== null)
      placeMenu(context, card, null, shownFrom)
  })
  life.add(
    context.state.route.subscribe(() => {
      if (isOpen()) card.hidePopover()
    }),
  )
  return card
}

/** What makes a button open the card of a member; `note` names the element describing the note it wrote. */
export const opensProfile = (memberId: MemberId, note: string | null = null): Properties => ({
  popovertarget: PROFILE_CARD_ID,
  data: { [PROFILE_DATA]: memberId, ...(note !== null && { profileNote: note }) },
})

/** Whether the profile card is open, so that nothing else opens over it. */
export const isProfileCardOpen = (page: PageDocument): boolean =>
  page.byId(PROFILE_CARD_ID)?.matches(':popover-open') === true

/** A name as a button that opens its card. */
export const profileName = (memberId: MemberId, name: Child): HTMLElement =>
  h('button', { type: 'button', class: 'profile-name', ...opensProfile(memberId) }, name)

/** The card's content: the face and name, what they are here, and what the person may do. */
const renderProfileCard = (context: ViewContext, model: ProfileCard, close: () => void): Child => [
  h(
    'div',
    { class: 'profile-head' },
    renderTurningBird(context, turningBirdOf(model.avatar, 2)),
    h(
      'p',
      { class: 'profile-who' },
      h('strong', {}, model.name, model.kind === 'person' && model.you && [' ', youMark()]),
      model.kind === 'agent' && h('small', {}, model.of),
      model.kind === 'former' && model.line !== null && h('small', {}, model.line),
    ),
  ),
  model.kind === 'person' &&
    model.presence !== null &&
    h('p', { class: 'profile-presence' }, presenceDots(model.presence)),
  model.kind === 'agent' &&
    model.state !== null &&
    h(
      'p',
      { class: 'profile-presence' },
      h('span', { class: `agent-mark-dot is-${model.state.state}`, 'aria-hidden': 'true' }),
      model.state.label,
    ),
  model.roles.length > 0 &&
    h(
      'ul',
      { class: 'profile-roles' },
      model.roles.map((role) => h('li', {}, role)),
    ),
  model.kind === 'person' && model.teams !== null && h('p', { class: 'profile-teams' }, model.teams),
  model.kind === 'agent' && model.managers !== null && h('p', { class: 'profile-managers' }, model.managers),
  model.kind === 'person' && model.about !== null && h('p', { class: 'profile-about' }, model.about),
  model.note !== null &&
    h(
      'section',
      { class: 'profile-note', 'aria-label': model.note.title },
      model.note.lines.map((line) => h('p', {}, line)),
    ),
  model.kind === 'person' && profileActions(model, close),
]

const profileActions = (model: Extract<ProfileCard, { kind: 'person' }>, close: () => void): HTMLElement =>
  h(
    'div',
    { class: 'profile-actions' },
    model.message !== null &&
      h(
        'a',
        { class: 'button primary profile-message', href: model.message.href, on: { click: close } },
        model.message.label,
      ),
    h(
      'a',
      { class: 'button profile-people', href: model.people.href, on: { click: close } },
      model.people.label,
    ),
  )

const inputOf = (context: ViewContext, me: AsRead.Me, trigger: HTMLElement) => {
  const { state } = context
  const noteId = trigger.dataset.profileNote
  const details = noteId === undefined ? null : context.document.byId(noteId)
  return {
    memberId: trigger.dataset[PROFILE_DATA] as MemberId,
    viewerId: me.member.id,
    route: state.route.get(),
    members: state.members.get(),
    directory: state.directory.get(),
    conversations: state.conversations.get(),
    channels: state.channels.get(),
    groups: state.groups.get(),
    groupsOn: featureOn('groups', state.serverInfo.get()),
    charactersOn: featureOn('characters', state.serverInfo.get()),
    debate: state.shownDebate.get(),
    note:
      details === null
        ? []
        : [...details.querySelectorAll('p')].flatMap((line) =>
            line.textContent === null || line.textContent === '' ? [] : [line.textContent],
          ),
  }
}

const anchorsOf = (element: HTMLElement): ReadonlyArray<string> =>
  element.style
    .getPropertyValue('anchor-name')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')

const setAnchors = (element: HTMLElement, names: ReadonlyArray<string>): void => {
  if (names.length === 0) element.style.removeProperty('anchor-name')
  else element.style.setProperty('anchor-name', names.join(', '))
}

const PROFILE_CARD_ID = 'profile-card'

const PROFILE_DATA = 'profile'

const ANCHOR = '--profile-card'
