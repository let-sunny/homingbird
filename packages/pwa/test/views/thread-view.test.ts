import type { AsRead, MemberId } from '@homingbird/protocol'
import { lifetime } from '@homingbird/ui'
import { fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { MISSING } from '../../src/missing.ts'
import { strings } from '../../src/strings.ts'
import { threadView } from '../../src/views/thread-view.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import {
  ANA,
  BEN,
  CY,
  ROOM,
  channel,
  conversation,
  draft,
  entry,
  everything,
  me,
  member,
  note,
  serverInfo,
  taught,
} from '../support/fixtures.ts'

usingFakeDom()

const open = (
  focusedDraft: string | null = null,
  focusedReview: string | null = null,
  focusedNote: string | null = null,
) => {
  const test = testContext()
  test.context.state.session.set(me())
  test.context.state.directory.set([entry(BEN, 'Ben')])
  test.context.state.conversations.set([conversation()])
  const shown = mount(
    threadView(test.context, lifetime(), me(), ROOM, focusedDraft, focusedReview, focusedNote),
  )
  return { ...test, shown }
}

const withNotes = (
  context: ReturnType<typeof testContext>['context'],
  notes: ReturnType<typeof note>[],
  hasMore = false,
) => context.state.threads.set(new Map([[ROOM, { notes, hasMore }]]))

