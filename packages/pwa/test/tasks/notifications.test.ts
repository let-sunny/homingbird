import type { AsRead, MemberId, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { closeDraftNotice, closeSettledReviewNotices } from '../../src/tasks/notifications.ts'
import { testApp } from '../support/app.ts'
import { draft, member } from '../support/fixtures.ts'

const AGENT = 'mem_agent0000000' as MemberId

const waiting = (id: string): AsRead.Review => ({
  note: draft(id, { authorId: AGENT, inReplyTo: 'note_question000' as NoteId }),
  question: null,
  channel: 'payments-wiki',
  agent: member(AGENT, 'Payments wiki', { kind: 'channel_agent' }),
  privately: false,
})

describe('the notification tasks', () => {
  it('close the notifications of answers that no longer wait, and leave every other one', async () => {
    const { run, state, page } = testApp()
    for (const tag of ['review:sent', 'review:waiting', 'draft:sent', 'review:', 'note'])
      page.notifications.add(tag)
    state.reviews.set([waiting('waiting')])
    await run(closeSettledReviewNotices)
    expect([...page.notifications]).toEqual(['review:waiting', 'draft:sent', 'review:', 'note'])
  })

  it('close only the notification about the one draft that was decided', async () => {
    const { run, page } = testApp()
    for (const tag of ['draft:d1', 'draft:d10', 'review:d1']) page.notifications.add(tag)
    await run(closeDraftNotice('d1'))
    expect([...page.notifications]).toEqual(['draft:d10', 'review:d1'])
  })
})
