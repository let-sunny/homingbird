import { type Lifetime, h, later } from '@homingbird/ui'
import type { AuthorModel } from '../models/note-item.ts'
import type { PageDocument } from '../page-document.ts'
import { renderAvatar } from './character-avatar.ts'
import type { ViewContext } from './context.ts'
import { isProfileCardOpen, opensProfile } from './profile-card.ts'

/**
 * The author's character as a button: a mark when an agent wrote the note, the details on hover, and the
 * author's profile card, with the details in it, on a click, a tap or Enter.
 */
export const authorButton = (context: ViewContext, life: Lifetime, author: AuthorModel): HTMLElement => {
  const hint = context.page.supportsHintPopovers()
  const details = h(
    'div',
    { id: author.id, class: 'author-details', popover: hint ? 'hint' : 'manual', role: 'note' },
    h('p', { class: 'author-line' }, author.line),
    author.debate !== null && h('p', { class: 'author-debate' }, author.debate),
    author.details.map((detail) =>
      h('p', detail.className === null ? {} : { class: detail.className }, detail.text),
    ),
    author.sent !== null && h('p', { class: 'author-sent' }, author.sent),
  )
  const trigger = h(
    'button',
    {
      type: 'button',
      class: author.buttonClass,
      'aria-label': author.buttonLabel,
      'aria-describedby': author.id,
      ...opensProfile(author.memberId, author.id),
    },
    renderAvatar(context, author.avatar),
    author.agentMark && h('span', { class: 'author-mark', 'aria-hidden': 'true' }),
  )
  opensOnHover(context, life, trigger, details, hint)
  keepsOpenAcrossRedraw(context.document, author.id, trigger, details)
  return h('span', { class: 'author' }, trigger, details)
}

export const HOVER_OPEN_MS = 350
export const HOVER_CLOSE_MS = 250

/**
 * Opening the details marks the note read and redraws it; the redrawn note keeps them open and focused,
 * and keeps the profile card it opened beside it.
 */
const keepsOpenAcrossRedraw = (
  page: PageDocument,
  id: string,
  trigger: HTMLElement,
  details: HTMLElement,
): void => {
  const before = page.byId(id)
  if (before === null) return
  const wasOpen =
    !isProfileCardOpen(page) && (hasPopover(before) ? before.matches(':popover-open') : !before.hidden)
  const hadFocus = before.parentElement?.contains(page.focused()) ?? false
  const anchors = before.parentElement
    ?.querySelector<HTMLElement>('button')
    ?.style.getPropertyValue('anchor-name')
  if (anchors !== undefined && anchors !== '') trigger.style.setProperty('anchor-name', anchors)
  queueMicrotask(() => {
    if (!details.isConnected) return
    if (wasOpen && hasPopover(details)) details.showPopover()
    else if (wasOpen) trigger.click()
    if (hadFocus) trigger.focus()
  })
}

const hasPopover = (element: HTMLElement): boolean =>
  typeof (element as { showPopover?: unknown }).showPopover === 'function'

/**
 * Hover opens the details after a short pause and keeps them open while the pointer is over either; a
 * click closes them until the pointer leaves, as it opens the profile card. Hover uses a `hint` popover, which leaves other open
 * popovers alone; without one, a manual popover closes itself the same way.
 */
const opensOnHover = (
  context: ViewContext,
  life: Lifetime,
  trigger: HTMLElement,
  details: HTMLElement,
  hint: boolean,
): void => {
  if (!hasPopover(details)) {
    closesLikeAPopover(trigger, details)
    return
  }
  trigger.style.setProperty('anchor-name', `--${details.id}`)
  details.style.setProperty('position-anchor', `--${details.id}`)
  let cancel = (): void => {}
  const soon = (action: () => void, ms: number): void => {
    cancel()
    cancel = later(context.clock, ms, action)
  }
  life.add(() => cancel())
  const isOpen = (): boolean => details.matches(':popover-open')
  let pressed = false
  trigger.addEventListener('click', () => {
    cancel()
    pressed = true
    if (isOpen()) details.hidePopover()
  })
  if (!hint) closesWhenDismissed(context.document, life, trigger, details)
  for (const element of [trigger, details]) {
    element.addEventListener('pointerenter', (event) => {
      if ((event as PointerEvent).pointerType !== 'mouse') return
      soon(() => {
        if (pressed || isOpen() || !details.isConnected || isProfileCardOpen(context.document)) return
        details.showPopover()
      }, HOVER_OPEN_MS)
    })
    element.addEventListener('pointerleave', (event) => {
      if ((event as PointerEvent).pointerType !== 'mouse') return
      pressed = false
      soon(() => {
        if (isOpen()) details.hidePopover()
      }, HOVER_CLOSE_MS)
    })
  }
}

/** A manual popover has no light dismiss of its own: Escape or a press elsewhere closes it while it is open. */
const closesWhenDismissed = (
  page: PageDocument,
  life: Lifetime,
  trigger: HTMLElement,
  details: HTMLElement,
): void => {
  const onKey = (event: Event): void => {
    if ((event as KeyboardEvent).key !== 'Escape') return
    details.hidePopover()
    if (details.contains(page.focused())) trigger.focus()
  }
  const onPress = (event: Event): void => {
    const target = event.target as Node
    if (!details.contains(target) && !trigger.contains(target)) details.hidePopover()
  }
  let stopListening: ReadonlyArray<() => void> = []
  const stop = (): void => {
    for (const each of stopListening) each()
    stopListening = []
  }
  life.add(stop)
  details.addEventListener('toggle', (event) => {
    stop()
    if ((event as ToggleEvent).newState === 'open')
      stopListening = [page.listen('keydown', onKey), page.listen('pointerdown', onPress)]
  })
}

/** Without `popover`, a click toggles the details; Escape, or focus moving elsewhere, closes them. */
const closesLikeAPopover = (trigger: HTMLElement, details: HTMLElement): void => {
  const show = (open: boolean): void => {
    details.hidden = !open
    trigger.setAttribute('aria-expanded', String(open))
  }
  show(false)
  trigger.addEventListener('click', () => show(details.hidden))
  for (const element of [trigger, details]) {
    element.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Escape' || details.hidden) return
      show(false)
      trigger.focus()
    })
    element.addEventListener('focusout', (event) => {
      const next = (event as FocusEvent).relatedTarget as Node | null
      if (next === null || !(trigger.contains(next) || details.contains(next))) show(false)
    })
  }
}
