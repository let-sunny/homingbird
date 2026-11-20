import { Task as T } from '@homingbird/kernel'
import { REVIEWS_LIMIT, noteIdOfNoticeTag, noticeTag } from '@homingbird/protocol'
import { type Action, withApp } from '../app.ts'
import type { ShownNotification } from '../browser-page.ts'

/**
 * Closes this device's notifications about answers that no longer wait for this person: someone sent or
 * discarded them, or the person no longer reviews them. Only notifications shown before the list was
 * asked for are closed, and none when the list is full, since it may leave newer answers out.
 */
export const closeSettledReviewNotices = (requestedAt: number): Action =>
  withApp(({ state }) => {
    const reviews = state.reviews.get()
    if (reviews.length >= REVIEWS_LIMIT) return T.unit
    const waiting = new Set<string>(reviews.map((review) => review.note.id))
    return closeShownBefore(requestedAt, (tag) => {
      const noteId = noteIdOfNoticeTag('review', tag)
      return noteId !== null && !waiting.has(noteId)
    })
  })

/** Closes this device's notifications about the person's own drafts that are no longer open. */
export const closeSettledDraftNotices = (openDraftIds: Iterable<string>, requestedAt: number): Action => {
  const open = new Set(openDraftIds)
  return closeShownBefore(requestedAt, (tag) => {
    const noteId = noteIdOfNoticeTag('draft', tag)
    return noteId !== null && !open.has(noteId)
  })
}

/** Closes this device's notification about one of the person's own drafts, once it was sent or discarded. */
export const closeDraftNotice = (noteId: string): Action => {
  const tag = noticeTag('draft', noteId)
  return withApp(({ clock }) => closeShownBefore(clock.now(), (shown) => shown === tag))
}

const closeShownBefore = (moment: number, isSettled: (tag: string) => boolean): Action =>
  withApp(({ page }) =>
    T.map((shown: ReadonlyArray<ShownNotification>) => {
      for (const notification of shown)
        if (notification.shownAt !== null && notification.shownAt < moment && isSettled(notification.tag))
          notification.close()
    })(T.promise(() => page.shownNotifications())),
  )
