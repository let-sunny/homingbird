import { httpApi } from '@homingbird/client'
import { makeTestClock } from '@homingbird/kernel'
import { createApp } from '@homingbird/pwa/src/app.ts'
import { browserDocument } from '@homingbird/pwa/src/page-document.ts'
import { createState } from '@homingbird/pwa/src/state.ts'
import { boot } from '@homingbird/pwa/src/tasks/boot.ts'
import { loadConversations } from '@homingbird/pwa/src/tasks/workspace.ts'
import { showApp } from '@homingbird/pwa/src/views/app-shell.ts'
import { createViewContext } from '@homingbird/pwa/src/views/context.ts'
import { fakePage } from '@homingbird/pwa/test/support/context.ts'
import { fire, getByRole, installFakeDom, uninstallFakeDom } from '@homingbird/ui/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { demoPage } from '../src/demo-page.ts'
import { fakeDovecote } from '../src/dovecote.ts'
import { VISITOR_ID } from '../src/team.ts'
import { createWorld } from '../src/world.ts'
import { NOW, demoApi, memberNamed, noteStarting, succeeded } from './support/demo.ts'

beforeEach(() => void installFakeDom())
afterEach(() => uninstallFakeDom())

/** The demo as `main.ts` starts it, on the fake document and a test clock. */
const startDemo = async (hash = '#/') => {
  const clock = makeTestClock(NOW)
  const world = createWorld(clock)
  const dovecote = fakeDovecote(world)
  const browser = fakePage(hash)
  browser.local.set('homingbird.tour', 'seen')
  const page = demoPage(browser.page, dovecote, () => {})
  const app = createApp(
    {
      clock,
      api: httpApi({ serverUrl: page.origin, fetch: dovecote }),
      state: createState(hash),
      page,
      random: { id: () => 'page-id', seed: () => 7 },
    },
    loadConversations,
  )
  const root = document.createElement('div')
  document.body.append(root)
  showApp(
    createViewContext(
      app,
      browserDocument(() => document),
    ),
    root,
    app.launch,
  )
  app.launch(boot)
  const settle = () => clock.advance(1_000)
  await settle()
  /** Goes to a link's address, as a click on it does in the browser. */
  const open = async (href: string) => {
    browser.state.hash = href
    browser.emit('hashchange')
    await settle()
  }
  return { root, world, app, settle, open }
}

describe('the demo', () => {
  it('signs the visitor in without a sign-in page, and shows their agent’s draft waiting in Ana’s conversation', async () => {
    const { root, app, world, open } = await startDemo()
    const session = app.state.session.get()
    expect(session !== null && session !== 'loading' && session.member.name).toBe('June Park')
    const room = noteStarting(world, 'Yes. I checked').conversationId
    const link = root.querySelector(`a[href="#/c/${room}"]`)
    expect(link?.textContent).toContain('Ana Silva')
    await open(`#/c/${room}`)
    const draft = root.querySelector('.pending .draft')
    expect(draft?.textContent).toContain('Yes. I checked the lock ordering')
    expect(app.state.reviews.get()).toHaveLength(1)
  })

  it('sends the draft on a click, and the note arrives in the conversation', async () => {
    const { root, settle, world, open } = await startDemo()
    await open(`#/c/${noteStarting(world, 'Yes. I checked').conversationId}`)
    const draft = root.querySelector('.pending .draft') as HTMLElement
    fire.click(getByRole(draft, 'button', { name: 'Send' }))
    await settle()
    expect(root.querySelector('.pending .draft')).toBeNull()
    const mine = [...root.querySelectorAll('.note.is-mine')].map((note) => note.textContent ?? '')
    expect(mine.some((text) => text.includes('Yes. I checked the lock ordering'))).toBe(true)
    expect(noteStarting(world, 'Yes. I checked').status).toBe('sent')
  })

  it('lets a manager send the channel’s agent’s answer from the review page, and records who approved it', async () => {
    const { root, settle, world, app, open } = await startDemo()
    await open('#/channel/billing/agent')
    expect(root.textContent).toContain('Annual plans are refunded pro rata')
    fire.click(getByRole(root.querySelector('main') as HTMLElement, 'button', { name: 'Send' }))
    await settle()
    expect(app.state.reviews.get()).toEqual([])
    expect(noteStarting(world, 'Annual plans are refunded')).toMatchObject({
      status: 'sent',
      approvedBy: VISITOR_ID,
    })
  })
})

describe('sending a note in the demo', () => {
  it('keeps the composer, the thread head, the notes and the other sidebar rows it already showed', async () => {
    const { root, settle, world, open } = await startDemo()
    const room = noteStarting(world, 'Yes. I checked').conversationId
    await open(`#/c/${room}`)
    const before = shownParts(root, room)
    before.text.focus()
    before.text.value = 'Thanks, merging now.'
    fire.submit(before.composer)
    await settle()
    const after = shownParts(root, room)
    expect(after.notes.at(-1)?.textContent).toContain('Thanks, merging now.')
    expect(before.otherRows.length).toBeGreaterThan(0)
    expect(keptParts(before, after)).toEqual(allKept(before))
  })

  it('leaves what the person is writing alone when a colleague’s note arrives, redrawing only the note it follows', async () => {
    const { root, settle, world, open } = await startDemo()
    const room = noteStarting(world, 'Yes. I checked').conversationId
    await open(`#/c/${room}`)
    const before = shownParts(root, room)
    before.text.focus()
    before.text.value = 'Half a thou'
    const ana = demoApi(memberNamed(world, 'Ana Silva'), world).api
    const draft = await succeeded(
      ana['drafts.create']({ body: { body: 'One more thing: the ledger lock.', conversationId: room } }),
    )
    await succeeded(
      ana['drafts.send']({
        params: { id: draft.id },
        body: { expected: { body: draft.body, conversationId: room } },
      }),
    )
    await settle()
    const after = shownParts(root, room)
    expect(after.notes.at(-1)?.textContent).toContain('One more thing: the ledger lock.')
    expect(after.text.value).toBe('Half a thou')
    expect(keptParts(before, after)).toEqual({ ...allKept(before), notes: before.notes.length - 1 })
    expect(after.notes).not.toContain(before.notes.at(-1))
  })
})

type Parts = ReturnType<typeof shownParts>

const keptParts = (before: Parts, after: Parts) => ({
  composer: after.composer === before.composer,
  text: after.text === before.text,
  focus: document.activeElement === before.text,
  head: keptOf(before.head, after.head),
  notes: keptOf(before.notes, after.notes),
  otherRows: keptOf(before.otherRows, after.otherRows),
})

const allKept = (before: Parts) => ({
  composer: true,
  text: true,
  focus: true,
  head: before.head.length,
  notes: before.notes.length,
  otherRows: before.otherRows.length,
})

/** The nodes a send must leave in place, found in the page as it is now. */
const shownParts = (root: HTMLElement, room: string) => {
  const composer = root.querySelector('form.composer') as HTMLFormElement
  return {
    composer,
    text: composer.querySelector('textarea') as HTMLTextAreaElement,
    head: [...(root.querySelector('.thread-head') as HTMLElement).children],
    notes: [...root.querySelectorAll('.notes .note')],
    otherRows: [...root.querySelectorAll('.conversation-item')].filter(
      (row) => row.querySelector(`a[href="#/c/${room}"]`) === null,
    ),
  }
}

const keptOf = (before: ReadonlyArray<Element>, after: ReadonlyArray<Element>): number =>
  before.filter((node) => after.includes(node)).length
