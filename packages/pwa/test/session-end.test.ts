import { Task as T } from '@homingbird/kernel'
import { textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { createApp, withApp } from '../src/app.ts'
import { keptComposerTexts } from '../src/composer-texts.ts'
import { browserDocument } from '../src/page-document.ts'
import { guardRestoredPage } from '../src/restored-page.ts'
import { createState } from '../src/state.ts'
import { signOut } from '../src/tasks/account.ts'
import { saveSettings } from '../src/tasks/admin.ts'
import { boot } from '../src/tasks/boot.ts'
import { commitHeld, holdDecision } from '../src/tasks/held.ts'
import { liveEvents } from '../src/tasks/live.ts'
import { reloadPreviews } from '../src/tasks/previews.ts'
import { refreshInterview } from '../src/tasks/teaching-interview.ts'
import { refreshPrinciples } from '../src/tasks/teaching.ts'
import { keptUnsettled } from '../src/unsettled-decisions.ts'
import { showApp } from '../src/views/app-shell.ts'
import { createViewContext } from '../src/views/context.ts'
import { DIALOG_ID, showDialog } from '../src/views/dialog.ts'
import { fail, hold, settle, testApp } from './support/app.ts'
import { mount, usingFakeDom } from './support/dom.ts'
import {
  ANA,
  BEN,
  ROOM,
  conversation,
  entry,
  everything,
  me,
  member,
  note,
  serverInfo,
} from './support/fixtures.ts'
import { heldDecision } from './support/held.ts'

usingFakeDom()

const NOTE = note('n1', { body: 'For Ana only' })

const workspace = {
  'server.info': () => everything(),
  'conversations.list': () => ({ conversations: [conversation({ lastNote: NOTE })] }),
  'directory.list': () => ({ entries: [entry(BEN, 'Ben')] }),
  'contacts.list': () => ({ contacts: [] }),
  'draftRequests.list': () => ({ requests: [] }),
  'credentials.list': () => ({ credentials: [] }),
  'channels.list': () => ({ channels: [], hasMore: false, cursor: null }),
  'reviews.list': () => ({ reviews: [] }),
  'inbox.list': () => ({ items: [] }),
  'drafts.list': () => ({ drafts: [] }),
  'debates.list': () => ({ debates: [] }),
  'groups.list': () => ({ groups: [] }),
  'debateSuggestions.list': () => ({ suggestions: [] }),
  'events.poll': () => ({ events: [], cursor: 0 }),
}

/** The whole page, signed in and live, with its stream open. */
const signedInPage = async (handlers: Parameters<typeof testApp>[0] = {}) => {
  const test = testApp({ ...workspace, 'me.get': () => me(), ...handlers })
  const { app, page } = test
  const streams: AbortSignal[] = []
  Object.assign(page.page, {
    fetch: (url: string, init?: RequestInit) => {
      if (!url.includes('/events/')) return Promise.resolve(new Response('{}'))
      streams.push(init!.signal!)
      return Promise.resolve(new Response(new ReadableStream()))
    },
  })
  const root = mount(document.createElement('div'))
  const context = createViewContext(
    app,
    browserDocument(() => document),
  )
  showApp(context, root, app.launch)
  guardRestoredPage(app, root)
  app.launch(boot)
  for (let round = 0; round < 10; round++) await settle()
  return { ...test, root, context, openStreams: () => streams.filter((signal) => !signal.aborted).length }
}

type SignedInPage = Awaited<ReturnType<typeof signedInPage>>

const expectNothingRuns = async ({ app, page, clock, sent, openStreams }: SignedInPage) => {
  const before = sent.length
  await settle()
  expect(clock.pending()).toBe(0)
  for (const event of ['online', 'visibilitychange', 'offline', 'pagehide', 'online'] as const)
    page.emit(event)
  await clock.advance(10 * 60_000)
  expect(sent.slice(before)).toEqual([])
  expect(openStreams()).toBe(0)
  expect(clock.pending()).toBe(0)
  expect(page.listening('online')).toBe(0)
  expect(page.listening('visibilitychange')).toBe(0)
  expect(app.state.connection.get()).toBe('connecting')
}

const expectNothingPersonal = ({ state, root, page }: SignedInPage) => {
  const fresh = createState('') as unknown as Record<string, { get: () => unknown }>
  for (const [key, part] of Object.entries(state))
    if (!['session', 'serverInfo', 'branding', 'route'].includes(key) && 'get' in (part as object))
      expect((part as { get: () => unknown }).get(), key).toEqual(fresh[key]!.get())
  expect(state.session.get()).toBeNull()
  expect(textOf(root)).not.toContain('Ben')
  expect(textOf(root)).not.toContain('For Ana only')
  expect(root.querySelector('.sign-in')).not.toBeNull()
  expect(page.outside).toEqual({ title: state.branding.get().name, badge: null })
}

/** The page loaded anew in the same browser, as signing in does, with nothing of the one before but its storage. */
const nextPageAfter = async (before: SignedInPage, person: ReturnType<typeof me>) => {
  const test = testApp({ ...workspace, 'me.get': () => person, 'directory.list': () => ({ entries: [] }) })
  const { clock, random } = test.app
  const { page } = before.page
  const app = createApp({ clock, random, page, api: test.api, state: createState('') }, boot)
  app.launch(boot)
  for (let round = 0; round < 10; round++) await settle()
  return app.state
}

describe('the end of a session', () => {
  it('stops every request, stream and timer and holds nothing personal after a 401 anywhere', async () => {
    const late = hold<unknown>()
    let isRevoked = false
    const page = await signedInPage({
      'conversations.list': () =>
        isRevoked ? fail({ _tag: 'Unauthorized', message: 'revoked' }) : workspace['conversations.list'](),
      'directory.list': () => (isRevoked ? late.waiting : workspace['directory.list']()),
    })
    expect(textOf(page.root)).toContain('Ben')
    expect(page.openStreams()).toBe(1)
    let dialogEnded = false
    showDialog(page.context, 'About Ben', (life) => {
      life.add(() => {
        dialogEnded = true
      })
      return 'Ben'
    })
    page.state.previewedBodies.set(new Map([['note_p1' as never, 'Early words']]))
    page.app.launch(holdDecision(heldDecision('d1')))
    await settle()
    isRevoked = true
    page.app.launch(boot)
    page.context.actions.loadConversations()
    await settle()
    late.release({ entries: [entry(BEN, 'Ben')] })
    await settle()
    expectNothingPersonal(page)
    expect(document.getElementById(DIALOG_ID)).toBeNull()
    expect(dialogEnded).toBe(true)
    await expectNothingRuns(page)
    expectNothingPersonal(page)
    expect(page.page.visited).toEqual([])
  })

  it('ends when only the background notices: the event stream, or the report of the page being visible', async () => {
    const streamed = await signedInPage()
    Object.assign(streamed.page.page, { fetch: () => Promise.resolve(new Response('', { status: 401 })) })
    streamed.page.emit('online')
    await settle()
    expectNothingPersonal(streamed)
    await expectNothingRuns(streamed)
    let isRevoked = false
    const reported = await signedInPage({
      'presence.visibility': () => (isRevoked ? fail({ _tag: 'Unauthorized', message: 'revoked' }) : {}),
    })
    isRevoked = true
    reported.page.emit('visibilitychange')
    await settle()
    expectNothingPersonal(reported)
    await expectNothingRuns(reported)
  })

  it.each([
    ['principles.list', (page: SignedInPage) => page.app.launch(refreshPrinciples)],
    ['principleProposals.list', (page: SignedInPage) => page.app.launch(refreshInterview)],
    ['server.info', (page: SignedInPage) => page.app.launch(saveSettings({} as never))],
    ['previews.list', (page: SignedInPage) => page.app.launch(reloadPreviews)],
  ] as const)('ends at a 401 of %s, whose task keeps other failures to itself', async (route, ask) => {
    let isRevoked = false
    const answer = route === 'server.info' ? everything : () => ({})
    const page = await signedInPage({
      [route]: () => (isRevoked ? fail({ _tag: 'Unauthorized', message: 'revoked' }) : answer()),
    })
    page.state.serverInfo.set(serverInfo({ draftPreviews: true }))
    isRevoked = true
    page.state.previews.set(new Map([[ROOM, []]]))
    ask(page)
    await settle()
    expect(page.routes()).toContain(route)
    expectNothingPersonal(page)
    await expectNothingRuns(page)
  })

  it('empties the page at sign-out, before it goes, and starts anew when brought back', async () => {
    const page = await signedInPage()
    page.app.launch(signOut)
    await settle()
    expect(page.page.visited).toEqual(['assign /'])
    expectNothingPersonal(page)
    await expectNothingRuns(page)
    page.page.restore()
    expect(page.page.visited).toEqual(['assign /', 'reload'])
  })

  it('cancels the reloads a live event had put off', async () => {
    const page = await signedInPage()
    const before = page.clock.pending()
    liveEvents(page.app)({ seq: 0, at: 1, body: { type: 'directory.changed', memberId: BEN } })
    await settle()
    expect(page.clock.pending()).toBe(before + 1)
    page.app.endSession()
    await expectNothingRuns(page)
  })

  it('keeps the decision not carried out and the unsent text in this browser, for that person alone', async () => {
    const page = await signedInPage()
    const { storage } = page.page.page
    storage.setLocal(`homingbird.composer.${ANA}`, JSON.stringify({ [ROOM]: 'Half a thought' }))
    page.app.launch(holdDecision(heldDecision('d1')))
    await settle()
    page.app.endSession()
    await settle()
    expect(keptUnsettled(storage, ANA).map((one) => one.noteId)).toEqual(['d1'])
    expect(keptComposerTexts(storage, ANA)).toEqual(new Map([[ROOM, 'Half a thought']]))
    const next = await nextPageAfter(page, { ...me(), member: member(BEN, 'Bob') })
    expect([...next.members.get().keys()]).toEqual([BEN])
    expect(next.composerTexts.get().size).toBe(0)
    expect(next.notice.get()).toBeNull()
    expect(keptUnsettled(storage, ANA)).toHaveLength(1)
  })

  it('keeps a decision on its way when the session ended, since its answer was not heard', async () => {
    const page = await signedInPage({ 'drafts.send': () => hold().waiting })
    const send = withApp(({ api }) =>
      T.asUnit(api['drafts.send']({ params: { id: 'd1' as never }, body: {} as never })),
    )
    page.app.launch(holdDecision(heldDecision('d1', { run: send })))
    await settle()
    page.app.launch(commitHeld)
    await settle()
    page.app.endSession()
    await settle()
    expect(page.aborted).toEqual(['drafts.send'])
    expect(keptUnsettled(page.page.page.storage, ANA).map((one) => one.noteId)).toEqual(['d1'])
    expect(page.state.held.get()).toEqual([])
  })
})
