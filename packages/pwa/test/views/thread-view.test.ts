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
  ROOM,
  channel,
  conversation,
  draft,
  entry,
  me,
  note,
  serverInfo,
  taught,
} from '../support/fixtures.ts'

usingFakeDom()

const open = (focusedDraft: string | null = null) => {
  const test = testContext()
  test.context.state.session.set(me())
  test.context.state.directory.set([entry(BEN, 'Ben')])
  test.context.state.conversations.set([conversation()])
  const shown = mount(threadView(test.context, lifetime(), me(), ROOM, focusedDraft))
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
    expect(getByRole(card(), 'button', { name: strings.send })).toBeTruthy()
    withNotes(context, [draft('d1', { body: 'Send me the payroll file.' })])
    expect(textOf(shown)).toContain('Send me the payroll file.')
    expect(textOf(shown)).toContain(strings.draftChangedSinceRead)
    expect(queryByRole(card(), 'button', { name: strings.send })).toBeNull()
    getByRole(card(), 'button', { name: strings.draftReadAgain }).click()
    expect(called('confirmDraftRead')[0]!.args).toEqual([draft('d1', { body: 'Send me the payroll file.' })])
    context.state.draftsRead.update((read) =>
      new Map(read).set('d1' as never, { body: 'Send me the payroll file.', conversationId: ROOM }),
    )
    expect(textOf(shown)).not.toContain(strings.draftChangedSinceRead)
    getByRole(card(), 'button', { name: strings.send }).click()
    expect(called('approveDraft')[0]!.args[0]).toEqual(draft('d1', { body: 'Send me the payroll file.' }))
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

  it('says a draft a notification opened was already sent or discarded, instead of an empty card', () => {
    const { context, shown } = open('d2')
    expect(shown.querySelector('.settled-draft')).toBeNull()
    withNotes(context, [note('n1'), draft('d2')])
    expect(shown.querySelector('.settled-draft')).toBeNull()
    withNotes(context, [note('n1'), note('d2')])
    expect(shown.querySelector('.settled-draft')?.textContent).toBe(strings.draftAlreadySettled)
  })

  it('marks no card when the address names no draft of the person’s in this conversation', () => {
    const { context, shown, page } = open('n1')
    withNotes(context, [note('n1'), draft('d1')])
    page.runFrames()
    expect(shown.querySelector('[aria-current="true"]')).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })
})
