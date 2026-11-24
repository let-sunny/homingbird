import { strict as assert } from 'node:assert'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Person,
  api,
  freePort,
  newPage,
  overflowsSideways,
  screenshotCounter,
  sendThroughApi,
  signInWith,
  startDovecote,
  submitDevelopmentLogin,
} from './support.ts'

const here = dirname(fileURLToPath(import.meta.url))
const screenshots = process.env.HB_E2E_SCREENSHOTS_PROFILE ?? join(here, 'screenshots-profile')
const { chromium } = createRequire(import.meta.url)('playwright')

const NARROW = { width: 375, height: 812 }

const scenario = async (): Promise<void> => {
  const port = await freePort()
  const base = `http://localhost:${port}`
  const databasePath = join(tmpdir(), `homingbird-e2e-profile-${port}.sqlite`)
  await rm(screenshots, { recursive: true, force: true })
  await mkdir(screenshots, { recursive: true })
  const dovecote = await startDovecote(port, databasePath, '', undefined, 'channelAgents=on')
  const browser = await chromium.launch()
  const { capture } = screenshotCounter(screenshots)
  const signIn = signInWith(browser, base)

  try {
    const ana = await signIn('ana@example.com', 'Ana')
    const ben = await signIn('ben@example.com', 'Ben')
    await ana.page.setViewportSize({ width: 1280, height: 800 })
    const benId = (await api(ben, 'GET', '/me')).member.id as string
    await api(ana, 'POST', '/channels', { slug: 'billing', description: 'Invoices and refunds.' })
    await api(ana, 'PUT', '/channels/billing/agent', { name: 'Billing helper' })
    await api(ben, 'PUT', '/channels/billing/membership', {})
    const room = (await api(ben, 'GET', '/channels/billing')).conversationId as string
    await sendThroughApi(ben, { channel: 'billing', body: 'Who signs off refunds over 500?' })

    // -- Wide: from a note's author to a direct note in two clicks ---------------------------------
    await ana.page.goto(`${base}/#/c/${room}`)
    const author = ana.page.locator('.note.is-theirs .author-button').first()
    await author.waitFor()
    await author.click()
    const card = ana.page.locator('#profile-card:popover-open')
    await card.waitFor()
    await card.getByText('Ben', { exact: true }).waitFor()
    await card.locator('.profile-note').waitFor()
    assert.equal(await card.getByRole('link', { name: 'Open in Keepers' }).count(), 1)
    const authorBox = await author.boundingBox()
    const cardBox = await card.boundingBox()
    assert.ok(cardBox!.y >= authorBox!.y, 'the card opens beside the face that opened it')
    await capture(ana.page, 'card-from-a-note-author-wide')
    await card.getByRole('link', { name: 'Write a note' }).click()
    await ana.page.waitForSelector('.people-picker-chip:has-text("Ben")')
    assert.equal(
      await ana.page.evaluate(() => (globalThis as any).location.hash as string),
      `#/new?to=${benId}`,
    )
    assert.equal(await ana.page.locator('#profile-card:popover-open').count(), 0)

    // -- Once a direct note exists, the same two clicks open it -----------------------------------
    const anaId = (await api(ana, 'GET', '/me')).member.id as string
    await sendThroughApi(ben, { to: [anaId], body: 'Lunch at noon?' })
    await ana.page.goto(`${base}/#/c/${room}`)
    await author.click()
    await card.getByRole('link', { name: 'Write a note' }).click()
    await ana.page.locator('.note:has-text("Lunch at noon?")').waitFor()
    const direct = await ana.page.evaluate(() => (globalThis as any).location.hash as string)
    assert.ok(direct.startsWith('#/c/') && direct !== `#/c/${room}`)
    await ana.page.locator('.thread-who h1').getByText('Ben').waitFor()

    // -- A direct note's name opens the same card; Open in Keepers brings the person into view ------
    await ana.page.locator('.thread-who .people-title').click()
    await card.waitFor()
    await card.getByRole('link', { name: 'Open in Keepers' }).click()
    await ana.page.waitForSelector(`.person.is-focused[data-member-id="${benId}"]`)

    // -- A channel's agent gets no Message ----------------------------------------------------------
    await ana.page.goto(`${base}/#/c/${room}`)
    await ana.page.locator('.channel-counts .people-open').click()
    await ana.page.locator('.people-list').getByRole('button', { name: 'Billing helper' }).click()
    await card.getByText('Agent of #billing').waitFor()
    assert.equal(await card.getByRole('link', { name: 'Write a note' }).count(), 0)
    assert.equal(await card.getByRole('link').count(), 0)
    await capture(ana.page, 'card-of-a-channel-agent-wide')

    // -- Narrow, by touch: the card is the sheet along the bottom edge -------------------------------
    const phone: Person = await newPage(browser, base, 'en-US', {
      viewport: NARROW,
      hasTouch: true,
      isMobile: true,
    })
    await submitDevelopmentLogin(phone.page, 'ana@example.com', 'Ana')
    await phone.page.waitForSelector('.app')
    await phone.page.goto(`${base}/#/c/${room}`)
    const face = phone.page.locator('.note.is-theirs .author-button').first()
    await face.waitFor()
    await face.tap()
    const sheet = phone.page.locator('#profile-card:popover-open')
    await sheet.waitFor()
    const sheetBox = await sheet.boundingBox()
    assert.ok(
      Math.abs(sheetBox!.y + sheetBox!.height - NARROW.height) <= 2,
      'the sheet sits on the bottom edge',
    )
    assert.ok(Math.abs(sheetBox!.width - NARROW.width) <= 2, 'the sheet spans the width')
    assert.equal(await overflowsSideways(phone.page), false)
    await capture(phone.page, 'card-from-a-note-author-narrow')
    await sheet.getByRole('link', { name: 'Write a note' }).tap()
    await phone.page.waitForFunction(
      (channelRoom: string) => (globalThis as any).location.hash !== `#/c/${channelRoom}`,
      room,
    )
    await phone.page.locator('.thread-who h1').getByText('Ben').waitFor()
  } finally {
    await browser.close()
    await dovecote.stop()
  }
}

await scenario()
