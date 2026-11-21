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
const screenshots = process.env.HB_E2E_SCREENSHOTS_CHANNELS ?? join(here, 'screenshots-channels')
const { chromium } = createRequire(import.meta.url)('playwright')

const scenario = async (): Promise<void> => {
  const port = await freePort()
  const base = `http://localhost:${port}`
  const databasePath = join(tmpdir(), `homingbird-e2e-channels-${port}.sqlite`)
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
    const dee = await signIn('dee@example.com', 'Dee')
    const ids = Object.fromEntries(
      await Promise.all(
        [ana, ben, cy, dee].map(async (person) => [person.name, (await api(person, 'GET', '/me')).member.id]),
      ),
    ) as Record<string, string>
    // -- No channel exists until someone creates one ----------------------------------------------
    await ana.page.goto(`${base}/#/channels`)
    await ana.page.waitForSelector('.empty:has-text("There are no channels yet.")')
    await ana.page.waitForSelector('.sidebar .browse-channels:has-text("Browse channels")')
    assert.equal(await ana.page.locator('.channel-card').count(), 0)
    await capture(ana.page, 'no-channel-exists-yet')

    await api(ana, 'POST', '/channels', { slug: 'billing', description: 'Invoices, refunds and payments.' })
    await api(ana, 'POST', '/channels', { slug: 'deploys', description: 'Releases and the deploy pipeline.' })

    // -- Browse: Join, or Join and answer ---------------------------------------------------------
    await ben.page.goto(`${base}/#/channels`)
    const billingCard = ben.page.locator('.channel-card[data-slug="billing"]')
    await billingCard.getByRole('button', { name: 'Join', exact: true }).waitFor()
    await billingCard.getByRole('button', { name: 'Join and answer', exact: true }).waitFor()
    await capture(ben.page, 'browse-offers-join-and-join-and-answer')
    await billingCard.getByRole('button', { name: 'Join', exact: true }).click()
    await ben.page.waitForSelector('.channel-card[data-slug="billing"] .kind.is-joined')
    await ben.page
      .locator('.channel-card[data-slug="deploys"]')
      .getByRole('button', { name: 'Join and answer', exact: true })
      .click()
    await ben.page.waitForSelector('.channel-card.is-helping[data-slug="deploys"]')
    await capture(ben.page, 'joined-one-channel-answering-in-another')

    // -- In a room: the answering toggle, its one-line explanation, and Leave ---------------------
    const billing = (await api(ben, 'GET', '/channels/billing')).conversationId as string
    await ben.page.goto(`${base}/#/c/${billing}`)
    const toggle = ben.page.locator('[role=switch].answering-chip')
    await toggle.waitFor()
    assert.equal(await toggle.getAttribute('aria-checked'), 'false')
    await ben.page.waitForSelector('.answering-chip .switch-state:has-text("Off")')
    await ben.page.waitForSelector('.answering-chip[title*="your agent drafts the replies"]')
    await capture(ben.page, 'room-with-answer-questions-here-off')
    await toggle.focus()
    await ben.page.keyboard.press('Space')
    await ben.page.waitForSelector('[role=switch].answering-chip[aria-checked="true"]')
    await ben.page.waitForSelector('.answering-chip .switch-state:has-text("On")')
    assert.equal((await api(ben, 'GET', '/channels/billing')).answering, true)
    await capture(ben.page, 'room-with-answer-questions-here-on')
    await ben.page.locator('.room-more').click()
    await ben.page.locator('.room-menu').getByRole('button', { name: 'Leave' }).click()
    await ben.page.waitForSelector('dialog[open]:has-text("You can join again at any time")')
    await capture(ben.page, 'leaving-an-open-channel-asks-first')
    await ben.page.locator('dialog[open]').getByRole('button', { name: 'Leave' }).click()
    await ben.page.waitForFunction(() => (globalThis as any).location.hash === '#/channels')
    assert.equal((await api(ben, 'GET', '/channels/billing')).joined, false)

    // -- My agent lists exactly the channels where answering is on ----------------------------------
    await ben.page.goto(`${base}/#/agent/connection`)
    await ben.page.waitForSelector('.my-channels .channel-chip:has-text("#deploys")')
    assert.equal(await ben.page.locator('.my-channels .channel-chip:has-text("#billing")').count(), 0)
    await ben.page.locator('.my-channels').scrollIntoViewIfNeeded()
    await capture(ben.page, 'my-agent-lists-only-channels-where-answering-is-on')

    // -- Creating a private channel -----------------------------------------------------------------
    await ben.page.goto(`${base}/#/channels`)
    await ben.page.click('button.new-channel')
    await ben.page.fill('dialog[open] .create-channel input[name=slug]', 'payroll')
    await ben.page.fill(
      'dialog[open] .create-channel input[name=description]',
      'Salaries, bonuses and expenses.',
    )
    await ben.page.check('dialog[open] .visibility-choice input[value=private]')
    await capture(ben.page, 'create-form-with-a-visibility-choice')
    await ben.page.click('dialog[open] .create-channel button[type=submit]')
    await ben.page.waitForSelector('.thread-head h1:has-text("#payroll") .private-mark:has-text("Private")')
    await ben.page.waitForSelector('.thread-head .private-mark .lock-mark')
    await capture(ben.page, 'private-room-shows-a-lock-and-the-word-private')

    // -- Members panel: add from People, and the group that manages it -----------------------
    await ben.page.locator('.room-more').click()
    await ben.page.locator('.room-menu').getByRole('button', { name: 'Members' }).click()
    await ben.page.waitForSelector('dialog[open] .channel-member')
    await ben.page.selectOption('dialog[open] select[name=member]', ids.Cy!)
    await ben.page.locator('dialog[open] .add-member').getByRole('button', { name: 'Add' }).click()
    await ben.page.waitForSelector(`dialog[open] .channel-member[data-member="${ids.Cy}"]`)
    await capture(ben.page, 'members-panel-after-adding-from-people')
    await ben.page.waitForSelector('dialog[open] .managed-by:has-text("Managed by")')
    await capture(ben.page, 'members-panel-names-the-managing-group')
    await ben.page.locator('dialog[open]').getByRole('button', { name: 'Make open…' }).click()
    await ben.page.waitForSelector('dialog[open]:has-text("read every question asked in it so far")')
    await capture(ben.page, 'opening-a-private-channel-states-the-consequence')
    await ben.page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click()
    assert.equal((await api(ben, 'GET', '/channels/payroll')).visibility, 'private')

    // -- What a non-member sees: nothing ---------------------------------------------------------
    await sendThroughApi(cy, { channel: 'payroll', body: 'When are bonuses paid this year?' })
    await dee.page.goto(`${base}/#/channels`)
    await dee.page.waitForSelector('.channel-card[data-slug="billing"]')
    assert.equal(await dee.page.locator('.channel-card[data-slug="payroll"]').count(), 0)
    await dee.page.fill('input[name=q]', 'payroll')
    await dee.page.waitForSelector('.empty:has-text("No channel matches.")')
    await capture(dee.page, 'a-non-member-cannot-find-the-private-channel')
    await dee.page.goto(`${base}/#/channel/payroll`)
    await dee.page.waitForSelector('.empty:has-text("This channel does not exist.")')
    await dee.page.goto(`${base}/#/people`)
    await dee.page.waitForSelector('.person:has-text("ben@example.com") .channel-chip:has-text("#deploys")')
    assert.equal(await dee.page.locator('.channel-chip:has-text("#payroll")').count(), 0)
    await cy.page.goto(`${base}/#/people`)
    await cy.page.waitForSelector('.person:has-text("ben@example.com") .channel-chip:has-text("#payroll")')
    await capture(cy.page, 'a-member-sees-the-private-chip')
    await cy.page.goto(`${base}/#/channels`)
    await cy.page.waitForSelector(
      '.channel-card.is-private[data-slug="payroll"] .private-mark:has-text("Private")',
    )
    await cy.page
      .locator('.channel-card[data-slug="billing"]')
      .getByRole('button', { name: 'Join and answer', exact: true })
      .waitFor()
    await capture(cy.page, 'a-member-browses-open-channels-and-a-private-one')

    // -- A removed member loses the room at once --------------------------------------------------
    const payroll = (await api(cy, 'GET', '/channels/payroll')).conversationId as string
    const cyAgent = await connectAgent(base, cy, 'Cy agent')
    await fetch(`${base}/api/v1/drafts`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cyAgent.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 'payroll', body: 'A follow-up about expenses.' }),
    })
    await cy.page.goto(`${base}/#/c/${payroll}`)
    await cy.page.waitForSelector('.thread-head h1:has-text("#payroll")')
    await cy.page.waitForSelector('.channel-rooms a:has-text("#payroll")')
    const payrollManagers = (await api(ben, 'GET', '/channels/payroll')).managedBy as string
    await api(ben, 'PUT', `/groups/${payrollManagers}/members`, { memberIds: [ids.Ben] })
    await api(ben, 'DELETE', `/channels/payroll/members/${ids.Cy}`)
    await cy.page.waitForFunction(() => (globalThis as any).location.hash === '#/channels')
    await cy.page.waitForFunction(
      () => !(globalThis as any).document.querySelector('.channel-rooms')?.textContent?.includes('#payroll'),
    )
    assert.equal((await api(cy, 'GET', '/drafts')).drafts.length, 0)
    await capture(cy.page, 'a-removed-member-loses-the-room-at-once')

    // -- Making a channel private, with the consequence stated --------------------------------------
    await api(ben, 'PUT', '/channels/deploys/membership', {})
    const deploysManagers = (await api(ana, 'GET', '/channels/deploys')).managedBy as string
    await api(ana, 'PUT', `/groups/${deploysManagers}/members`, { memberIds: [ids.Ben] })
    const deploys = (await api(ben, 'GET', '/channels/deploys')).conversationId as string
    await ben.page.goto(`${base}/#/c/${deploys}`)
    await ben.page.locator('.room-more').click()
    await ben.page.locator('.room-menu').getByRole('button', { name: 'Members' }).click()
    await ben.page.locator('dialog[open]').getByRole('button', { name: 'Make private…' }).click()
    await ben.page.waitForSelector('dialog[open]:has-text("Nobody else can find it")')
    await capture(ben.page, 'making-a-channel-private-states-the-consequence')
    await ben.page.locator('dialog[open]').getByRole('button', { name: 'Make private' }).click()
    await ben.page.waitForSelector('.thread-head .private-mark')
    await dee.page.goto(`${base}/#/channels`)
    await dee.page.waitForSelector('.channel-card[data-slug="billing"]')
    assert.equal(await dee.page.locator('.channel-card[data-slug="deploys"]').count(), 0)

    // -- Administrators can manage any channel ------------------------------------------------------
    await ana.page.goto(`${base}/#/channels`)
    await ana.page.waitForSelector('.channel-card.is-private[data-slug="payroll"] .private-mark')
    await capture(ana.page, 'an-administrator-sees-private-channels-to-manage-them')
    await ana.page.goto(`${base}/#/t/payroll`)
    await ana.page.waitForSelector('.room-more')
    assert.equal(new URL(ana.page.url()).hash.startsWith('#/t/'), false, 'an old channel address is replaced')
    await ana.page.locator('.room-more').click()
    await ana.page.locator('.room-menu').getByRole('button', { name: 'Members' }).click()
    await ana.page.waitForSelector('dialog[open]:has-text("because you are an administrator")')
    await capture(ana.page, 'an-administrator-manages-a-private-channel')
    await ana.page.locator('dialog[open]').getByRole('button', { name: 'Close' }).click()

    // -- Presence in words, and a dot that differs by shape in narrow rows ------------------------
    await sendThroughApi(ben, { to: [ids.Dee], body: 'Do you have the expense form?' })
    await dee.page.goto(`${base}/#/people`)
    await dee.page.waitForSelector(
      '.person:has-text("ben@example.com") .human-state.is-on:has-text("Person online")',
    )
    await dee.page.waitForSelector(
      '.person:has-text("ben@example.com") .agent-light:has-text("Agent not awake")',
    )
    await capture(dee.page, 'people-shows-person-and-agent-presence-in-words')
    const direct = (await api(dee, 'GET', '/conversations')).conversations.find(
      (room: { kind: string }) => room.kind === 'direct',
    ).id as string
    await dee.page.goto(`${base}/#/c/${direct}`)
    await dee.page.waitForSelector('.thread-head .human-state:has-text("Person online")')
    await dee.page.waitForSelector('.thread-head .agent-light:has-text("Agent not awake")')
    await dee.page.waitForSelector('.conversation .human-dot[aria-label="Person online"]')
    await capture(dee.page, 'thread-header-presence-in-words-and-list-dot')

    // -- Narrow screen and Korean -----------------------------------------------------------------
    const narrow = await newPage(browser, base, 'en-US', { viewport: { width: 380, height: 760 } })
    await submitDevelopmentLogin(narrow.page, 'ben@example.com', 'Ben')
    await narrow.page.waitForSelector('.app')
    await narrow.page.goto(`${base}/#/c/${deploys}`)
    await narrow.page.waitForSelector('.answering-chip')
    assert.equal(await overflowsSideways(narrow.page), false)
    await capture(narrow.page, 'narrow-private-room-controls')
    await narrow.context.close()

    const korean: Person = await newPage(browser, base, 'ko-KR')
    await submitDevelopmentLogin(korean.page, 'ben@example.com', 'Ben')
    await korean.page.waitForSelector('.app')
    await korean.page.goto(`${base}/#/channels`)
    await korean.page.waitForSelector('.channel-card[data-slug="payroll"] .private-mark:has-text("비공개")')
    await capture(korean.page, 'korean-browse')
    await korean.page.click('button.new-channel')
    await korean.page.waitForSelector('dialog[open] .create-channel')
    await capture(korean.page, 'korean-create-form')
    await korean.page.keyboard.press('Escape')
    await korean.page.goto(`${base}/#/c/${deploys}`)
    await korean.page.waitForSelector('.answering-chip:has-text("여기서 답하기")')
    await korean.page.locator('.room-more').click()
    await korean.page.locator('.room-menu').getByRole('button', { name: '멤버' }).click()
    await korean.page.waitForSelector('dialog[open] .channel-member')
    await capture(korean.page, 'korean-members-panel')
    await korean.page.goto(`${base}/#/people`)
    await korean.page.waitForSelector('.person .human-state:has-text("접속 중")')
    await capture(korean.page, 'korean-presence-in-words')
    await korean.context.close()
  } finally {
    await browser.close()
    await dovecote.stop()
  }
}

await scenario()
process.stdout.write(`channels e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
