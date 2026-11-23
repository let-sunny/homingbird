import { strict as assert } from 'node:assert'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  KEY_CONTROLS,
  type Person,
  VIEWPORT,
  api,
  clippedText,
  connectAgent,
  contrastProblems,
  crowdedFields,
  freePort,
  newPage,
  overflowsSideways,
  pastTheRightEdge,
  sendThroughApi,
  signInWith,
  startDovecote,
  submitDevelopmentLogin,
} from './support.ts'

const screenshots = process.env.HB_E2E_SCREENSHOTS_PAGES ?? join(tmpdir(), 'homingbird-e2e-pages')
const { chromium } = createRequire(import.meta.url)('playwright')

const NARROW = { width: 390, height: 780 }

/** Photographed and checked; the in-between widths are only checked, in the light scheme. */
const WIDTHS = [
  { name: 'wide', viewport: VIEWPORT, photographed: true },
  { name: 'narrow', viewport: NARROW, photographed: true },
  { name: 'medium', viewport: { width: 480, height: 780 }, photographed: false },
  { name: 'smallest', viewport: { width: 320, height: 640 }, photographed: false },
] as const

/**
 * Every main page, empty and in use, wide and at 480, 390 and 320 px, light and dark, in English and
 * Korean: none may reach past the right edge or scroll sideways, and each wide and 390 px view is
 * photographed under the same name so two runs can be compared side by side.
 */
