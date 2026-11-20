import { type AsRead, type MemberId, type NoteId, REVIEWS_LIMIT } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  closeDraftNotice,
  closeSettledDraftNotices,
  closeSettledReviewNotices,
} from '../../src/tasks/notifications.ts'
import { testApp } from '../support/app.ts'
import { draft, member } from '../support/fixtures.ts'

const AGENT = 'mem_agent0000000' as MemberId
const ASKED_AT = 1_000

const waiting = (id: string): AsRead.Review => ({
  note: draft(id, { authorId: AGENT, inReplyTo: 'note_question000' as NoteId }),
  question: null,
  channel: 'payments-wiki',
  agent: member(AGENT, 'Payments wiki', { kind: 'channel_agent' }),
  privately: false,
})

const showing = (page: ReturnType<typeof testApp>['page'], shown: Record<string, number | null>) => {
  for (const [tag, shownAt] of Object.entries(shown)) page.notifications.set(tag, shownAt)
}

describe('the notification tasks', () => {
  it('close the notifications of answers that no longer wait, and leave every other one', async () => {
    const { run, state, page } = testApp()
    showing(page, { 'review:sent': 1, 'review:waiting': 1, 'draft:sent': 1, 'review:': 1, note: 1 })
    state.reviews.set([waiting('waiting')])
    await run(closeSettledReviewNotices(ASKED_AT))
    expect([...page.notifications.keys()]).toEqual(['review:waiting', 'draft:sent', 'review:', 'note'])
  })

  it('leave a notification shown after the list was asked for, or at an unknown time', async () => {
    const { run, page } = testApp()
    showing(page, { 'review:newer': ASKED_AT, 'review:unknown': null, 'review:older': ASKED_AT - 1 })
    await run(closeSettledReviewNotices(ASKED_AT))
    expect([...page.notifications.keys()]).toEqual(['review:newer', 'review:unknown'])
  })

  it('close nothing when the list of waiting answers is full and may leave newer ones out', async () => {
    const { run, state, page } = testApp()
    showing(page, { 'review:left-out': 1 })
    state.reviews.set(Array.from({ length: REVIEWS_LIMIT }, (_, index) => waiting(`note_${index}`)))
    await run(closeSettledReviewNotices(ASKED_AT))
    expect([...page.notifications.keys()]).toEqual(['review:left-out'])
  })

  it('close the notifications of the person’s drafts that are no longer open', async () => {
    const { run, page } = testApp()
    showing(page, { 'draft:open': 1, 'draft:sent': 1, 'draft:newer': ASKED_AT, 'review:sent': 1 })
    await run(closeSettledDraftNotices(['open'], ASKED_AT))
    expect([...page.notifications.keys()]).toEqual(['draft:open', 'draft:newer', 'review:sent'])
  })

  it('close only the notification about the one draft that was decided', async () => {
    const { run, page } = testApp()
    showing(page, { 'draft:d1': 1, 'draft:d10': 1, 'review:d1': 1 })
    await run(closeDraftNotice('d1'))
    expect([...page.notifications.keys()]).toEqual(['draft:d10', 'review:d1'])
  })
})
