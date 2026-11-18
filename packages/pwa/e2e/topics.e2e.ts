import { strict as assert } from 'node:assert'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Person,
  api,
  connectAgent,
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
const screenshots = process.env.HB_E2E_SCREENSHOTS_TOPICS ?? join(here, 'screenshots-topics')
const { chromium } = createRequire(import.meta.url)('playwright')

const scenario = async (): Promise<void> => {
  const port = await freePort()
  const base = `http://localhost:${port}`
  const databasePath = join(tmpdir(), `homingbird-e2e-topics-${port}.sqlite`)
  await rm(screenshots, { recursive: true, force: true })
  await mkdir(screenshots, { recursive: true })
  const dovecote = await startDovecote(port, databasePath, 'on')
  const browser = await chromium.launch()
  const { capture } = screenshotCounter(screenshots)
  const signIn = signInWith(browser, base)

  try {
    const ana = await signIn('ana@example.com', 'Ana')
    const ben = await signIn('ben@example.com', 'Ben')
    const cy = await signIn('cy@example.com', 'Cy')
    const dee = await signIn('dee@example.com', 'Dee')
    const ids = Object.fromEntries(
      await Promise.all(
        [ana, ben, cy, dee].map(async (person) => [person.name, (await api(person, 'GET', '/me')).member.id]),
      ),
    ) as Record<string, string>
    await api(ana, 'POST', '/topics', { slug: 'billing', description: 'Invoices, refunds and payments.' })
    await api(ana, 'POST', '/topics', { slug: 'deploys', description: 'Releases and the deploy pipeline.' })

    // -- Browse: Join, or Join and answer ---------------------------------------------------------
    await ben.page.goto(`${base}/#/topics`)
    const billingCard = ben.page.locator('.topic-card[data-slug="billing"]')
    await billingCard.getByRole('button', { name: 'Join', exact: true }).waitFor()
    await billingCard.getByRole('button', { name: 'Join and answer', exact: true }).waitFor()
    await capture(ben.page, 'browse-offers-join-and-join-and-answer')
    await billingCard.getByRole('button', { name: 'Join', exact: true }).click()
    await ben.page.waitForSelector('.topic-card[data-slug="billing"] .kind.is-joined')
    await ben.page
      .locator('.topic-card[data-slug="deploys"]')
      .getByRole('button', { name: 'Join and answer', exact: true })
      .click()
    await ben.page.waitForSelector('.topic-card.is-helping[data-slug="deploys"]')
    await capture(ben.page, 'joined-one-topic-answering-in-another')

    // -- In a room: the answering toggle, its one-line explanation, and Leave ---------------------
    const billing = (await api(ben, 'GET', '/topics/billing')).conversationId as string
    await ben.page.goto(`${base}/#/c/${billing}`)
    const toggle = ben.page.locator('.answering-toggle input[role=switch]')
    await toggle.waitFor()
    assert.equal(await toggle.isChecked(), false)
    await ben.page.waitForSelector('.answering-toggle small:has-text("your agent drafts the replies")')
    await capture(ben.page, 'room-with-answer-questions-here-off')
    await toggle.check()
    await ben.page.waitForFunction(
      () =>
        (globalThis as any).document.querySelector('.answering-toggle input[role=switch]')?.checked === true,
    )
    assert.equal((await api(ben, 'GET', '/topics/billing')).answering, true)
    await capture(ben.page, 'room-with-answer-questions-here-on')
    await ben.page.locator('.room-actions').getByRole('button', { name: 'Leave' }).click()
    await ben.page.waitForSelector('dialog[open]:has-text("You can join again at any time")')
    await capture(ben.page, 'leaving-an-open-topic-asks-first')
    await ben.page.locator('dialog[open]').getByRole('button', { name: 'Leave' }).click()
    await ben.page.waitForFunction(() => (globalThis as any).location.hash === '#/topics')
    assert.equal((await api(ben, 'GET', '/topics/billing')).joined, false)

    // -- Profile lists exactly the topics where answering is on -----------------------------------
    await ben.page.goto(`${base}/#/me`)
    await ben.page.waitForSelector('.my-topics .topic-chip:has-text("#deploys")')
    assert.equal(await ben.page.locator('.my-topics .topic-chip:has-text("#billing")').count(), 0)
    await ben.page.locator('.my-topics').scrollIntoViewIfNeeded()
    await capture(ben.page, 'profile-lists-only-topics-where-answering-is-on')

    // -- Creating a private topic -----------------------------------------------------------------
    await ben.page.goto(`${base}/#/topics`)
    await ben.page.fill('.create-topic input[name=slug]', 'payroll')
    await ben.page.fill('.create-topic input[name=description]', 'Salaries, bonuses and expenses.')
    await ben.page.check('.visibility-choice input[value=private]')
    await ben.page.locator('.create-topic').scrollIntoViewIfNeeded()
    await capture(ben.page, 'create-form-with-a-visibility-choice')
    await ben.page.click('.create-topic button[type=submit]')
    await ben.page.waitForSelector('.thread-head h1:has-text("#payroll") .private-mark:has-text("Private")')
    await ben.page.waitForSelector('.thread-head .private-mark .lock-mark')
    await capture(ben.page, 'private-room-shows-a-lock-and-the-word-private')

    // -- Members panel: add from the directory, make manager --------------------------------------
    await ben.page.locator('.room-actions').getByRole('button', { name: 'Members' }).click()
    await ben.page.waitForSelector('dialog[open] .topic-member')
    await ben.page.selectOption('dialog[open] select[name=member]', ids.Cy!)
    await ben.page.locator('dialog[open] .add-member').getByRole('button', { name: 'Add' }).click()
    await ben.page.waitForSelector(`dialog[open] .topic-member[data-member="${ids.Cy}"]`)
    await capture(ben.page, 'members-panel-after-adding-from-the-directory')
    await ben.page
      .locator(`dialog[open] .topic-member[data-member="${ids.Cy}"]`)
      .getByRole('button', { name: 'Make manager' })
      .click()
    await ben.page.waitForSelector(`dialog[open] .topic-member[data-member="${ids.Cy}"] .kind.is-manager`)
    await capture(ben.page, 'members-panel-with-a-second-manager')
    await ben.page.locator('dialog[open]').getByRole('button', { name: 'Make open…' }).click()
    await ben.page.waitForSelector('dialog[open]:has-text("read every question asked in it so far")')
    await capture(ben.page, 'opening-a-private-topic-states-the-consequence')
    await ben.page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click()
    assert.equal((await api(ben, 'GET', '/topics/payroll')).visibility, 'private')

    // -- What a non-member sees: nothing ---------------------------------------------------------
    await sendThroughApi(cy, { topic: 'payroll', body: 'When are bonuses paid this year?' })
    await dee.page.goto(`${base}/#/topics`)
    await dee.page.waitForSelector('.topic-card[data-slug="billing"]')
    assert.equal(await dee.page.locator('.topic-card[data-slug="payroll"]').count(), 0)
    await dee.page.fill('input[name=q]', 'payroll')
    await dee.page.waitForSelector('.empty:has-text("No topic matches.")')
    await capture(dee.page, 'a-non-member-cannot-find-the-private-topic')
    await dee.page.goto(`${base}/#/t/payroll`)
    await dee.page.waitForSelector('.empty:has-text("This topic does not exist.")')
    await dee.page.goto(`${base}/#/people`)
    await dee.page.waitForSelector('.person:has-text("ben@example.com") .topic-chip:has-text("#deploys")')
    assert.equal(await dee.page.locator('.topic-chip:has-text("#payroll")').count(), 0)
    await cy.page.goto(`${base}/#/people`)
    await cy.page.waitForSelector('.person:has-text("ben@example.com") .topic-chip:has-text("#payroll")')
    await capture(cy.page, 'a-member-sees-the-private-chip')

    // -- A removed member loses the room at once --------------------------------------------------
    const payroll = (await api(cy, 'GET', '/topics/payroll')).conversationId as string
    const cyAgent = await connectAgent(base, cy, 'Cy agent', false)
    await fetch(`${base}/api/v1/drafts`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cyAgent.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ topic: 'payroll', body: 'A follow-up about expenses.' }),
    })
    await cy.page.goto(`${base}/#/c/${payroll}`)
    await cy.page.waitForSelector('.thread-head h1:has-text("#payroll")')
    await cy.page.waitForSelector('.topic-rooms a:has-text("#payroll")')
    await api(ben, 'DELETE', `/topics/payroll/managers/${ids.Cy}`)
    await api(ben, 'DELETE', `/topics/payroll/members/${ids.Cy}`)
    await cy.page.waitForFunction(() => (globalThis as any).location.hash === '#/topics')
    await cy.page.waitForFunction(
      () => !(globalThis as any).document.querySelector('.topic-rooms')?.textContent?.includes('#payroll'),
    )
    assert.equal((await api(cy, 'GET', '/drafts')).drafts.length, 0)
    await capture(cy.page, 'a-removed-member-loses-the-room-at-once')

    // -- Making a topic private, with the consequence stated --------------------------------------
    await api(ben, 'PUT', '/topics/deploys/membership', {})
    await api(ana, 'PUT', `/topics/deploys/managers/${ids.Ben}`)
    const deploys = (await api(ben, 'GET', '/topics/deploys')).conversationId as string
    await ben.page.goto(`${base}/#/c/${deploys}`)
    await ben.page.locator('.room-actions').getByRole('button', { name: 'Members' }).click()
    await ben.page.locator('dialog[open]').getByRole('button', { name: 'Make private…' }).click()
    await ben.page.waitForSelector('dialog[open]:has-text("Nobody else can find it")')
    await capture(ben.page, 'making-a-topic-private-states-the-consequence')
    await ben.page.locator('dialog[open]').getByRole('button', { name: 'Make private' }).click()
    await ben.page.waitForSelector('.thread-head .private-mark')
    await dee.page.goto(`${base}/#/topics`)
    await dee.page.waitForSelector('.topic-card[data-slug="billing"]')
    assert.equal(await dee.page.locator('.topic-card[data-slug="deploys"]').count(), 0)

    // -- Administrators can manage any topic ------------------------------------------------------
    await ana.page.goto(`${base}/#/topics`)
    await ana.page.waitForSelector('.topic-card.is-private[data-slug="payroll"] .private-mark')
    await capture(ana.page, 'an-administrator-sees-private-topics-to-manage-them')
    await ana.page.goto(`${base}/#/t/payroll`)
    await ana.page.locator('.room-actions').getByRole('button', { name: 'Members' }).click()
    await ana.page.waitForSelector('dialog[open]:has-text("because you are an administrator")')
    await capture(ana.page, 'an-administrator-manages-a-private-topic')
    await ana.page.locator('dialog[open]').getByRole('button', { name: 'Close' }).click()

    // -- Narrow screen and Korean -----------------------------------------------------------------
    const narrow = await newPage(browser, base, 'en-US', { viewport: { width: 380, height: 760 } })
    await submitDevelopmentLogin(narrow.page, 'ben@example.com', 'Ben')
    await narrow.page.waitForSelector('.app')
    await narrow.page.goto(`${base}/#/c/${deploys}`)
    await narrow.page.waitForSelector('.answering-toggle')
    assert.equal(await overflowsSideways(narrow.page), false)
    await capture(narrow.page, 'narrow-private-room-controls')
    await narrow.context.close()

    const korean: Person = await newPage(browser, base, 'ko-KR')
    await submitDevelopmentLogin(korean.page, 'ben@example.com', 'Ben')
    await korean.page.waitForSelector('.app')
    await korean.page.goto(`${base}/#/topics`)
    await korean.page.waitForSelector('.topic-card[data-slug="payroll"] .private-mark:has-text("비공개")')
    await korean.page.locator('.create-topic').scrollIntoViewIfNeeded()
    await capture(korean.page, 'korean-browse-and-create-form')
    await korean.page.goto(`${base}/#/c/${deploys}`)
    await korean.page.waitForSelector('.answering-toggle:has-text("여기서 질문에 답하기")')
    await korean.page.locator('.room-actions').getByRole('button', { name: '멤버' }).click()
    await korean.page.waitForSelector('dialog[open] .topic-member')
    await capture(korean.page, 'korean-members-panel')
    await korean.context.close()
  } finally {
    await browser.close()
    await dovecote.stop()
  }
}

await scenario()
process.stdout.write(`topics e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