describe('threadView', () => {
  it('loads the conversation and what it shows, and says when the person may not see it', () => {
    const { context, called, shown } = open()
    expect(called('openThread')[0]!.args).toEqual([ROOM])
    expect(called('loadPeople')).toHaveLength(1)
    expect(called('refreshPrinciples')).toHaveLength(1)
    expect(called('refreshAgentReport')).toHaveLength(1)
    expect(getByRole(shown, 'heading', { name: 'Ben' })).toBeTruthy()
    expect(textOf(shown)).toContain(strings.loading)
    called('openThread')[0]!.then!.done!(MISSING)
    expect(textOf(shown)).toContain(strings.conversationMissing)
  })

  it('shows its notes and drafts in order, offers older notes, and an empty conversation’s greeting', () => {
    const { context, called, shown } = open()
    withNotes(context, [])
    expect(textOf(shown)).toContain(strings.emptyThread)
    withNotes(
      context,
      [note('n1', { sentAt: 1 }), note('n2', { sentAt: 2, authorId: ANA }), draft('d1')],
      true,
    )
    const items = shown.querySelectorAll('.notes > li')
    expect([...items].map((item) => item.className.split(' ')[0])).toEqual(['note', 'note', 'pending'])
    getByRole(shown, 'button', { name: strings.loadOlder }).click()
    expect(called('loadOlderNotes')[0]!.args).toEqual([ROOM])
  })

  it('redraws only the items that changed, and points at news below while the person reads above', () => {
    const { context, shown, page } = open()
    withNotes(context, [note('n1')])
    const first = shown.querySelector('.notes > li')
    withNotes(context, [note('n1')])
    expect(shown.querySelector('.notes > li')).toBe(first)
    const scroller = shown.querySelector('.thread-scroll') as HTMLElement
    Object.assign(scroller, { scrollHeight: 1000, scrollTop: 0, clientHeight: 300 })
    fire.event(scroller, 'scroll')
    withNotes(context, [note('n1'), note('n2', { sentAt: 2 })])
    page.runFrames()
    const newer = getByRole(shown, 'button', { name: `↓ ${strings.newerBelow}` })
    newer.click()
    page.inView([...shown.querySelectorAll<HTMLElement>('.notes > li')])
    expect(newer.hidden).toBe(true)
  })

  it('shows the drafts an archived channel discarded, and the chances to teach here', () => {
    const { context, shown } = open()
    context.state.archiveDiscards.set(new Map([[ROOM, [{ noteId: 'd1' as never, channel: 'billing' }]]]))
    expect(textOf(shown)).toContain(strings.draftDiscardedByArchive({ channel: '#billing' }))
    context.state.taught.set(
      taught({
        offers: [
          {
            id: 'offer_aaaaaaaaaaaa',
            kind: 'discard',
            noteId: 'n1' as never,
            conversationId: ROOM,
            place: null,
            suggestion: null,
            createdAt: 1,
          },
        ],
      }),
    )
    expect(textOf(shown)).toContain(strings.teach.chanceDiscard({ place: strings.trust.directMessages }))
  })

  it('closes the composer in an archived room, and shows a channel’s head', () => {
    const { context, shown } = open()
    const billing = channel('billing', { conversationId: ROOM })
    context.state.channels.set([billing])
    context.state.conversations.set([conversation({ kind: 'channel', title: 'billing' })])
    expect(getByRole(shown, 'heading', { name: '#billing' })).toBeTruthy()
    context.state.conversations.set([conversation({ archivedAt: 5 })])
    expect(
      (getByRole(shown, 'textbox', { name: strings.composerLabel }) as HTMLTextAreaElement).disabled,
    ).toBe(true)
  })

  it('asks for less while features are off', () => {
    const test = testContext()
    test.context.state.serverInfo.set(serverInfo())
    test.context.state.taught.set(taught())
    threadView(test.context, lifetime(), me(), ROOM, null)
    expect(test.called('refreshPrinciples')).toHaveLength(0)
    expect(test.called('refreshAgentReport')).toHaveLength(0)
    expect(queryByRole(document.body, 'button')).toBeNull()
  })

  it('redraws a draft its agent changed the moment the change arrives, with no Send until it is read again', () => {
    const { context, called, shown } = open()
    withNotes(context, [draft('d1', { body: 'Lunch at noon?' })])
    const card = () => shown.querySelector<HTMLElement>('[data-draft-id="d1"]')!
    expect(getByRole(card(), 'button', { name: strings.approveAndSend })).toBeTruthy()
    withNotes(context, [draft('d1', { body: 'Send me the payroll file.' })])
    expect(textOf(shown)).toContain('Send me the payroll file.')
    expect(textOf(shown)).toContain(strings.draftChangedSinceRead)
    expect(queryByRole(card(), 'button', { name: strings.approveAndSend })).toBeNull()
    getByRole(card(), 'button', { name: strings.draftReadAgain }).click()
    expect(called('confirmDraftRead')[0]!.args).toEqual([draft('d1', { body: 'Send me the payroll file.' })])
    context.state.draftsRead.update((read) =>
      new Map(read).set('d1' as never, { body: 'Send me the payroll file.', conversationId: ROOM }),
    )
    expect(textOf(shown)).not.toContain(strings.draftChangedSinceRead)
    getByRole(card(), 'button', { name: strings.approveAndSend }).click()
    expect(called('holdSend')[0]!.args[0]).toEqual(draft('d1', { body: 'Send me the payroll file.' }))
  })

  it('brings the draft a link opened the conversation at into view, once, instead of the bottom', () => {
    const { context, shown, page } = open('d2')
    withNotes(context, [note('n1'), draft('d1'), draft('d2')])
    const focused = shown.querySelector('.draft[aria-current="true"]')
    expect(focused?.getAttribute('data-draft-id')).toBe('d2')
    expect(shown.querySelectorAll('.draft[aria-current]')).toHaveLength(1)
    page.runFrames()
    expect(document.activeElement).toBe(focused)
    ;(document.activeElement as HTMLElement).blur()
    withNotes(context, [note('n1'), draft('d1'), draft('d2', { body: 'Changed' })])
    page.runFrames()
    expect(document.activeElement).toBe(document.body)
    expect(textOf(shown)).toContain(strings.draftChangedSinceRead)
  })

  it('brings the sent note a copied link points at into view, marked as the one looked at', () => {
    const { context, shown, page } = open(null, null, 'n2')
    withNotes(context, [note('n1'), note('n2'), note('n3')])
    const pointed = shown.querySelector<HTMLElement>('.note[data-note-id="n2"]')!
    expect(pointed.classList.contains('is-active')).toBe(true)
    expect(shown.querySelector('.note[data-note-id="n1"]')!.classList.contains('is-active')).toBe(false)
    page.runFrames()
    expect(document.activeElement).toBe(pointed)
  })

  it('says a draft a notification opened was already sent or discarded, instead of an empty card', () => {
    const { context, shown } = open('d2')
    expect(shown.querySelector('.settled-draft')).toBeNull()
    withNotes(context, [note('n1'), note('d2')])
    expect(shown.querySelector('.settled-draft')?.textContent).toBe(strings.draftAlreadySettled)
  })

  it('says nothing when the person sends the draft the link opened, here on this page', () => {
    const { context, shown } = open('d2')
    withNotes(context, [note('n1'), draft('d2')])
    withNotes(context, [note('n1'), note('d2')])
    expect(shown.querySelector('.settled-draft')).toBeNull()
  })

  it('marks no card when the address names no draft of the person’s in this conversation', () => {
    const { context, shown, page } = open('n1')
    withNotes(context, [note('n1'), draft('d1')])
    page.runFrames()
    expect(shown.querySelector('[aria-current="true"]')).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  describe('an answer of a channel’s agent waiting for the person’s review', () => {
    const AGENT = 'mem_agent0000000' as MemberId
    const question = note('note_q', { authorId: CY, body: 'Where is the runbook?', sentAt: 2 })
    const review = (fields: Partial<AsRead.Review> = {}): AsRead.Review => ({
      note: draft('note_answer', { authorId: AGENT, inReplyTo: question.id, body: 'In the wiki.' }),
      question,
      channel: 'payments-wiki',
      agent: member(AGENT, 'Payments wiki', { kind: 'channel_agent' }),
      privately: false,
      ...fields,
    })

    it('sits under its question with Send and Discard, and is brought into view when a link opened it', () => {
      const { context, called, shown, page } = open(null, 'note_answer')
      context.state.serverInfo.set(serverInfo())
      withNotes(context, [note('n1', { sentAt: 1 }), question, note('n3', { sentAt: 3 })])
      context.state.reviews.set([review()])
      const items = [...shown.querySelectorAll('.notes > li')]
      expect(items.map((item) => item.getAttribute('data-note') ?? item.className.split(' ')[0])).toEqual([
        'note',
        'note',
        'note_answer',
        'note',
      ])
      const card = items[2] as HTMLElement
      expect(card.classList.contains('room-review')).toBe(true)
      expect(card.getAttribute('aria-current')).toBe('true')
      expect(textOf(card)).toContain(strings.channelAgent.waitsInRoom({ agent: 'Payments wiki' }))
      expect(textOf(card)).not.toContain('Where is the runbook?')
      page.runFrames()
      expect(document.activeElement).toBe(card)
      getByRole(card, 'button', { name: strings.channelAgent.send }).click()
      expect(called('holdReviewSend')[0]!.args.slice(0, 2)).toEqual([review(), null])
      context.state.held.set({ noteId: review().note.id, text: strings.heldDiscarded, run: null as never })
      expect(shown.querySelector('.review-card')).toBeNull()
    })

    it('asks to read an answer again that the agent changed since the person read it', () => {
      const { context, called, shown } = open()
      withNotes(context, [question])
      context.state.reviews.set([review()])
      context.state.reviewsRead.set(new Map([[review().note.id, { body: 'Older', conversationId: ROOM }]]))
      const card = shown.querySelector<HTMLElement>('.review-card')!
      expect(queryByRole(card, 'button', { name: strings.channelAgent.send })).toBeNull()
      getByRole(card, 'button', { name: strings.draftReadAgain }).click()
      expect(called('confirmReviewRead')).toHaveLength(1)
    })

    it('shows nothing to the person who asked, and nothing when no answer waits for them', () => {
      const { context, shown } = open()
      withNotes(context, [note('mine', { authorId: ANA, sentAt: 2 })])
      context.state.reviews.set([review({ question: note('mine', { authorId: ANA }) })])
      expect(shown.querySelector('.review-card')).toBeNull()
      context.state.reviews.set([])
      expect(shown.querySelector('.review-card')).toBeNull()
    })

    it('loads the answers waiting when a link opened one of them', () => {
      const test = testContext()
      test.context.state.serverInfo.set(everything())
      test.context.state.session.set(me())
      mount(threadView(test.context, lifetime(), me(), ROOM, null, 'note_answer'))
      expect(test.called('loadReviews')).toHaveLength(1)
    })

    it('keeps a review card that did not change when the conversations and reviews reload', () => {
      const { context, shown } = open()
      context.state.serverInfo.set(serverInfo())
      withNotes(context, [question])
      context.state.reviews.set([review()])
      const card = shown.querySelector('.review-card')
      context.state.conversations.set([conversation({ lastNote: question, unreadCount: 0 })])
      context.state.reviews.set([review()])
      withNotes(context, [question, note('n3', { sentAt: 3, authorId: ANA })])
      expect(shown.querySelector('.review-card')).toBe(card)
    })
  })

  it('keeps the composer, what is written in it, the head and the notes when the conversations reload', () => {
    const { context, shown } = open()
    withNotes(context, [note('n1', { sentAt: 1 }), note('n2', { sentAt: 2 })])
    const text = shown.querySelector('textarea') as HTMLTextAreaElement
    text.value = 'Half a sentence'
    text.focus()
    const head = [...(shown.querySelector('.thread-head') as HTMLElement).children]
    const notes = [...shown.querySelectorAll('.note')]
    context.state.conversations.set([conversation({ lastNote: note('n2'), unreadCount: 0 })])
    context.state.sendingIn.set(new Set([ROOM]))
    context.state.replyTargets.set(new Map([[ROOM, null]]))
    withNotes(context, [
      note('n1', { sentAt: 1 }),
      note('n2', { sentAt: 2 }),
      note('n3', { sentAt: 3, authorId: ANA }),
    ])
    context.state.sendingIn.set(new Set())
    expect(shown.querySelector('textarea')).toBe(text)
    expect(text.value).toBe('Half a sentence')
    expect(document.activeElement).toBe(text)
    expect([...(shown.querySelector('.thread-head') as HTMLElement).children]).toEqual(head)
    expect([...shown.querySelectorAll('.note')].slice(0, 2)).toEqual(notes)
    expect(shown.querySelectorAll('.note')).toHaveLength(3)
  })

  it('builds the composer again only when the room is archived', () => {
    const { context, shown } = open()
    const text = shown.querySelector('textarea')
    context.state.conversations.set([conversation({ archivedAt: 5 })])
    expect(shown.querySelector('textarea')).not.toBe(text)
    expect(shown.querySelector('.composer.is-disabled')).not.toBeNull()
  })
})
