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

const open = () => {
  const test = testContext()
  test.context.state.session.set(me())
  test.context.state.directory.set([entry(BEN, 'Ben')])
  test.context.state.conversations.set([conversation()])
  const shown = mount(threadView(test.context, lifetime(), me(), ROOM))
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
    threadView(test.context, lifetime(), me(), ROOM)
    expect(test.called('refreshPrinciples')).toHaveLength(0)
    expect(test.called('refreshAgentReport')).toHaveLength(0)
    expect(queryByRole(document.body, 'button')).toBeNull()
  })
})
