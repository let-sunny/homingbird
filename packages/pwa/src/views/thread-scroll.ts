import type { AsRead, ConversationId, MemberId } from '@homingbird/protocol'
import type { Lifetime } from '@homingbird/ui'
import { changedItems, showsNewerBelow, unseenAfterDraw } from '../newer-below.ts'
import { isUnreadBy } from '../thread.ts'
import type { ViewContext } from './context.ts'

/**
 * Keeps the view at the bottom while the person is there, and otherwise points at what arrived or
 * changed below that they have not seen; unread notes below count on opening. A card a link opened
 * the page at is brought into view instead of the bottom.
 */
export const followNewNotes = (
  context: Pick<ViewContext, 'page' | 'document'>,
  life: Lifetime,
  scroller: HTMLElement,
  indicator: HTMLButtonElement,
  signatures: () => ReadonlyArray<readonly [string, string]>,
) => {
  const { page } = context
  let pinned = true
  let drawn = new Map<string, string>()
  let unseen = new Set<string>()
  const elements = new Map<string, HTMLElement>()
  const inView = new Set<string>()
  const keyOf = (element: HTMLElement): string => element.dataset.itemKey ?? ''
  const update = (): void => {
    indicator.hidden = !showsNewerBelow({ order: [...elements.keys()], unseen, inView, atBottom: pinned })
  }
  const watch = page.watchInView(scroller, (entries) => {
    for (const entry of entries)
      if (entry.isInView) {
        inView.add(keyOf(entry.target))
        unseen.delete(keyOf(entry.target))
      } else inView.delete(keyOf(entry.target))
    update()
  })
  const onScroll = (): void => {
    pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM_PX
    if (pinned) unseen = new Set()
    update()
  }
  scroller.addEventListener('scroll', onScroll, { passive: true })
  indicator.addEventListener('click', () => scroller.scrollTo({ top: scroller.scrollHeight }))
  life.add(() => {
    scroller.removeEventListener('scroll', onScroll)
    watch.disconnect()
  })
  return {
    track: (key: string, element: HTMLElement): HTMLElement => {
      element.dataset.itemKey = key
      const known = elements.get(key)
      if (known !== undefined) watch.unobserve(known)
      elements.set(key, element)
      if (drawn.size === 0 && element.dataset.unread === 'true') unseen.add(key)
      watch.observe(element)
      return element
    },
    afterDraw: (): void => {
      const now = new Map(signatures())
      for (const key of [...elements.keys()]) if (!now.has(key)) elements.delete(key)
      if (drawn.size > 0) unseen = unseenAfterDraw(unseen, changedItems(drawn, now), pinned)
      drawn = now
      if (pinned) page.nextFrame(() => scroller.scrollTo({ top: scroller.scrollHeight }))
      update()
    },
    bringIntoView: (find: () => HTMLElement | null): void => {
      pinned = false
      page.nextFrame(() => {
        const card = find()
        card?.scrollIntoView({ block: 'center' })
        card?.focus({ preventScroll: true })
      })
    },
  }
}

/**
 * Marks a note read once it has been in view, but only once the person acted on the page when it
 * opened by itself, so that a conversation restored on its own is not read for them.
 */
export const markReadWhenSeen = (
  context: Pick<ViewContext, 'page' | 'state' | 'actions' | 'document'>,
  life: Lifetime,
  scroller: HTMLElement,
  viewerId: MemberId,
  id: ConversationId,
  noteWith: (noteId: string | null) => AsRead.Note | null,
) => {
  const { page, state, actions } = context
  const reported = new Set<string>()
  const inView = new Set<HTMLElement>()
  let waitingForThePerson = state.openedForThePerson.get() === id
  if (waitingForThePerson) scroller.dataset.reading = 'waiting-for-the-person'
  const report = (element: HTMLElement): void => {
    const note = noteWith(element.dataset.noteId ?? null)
    if (note === null || reported.has(note.id) || !isUnreadBy(note, viewerId)) return
    reported.add(note.id)
    actions.markRead(note)
  }
  const watch = page.watchInView(scroller, (entries) => {
    for (const entry of entries)
      if (entry.isInView) inView.add(entry.target)
      else inView.delete(entry.target)
    if (!page.isVisible() || waitingForThePerson) return
    for (const entry of entries) if (entry.isInView) report(entry.target)
  })
  const personActed = (event: Event): void => {
    if (!waitingForThePerson || !event.isTrusted) return
    waitingForThePerson = false
    delete scroller.dataset.reading
    state.openedForThePerson.set(null)
    for (const element of inView) report(element)
  }
  const stopListening = PERSON_ACTIONS.map((kind) =>
    context.document.listen(kind, personActed, { passive: true }),
  )
  life.add(() => {
    watch.disconnect()
    for (const stop of stopListening) stop()
  })
  return {
    watch: (element: HTMLElement): HTMLElement => {
      if (element.dataset.unread === 'true') watch.observe(element)
      return element
    },
  }
}

const NEAR_BOTTOM_PX = 120

const PERSON_ACTIONS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
