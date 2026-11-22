import { strict as assert } from 'node:assert'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  api,
  connectAgent,
  freePort,
  screenshotCounter,
  sendThroughApi,
  signInWith,
  startDovecote,
} from './support.ts'

const here = dirname(fileURLToPath(import.meta.url))
const screenshots = process.env.HB_E2E_SCREENSHOTS_GROUPS ?? join(tmpdir(), 'homingbird-e2e-groups')
const { chromium } = createRequire(import.meta.url)('playwright')

const scenario = async (): Promise<void> => {
  const port = await freePort()
  const base = `http://localhost:${port}`
  const databasePath = join(tmpdir(), `homingbird-e2e-groups-${port}.sqlite`)
  await rm(screenshots, { recursive: true, force: true })
  await mkdir(screenshots, { recursive: true })
  const dovecote = await startDovecote(port, databasePath)
  const browser = await chromium.launch()
  const { capture } = screenshotCounter(screenshots)
  const signIn = signInWith(browser, base)

  try {
    const ana = await signIn('ana@example.com', 'Ana')
    const ben = await signIn('ben@example.com', 'Ben')
    const cy = await signIn('cy@example.com', 'Cy')
    const [, benId, cyId] = await Promise.all(
      [ana, ben, cy].map(async (person) => (await api(person, 'GET', '/me')).member.id as string),
    )
    const benAgent = await connectAgent(base, ben, 'Ben desk')
    const room = (await api(ana, 'POST', '/conversations', { participantIds: [benId, cyId] })).id as string
    await sendThroughApi(ana, { conversationId: room, body: 'Who has the release notes? 7d2e' })
    const waiting = await benAgent.call('POST', '/drafts', {
      conversationId: room,
      body: 'I will look this afternoon.',
    })

    // -- New group with these people opens a new message with them chosen ------------------------
    await ben.page.goto(`${base}/#/c/${room}`)
    await ben.page.waitForSelector('.thread-more')
    await ben.page.locator('.thread-more').click()
    await capture(ben.page, 'group-menu-hide-new-group-leave')
    await ben.page.getByRole('menuitem', { name: 'New group with these people' }).click()
    await ben.page.waitForSelector('.people-picker-chip:has-text("Ana")')
    assert.equal(await ben.page.locator('.people-picker-chip').count(), 2)
    await capture(ben.page, 'new-group-with-these-people')

    // -- Leave: confirmed in a dialog, then the room is gone from the list and the page ------------
    await ben.page.goto(`${base}/#/c/${room}`)
    await ben.page.waitForSelector('.thread-more')
    await ben.page.locator('.thread-more').click()
    await ben.page.getByRole('menuitem', { name: 'Leave group' }).click()
    await ben.page.waitForSelector('dialog[open]:has-text("Your drafts waiting here are discarded.")')
    await capture(ben.page, 'leave-group-confirmation')
    await ben.page.locator('dialog[open] button[type=submit]').click()
    await ben.page.waitForFunction(() => (globalThis as any).location.hash === '#/')
    await ben.page.waitForSelector(`.sidebar .conversation-item a[href="#/c/${room}"]`, { state: 'detached' })
    await capture(ben.page, 'left-group-gone-from-list')

    // -- After leaving: nothing new reaches the person, their agent or their desk ------------------
    await sendThroughApi(ana, { conversationId: room, body: 'Found them, thanks. 7d2e' })
    const listed = await api(ben, 'GET', '/conversations')
    assert.ok(!JSON.stringify(listed).includes(room))
    assert.deepEqual((await api(ben, 'GET', '/search?q=7d2e')).notes, [])
    assert.deepEqual((await benAgent.call('GET', '/search?q=7d2e')).notes, [])
    assert.ok(!JSON.stringify(await benAgent.call('GET', '/inbox')).includes(room))
    assert.ok(!JSON.stringify(await benAgent.call('GET', '/inbox?fresh=1')).includes(room))
    assert.ok((await benAgent.call('GET', `/notes/${waiting.id}`)).error !== undefined)
    assert.ok(
      !(await api(ben, 'GET', '/drafts')).drafts.some((draft: { id: string }) => draft.id === waiting.id),
    )
    await ana.page.goto(`${base}/#/c/${room}`)
    await ana.page.waitForFunction(
      () => (globalThis as any).document.querySelectorAll('.people-list .participant').length === 2,
    )
    await capture(ana.page, 'the-others-see-two-people')

    // -- Hide: the row goes from the list and comes back when a note is sent ---------------------
    await cy.page.goto(`${base}/#/`)
    const row = cy.page.locator(`.sidebar .conversation-item:has(a[href="#/c/${room}"])`)
    await row.waitFor()
    await cy.page.goto(`${base}/#/c/${room}`)
    await cy.page.waitForSelector('.thread-more')
    await cy.page.locator('.thread-more').click()
    await cy.page.getByRole('menuitem', { name: /^Hide / }).click()
    await row.waitFor({ state: 'detached' })
    await capture(cy.page, 'hidden-from-list')
    await sendThroughApi(ana, { conversationId: room, body: 'One more thing.' })
    await row.waitFor()
    await capture(cy.page, 'back-after-a-note')
  } finally {
    await browser.close()
    await dovecote.stop()
  }
}

await scenario()
process.stdout.write(`groups e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
