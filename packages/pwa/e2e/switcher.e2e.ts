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
  newPage,
  overflowsSideways,
  pastTheRightEdge,
  screenshotCounter,
  sendThroughApi,
  signInWith,
  startDovecote,
  submitDevelopmentLogin,
} from './support.ts'

const here = dirname(fileURLToPath(import.meta.url))
const screenshots = process.env.HB_E2E_SCREENSHOTS_SWITCHER ?? join(tmpdir(), 'homingbird-e2e-switcher')
const { chromium } = createRequire(import.meta.url)('playwright')
const PHONE = { width: 375, height: 812 }
const READERS = ['Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo']

/**
 * The keyboard alone reaches a person, a channel and a group message through the switcher, which a
 * private channel the person is not in never shows; the tab's title counts the draft waiting; shortcuts
 * stay out of the composer's way; and an approval card for a group of eight reads well at 375 px.
 */
const scenario = async (): Promise<void> => {
  const port = await freePort()
  const base = `http://localhost:${port}`
  const databasePath = join(tmpdir(), `homingbird-e2e-switcher-${port}.sqlite`)
  await rm(screenshots, { recursive: true, force: true })
  await rm(databasePath, { force: true })
  await mkdir(screenshots, { recursive: true })
  const dovecote = await startDovecote(port, databasePath)
  const browser = await chromium.launch()
  const { capture } = screenshotCounter(screenshots)
  const signIn = signInWith(browser, base)

  try {
    const ana = await signIn('ana@example.com', 'Ana')
    const readers = []
    for (const name of READERS)
      readers.push(await signIn(`${name.toLowerCase()}@example.com`, `${name} Lindqvist`))
    const [ben] = readers
    const idOf = async (person: typeof ana) => (await api(person, 'GET', '/me')).member.id as string
    const ids = await Promise.all(readers.map(idOf))
    await api(ana, 'POST', '/channels', { slug: 'billing', description: 'Invoices, refunds and payments.' })
    await api(ben!, 'POST', '/channels', { slug: 'payroll', description: 'Salaries.', visibility: 'private' })
    const direct = await api(ana, 'POST', '/conversations', { participantIds: [ids[0]] })
    await sendThroughApi(ben!, { conversationId: direct.id, body: 'Can you look at the invoices?' })
    const group = await api(ana, 'POST', '/conversations', { participantIds: ids })
    await sendThroughApi(ana, { conversationId: group.id, body: 'Who owns the quarterly report?' })
    const anaDesk = await connectAgent(base, ana, 'Ana laptop')
    await anaDesk.call('POST', '/drafts', { conversationId: group.id, body: 'Fay owns it this quarter.' })

    const page = ana.page
    await page.reload()
    await page.waitForSelector('.conversation-list .conversation')

    // -- What waits is counted outside the tab -------------------------------------------------------
    await page.waitForFunction(() => (globalThis as any).document.title.startsWith('1 to approve'))

    // -- A person, by keyboard alone ------------------------------------------------------------------
    await page.keyboard.press('ControlOrMeta+K')
    await page.waitForSelector('dialog.switcher[open]')
    assert.equal(
      await page.evaluate(() => (globalThis as any).document.activeElement?.className),
      'switcher-input',
    )
    assert.ok((await page.locator('.switcher-section-title').allInnerTexts()).includes('WAITING FOR YOU'))
    await capture(page, 'switcher-empty')
    await page.keyboard.type('ben')
    await page.waitForSelector('.switcher-option.is-person')
    await page.keyboard.press('Enter')
    await page.waitForFunction((id: string) => (globalThis as any).location.hash === `#/c/${id}`, direct.id)
    assert.equal(await page.locator('dialog.switcher[open]').count(), 0)

    // -- From the composer the room opened in, ⌘K or Ctrl+K opens it; a private channel never shows ---
    assert.equal(await page.evaluate(() => (globalThis as any).document.activeElement?.tagName), 'TEXTAREA')
    await page.keyboard.press('ControlOrMeta+K')
    await page.waitForSelector('dialog.switcher[open]')
    await page.keyboard.type('payroll')
    await page.waitForSelector('.switcher-empty')
    assert.equal(await page.locator('.switcher-option').count(), 0)
    await page.keyboard.press('Escape')
    await page.waitForSelector('dialog.switcher:not([open])', { state: 'attached' })

    // -- A channel, opened with a slash once the focus is out of the composer -----------------------
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('/')
    await page.waitForSelector('dialog.switcher[open]')
    await page.keyboard.type('#bill')
    await page.waitForSelector('.switcher-option.is-channel')
    await capture(page, 'switcher-channel')
    await page.keyboard.press('Enter')
    await page.waitForSelector('.thread-head h1:has-text("#billing")')

    // -- A group message, chosen with the arrow keys -------------------------------------------------
    await page.keyboard.press('ControlOrMeta+K')
    await page.waitForSelector('dialog.switcher[open]')
    await page.keyboard.type('hana')
    await page.waitForSelector('.switcher-option.is-room')
    const options = await page.locator('.switcher-option').count()
    for (let step = 1; step < options; step++) await page.keyboard.press('ArrowDown')
    assert.equal(
      await page.locator('.switcher-option[aria-selected="true"]').getAttribute('class'),
      'switcher-option is-room',
    )
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      (id: string) => (globalThis as any).location.hash.startsWith(`#/c/${id}`),
      group.id,
    )

    // -- Shortcuts stay out of the composer; Escape still closes --------------------------------------
    const composer = page.locator('.composer textarea')
    await composer.focus()
    await page.keyboard.type('a/b')
    assert.equal(await page.locator('dialog.switcher[open]').count(), 0)
    assert.equal(await composer.inputValue(), 'a/b')
    await page.keyboard.press('ControlOrMeta+K')
    await page.waitForSelector('dialog.switcher[open]')
    await page.keyboard.press('Escape')
    await page.waitForSelector('dialog.switcher:not([open])', { state: 'attached' })
    await composer.fill('')

    // -- An approval card for a group of eight, at 375 px --------------------------------------------
    const phone = await newPage(browser, base, 'en-US', { viewport: PHONE })
    await submitDevelopmentLogin(phone.page, 'ana@example.com', 'Ana')
    await phone.page.waitForSelector('.app')
    await phone.page.goto(`${base}/#/c/${group.id}`)
    await phone.page.waitForSelector('.draft-destination')
    const line = phone.page.locator('.draft-destination').first()
    const text = await line.innerText()
    for (const name of READERS) assert.ok(text.includes(`${name} Lindqvist`), `${name} is named in “${text}”`)
    assert.equal(await overflowsSideways(phone.page), false)
    assert.deepEqual(await pastTheRightEdge(phone.page), [])
    await line.scrollIntoViewIfNeeded()
    await capture(phone.page, 'eight-readers-375')
    await phone.context.close()
  } finally {
    await browser.close()
    await dovecote.stop()
  }
}

await scenario()
process.stdout.write(`switcher e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
