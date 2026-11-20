import { Task as T } from '@homingbird/kernel'
import { noteIdOfNoticeTag, noticeTag } from '@homingbird/protocol'
import { type Action, withApp } from '../app.ts'
import type { ShownNotification } from '../browser-page.ts'

/**
 * Closes this device's notifications about answers that no longer wait for this person: someone sent or
 * discarded them, or the person no longer reviews them. Read after the waiting answers are loaded again.
 */
export const closeSettledReviewNotices: Action = withApp(({ state }) => {
  const waiting = new Set<string>(state.reviews.get().map((review) => review.note.id))
  return closeShown((tag) => {
    const noteId = noteIdOfNoticeTag('review', tag)
    return noteId !== null && !waiting.has(noteId)
  })
})

/** Closes this device's notification about one of the person's own drafts, once it was sent or discarded. */
export const closeDraftNotice = (noteId: string): Action => {
  const tag = noticeTag('draft', noteId)
  return closeShown((shown) => shown === tag)
}

const closeShown = (isSettled: (tag: string) => boolean): Action =>
  withApp(({ page }) =>
    T.map((shown: ReadonlyArray<ShownNotification>) => {
      for (const notification of shown) if (isSettled(notification.tag)) notification.close()
    })(T.promise(() => page.shownNotifications())),
  )