const scenario = async (): Promise<void> => {
  const port = await freePort()
  const base = `http://localhost:${port}`
  await rm(screenshots, { recursive: true, force: true })
  await mkdir(screenshots, { recursive: true })
  const dovecote = await startDovecote(port, join(tmpdir(), `homingbird-e2e-pages-${port}.sqlite`))
  const browser = await chromium.launch()
  const signIn = signInWith(browser, base)
  const problems: string[] = []

  const photograph = async (email: string, name: string, state: string, pages: ReadonlyArray<Page>) => {
    for (const locale of ['en-US', 'ko-KR'])
      for (const { name: width, viewport, photographed } of WIDTHS) {
        const person: Person = await newPage(browser, base, locale, { viewport, deviceScaleFactor: 1 })
        await submitDevelopmentLogin(person.page, email, name)
        await person.page.waitForSelector('.app')
        for (const shown of pages) {
          // A new hash alone keeps the previous page in the document until the next one renders.
          await person.page.goto(`${base}/${shown.hash}`)
          await person.page.reload()
          await person.page.waitForSelector(shown.ready)
          for (const scheme of photographed ? ['light', 'dark'] : ['light']) {
            await person.page.emulateMedia({ colorScheme: scheme })
            await settled(person.page)
            const label = `${state}-${shown.name}-${width}-${scheme}-${locale.slice(0, 2)}`
            if (photographed) await person.page.screenshot({ path: join(screenshots, `${label}.png`) })
            for (const problem of await contrastProblems(person.page, KEY_CONTROLS))
              problems.push(`${label}: ${problem.what} ${problem.ratio}:1, needs ${problem.needed}:1`)
            if (width !== 'wide') {
              if (await overflowsSideways(person.page)) problems.push(`${label} scrolls sideways`)
              const past = await pastTheRightEdge(person.page)
              if (past.length > 0) problems.push(`${label} reaches past the right edge: ${past.join(', ')}`)
              for (const field of await crowdedFields(person.page)) problems.push(`${label} crowds ${field}`)
              for (const text of await clippedText(person.page)) problems.push(`${label} clips ${text}`)
            }
          }
        }
        await person.context.close()
      }
  }

  try {
    const ana = await signIn('ana@example.com', 'Ana')
    await signIn('cy@example.com', 'Cy')

    // -- Empty: nothing written, no channel, no flock ---------------------------------------
    await photograph('ana@example.com', 'Ana', 'empty', [
      { name: 'notes', hash: '#/', ready: '.sidebar' },
      { name: 'my-agent', hash: '#/agent', ready: '.my-agent-section' },
      { name: 'people', hash: '#/people', ready: '.people-filters' },
      { name: 'channels', hash: '#/channels', ready: '.channels-intro' },
      { name: 'debates', hash: '#/debates', ready: '.debates-intro' },
      { name: 'search', hash: '#/search?q=refund', ready: '.search-form' },
      { name: 'admin-members', hash: '#/admin/members', ready: '.members .member' },
    ])

    // -- In use: a conversation with a draft waiting, channels and a flock ------------------
    const june = await signIn('june@example.com', 'June')
    const ben = await signIn('ben@example.com', 'Ben')
    const ids = Object.fromEntries(
      await Promise.all(
        [ana, june, ben].map(async (person) => [person.name, (await api(person, 'GET', '/me')).member.id]),
      ),
    ) as Record<string, string>
    const anaAgent = await connectAgent(base, ana, 'Ana laptop')
    const direct = await api(ana, 'POST', '/conversations', { participantIds: [ids.June] })
    await sendThroughApi(june, {
      conversationId: direct.id,
      body: 'Is the refund migration safe to run today? Plan: https://example.com/plans/refunds',
    })
    const question = (await api(ana, 'GET', `/conversations/${direct.id}/notes`)).notes[0]
    await anaAgent.call('POST', '/drafts', {
      conversationId: direct.id,
      inReplyTo: question.id,
      body: 'Yes. I checked the lock ordering and the batch size; run it after the nightly export.',
    })
    await api(ana, 'POST', '/channels', { slug: 'billing', description: 'Invoices, refunds and payments.' })
    await api(ana, 'POST', '/channels', { slug: 'deploys', description: 'Release trains and rollbacks.' })
    await api(june, 'PUT', '/channels/billing/membership', { answering: true })
    await api(ana, 'PUT', '/channels/billing/membership', {})
    await sendThroughApi(ben, {
      channel: 'billing',
      body: 'Who can explain the refund rule for annual plans?',
    })
    await api(ana, 'POST', '/debates', {
      question: 'Should we ship the refund migration this week?',
      memberIds: [ids.June],
    })

    await photograph('ana@example.com', 'Ana', 'in-use', [
      { name: 'notes', hash: '#/', ready: '.conversation-list' },
      { name: 'thread', hash: `#/c/${direct.id}`, ready: '.pending .draft' },
      { name: 'my-agent', hash: '#/agent', ready: '.my-agent-section' },
      { name: 'people', hash: '#/people', ready: '.people-filters ~ * .person' },
      { name: 'channels', hash: '#/channels', ready: '.channel-card' },
      { name: 'debates', hash: '#/debates', ready: '.debate-card' },
      { name: 'search', hash: '#/search?q=refund', ready: '.search-form' },
      { name: 'admin-settings', hash: '#/admin/settings', ready: '.features' },
      { name: 'admin-members', hash: '#/admin/members', ready: '.members .member' },
    ])
  } finally {
    await browser.close()
    await dovecote.stop()
  }
  assert.deepEqual(problems, [], 'every main page fits at 480, 390 and 320 px and keeps its contrast')
}

/**
 * Waits until nothing on the page is loading, the fonts are in, every animation that ends has ended
 * (a view transition still showing the page before, a fade-in; scroll-driven ones never end), and two frames have been drawn.
 */
const settled = async (page: any): Promise<void> => {
  await page.waitForFunction(() => {
    const { document } = globalThis as any
    const transitioning = document
      .getAnimations()
      .some(
        (animation: any) =>
          animation.playState === 'running' &&
          animation.timeline === document.timeline &&
          animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY,
      )
    return document.querySelector('.loading') === null && document.fonts.status === 'loaded' && !transitioning
  })
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        (globalThis as any).requestAnimationFrame(() =>
          (globalThis as any).requestAnimationFrame(() => resolve(undefined)),
        ),
      ),
  )
}

interface Page {
  readonly name: string
  readonly hash: string
  readonly ready: string
}

await scenario()
process.stdout.write(`pages e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
