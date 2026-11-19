import { strict as assert } from 'node:assert'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILT_IN_CHARACTERS } from '@homingbird/protocol'
import {
  KEY_CONTROLS,
  type Person,
  VIEWPORT,
  api,
  connectAgent,
  contrastProblems,
  freePort,
  newPage,
  overflowsSideways,
  pastTheRightEdge,
  sendThroughApi,
  signInWith,
  startDovecote,
  submitDevelopmentLogin,
  themeColorsOutside,
} from './support.ts'

const here = dirname(fileURLToPath(import.meta.url))
const screenshots = process.env.HB_E2E_SCREENSHOTS_FEEDBACK ?? join(here, 'screenshots-feedback')
const { chromium } = createRequire(import.meta.url)('playwright')

const NARROW = { width: 390, height: 780 }

const FOX = BUILT_IN_CHARACTERS.find((spec) => spec.id === 'fox')
const OWL = BUILT_IN_CHARACTERS.find((spec) => spec.id === 'owl')

const scenario = async (): Promise<void> => {
  await rm(screenshots, { recursive: true, force: true })
  await mkdir(screenshots, { recursive: true })
  const port = await freePort()
  const base = `http://localhost:${port}`
  const dovecote = await startDovecote(port, join(tmpdir(), `homingbird-e2e-feedback-${port}.sqlite`))
  const browser = await chromium.launch()
  const signIn = signInWith(browser, base)
  let taken = 0
  const shot = async (page: any, name: string): Promise<void> => {
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(screenshots, `${String(++taken).padStart(2, '0')}-${name}.png`) })
  }
  const inThemes = async (page: any, name: string, narrowToo = true): Promise<void> => {
    await shot(page, `${name}-light`)
    await page.emulateMedia({ colorScheme: 'dark' })
    await shot(page, `${name}-dark`)
    if (narrowToo) {
      await page.setViewportSize(NARROW)
      assert.equal(await overflowsSideways(page), false, `${name} scrolls sideways when narrow`)
      assert.deepEqual(await pastTheRightEdge(page), [], `${name} reaches past the right edge when narrow`)
      await shot(page, `${name}-narrow-dark`)
      await page.emulateMedia({ colorScheme: 'light' })
      await shot(page, `${name}-narrow-light`)
      await page.setViewportSize(VIEWPORT)
    }
    await page.emulateMedia({ colorScheme: 'light' })
  }
  const contrastIsFine = async (page: any, where: string): Promise<void> => {
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.waitForTimeout(100)
      assert.deepEqual(await contrastProblems(page, KEY_CONTROLS), [], `${where} in ${scheme}`)
    }
    await page.emulateMedia({ colorScheme: 'light' })
  }

  try {
    const ana = await signIn('ana@example.com', 'Ana')
    const ben = await signIn('ben@example.com', 'Ben')
    const june = await signIn('maximilian.longname-of-the-team@example.com', 'June')
    const ids = Object.fromEntries(
      await Promise.all(
        [ana, ben, june].map(async (person) => [person.name, (await api(person, 'GET', '/me')).member.id]),
      ),
    ) as Record<string, string>

    // -- 11c, home: nothing exists yet, so every entry offers a way forward ----------------------
    await ben.page.goto(`${base}/#/`)
    await ben.page.waitForSelector('.stage .starting-points a:has-text("Ask a channel")')
    await ben.page.waitForSelector('.stage .starting-points a:has-text("Connect your agent")')
    await ben.page.waitForSelector('.sidebar .empty:has-text("You are in no channel yet")')
    await inThemes(ben.page, 'home-with-nothing-yet-offers-starting-points')
    await ben.page.setViewportSize(NARROW)
    await ben.page.waitForSelector('.sidebar .starting-points a:has-text("Find a person")')
    await ben.page.setViewportSize(VIEWPORT)
    await ben.page.goto(`${base}/#/channels`)
    await ben.page.waitForSelector('.empty:has-text("There are no channels yet.") button.new-channel')
    await ben.page.waitForSelector('.empty a.button:has-text("Ask a person instead")')
    await ben.page.goto(`${base}/#/people`)
    await ben.page.waitForSelector('.person')
    assert.equal(
      await ben.page.locator('select[name=channel]').count(),
      0,
      'no channel filter without channels',
    )
    await contrastIsFine(ben.page, 'people')

    // -- 1, 2: the people card at every width, in open mode -------------------------------------
    for (const width of [320, 390, 560, 700, 820, 1000, 1200, 1600]) {
      await ben.page.setViewportSize({ width, height: 800 })
      await ben.page.waitForTimeout(80)
      assert.deepEqual(await overlapsInPeopleCards(ben.page), [], `people cards overlap at ${width}px`)
      assert.equal(await overflowsSideways(ben.page), false)
    }
    await ben.page.setViewportSize({ width: 620, height: 800 })
    await ben.page.emulateMedia({ colorScheme: 'dark' })
    await shot(ben.page, 'people-cards-about-250px-wide-dark')
    await ben.page.emulateMedia({ colorScheme: 'light' })
    await ben.page.setViewportSize(VIEWPORT)
    assert.equal(await ben.page.locator('.person button:has-text("Add contact")').count(), 0)
    await inThemes(ben.page, 'people-in-open-mode-offers-no-add-contact')

    await api(ana, 'PUT', '/admin/settings', {
      allowedDomains: ['example.com'],
      contactMode: 'contacts',
      auditRetentionDays: null,
    })
    await ben.page.reload()
    await ben.page.waitForSelector('.person .action-with-hint:has-text("Once they accept")')
    await inThemes(ben.page, 'people-in-contacts-mode-explains-add-contact', false)
    await api(ana, 'PUT', '/admin/settings', {
      allowedDomains: ['example.com'],
      contactMode: 'open',
      auditRetentionDays: null,
    })
    await ben.page.reload()

    // -- 3, 4: many channels, new channel at the top, pages, joined first --------------------------
    await ben.page.goto(`${base}/#/channels`)
    await ben.page.click('.channels-intro button.new-channel')
    await ben.page.fill('dialog[open] input[name=slug]', 'billing')
    await ben.page.fill('dialog[open] input[name=description]', 'Invoices, refunds and payments.')
    await ben.page.click('dialog[open] button[type=submit]')
    await ben.page.waitForFunction(() => (globalThis as any).location.hash.startsWith('#/c/'))
    for (let index = 0; index < 26; index++)
      await api(ana, 'POST', '/channels', {
        slug: `area-${String(index).padStart(2, '0')}`,
        description: `Questions about area ${index}.`,
      })
    await api(june, 'PUT', '/channels/area-07/membership', { answering: true })
    await api(ana, 'PUT', '/channels/area-07/membership', {})
    await ben.page.goto(`${base}/#/channels`)
    await ben.page.click('.channels-intro button.new-channel')
    await ben.page.fill('dialog[open] input[name=slug]', 'area-07')
    await ben.page.waitForSelector('dialog[open] .channel-exists:has-text("already exists")')
    assert.equal(
      await ben.page.locator('dialog[open] .create-channel button[type=submit]').isDisabled(),
      true,
    )
    await inThemes(ben.page, 'new-channel-dialog-refuses-a-duplicate', false)
    await ben.page.keyboard.press('Escape')
    const cards = ben.page.locator('.channel-card')
    await ben.page.waitForSelector('.channel-card[data-slug="billing"]')
    assert.equal(await cards.first().getAttribute('data-slug'), 'billing', 'channels I am in come first')
    assert.equal(await cards.nth(1).getAttribute('data-slug'), 'area-07', 'then by member count')
    assert.equal(await cards.count(), 20)
    await ben.page.waitForSelector(
      '.channel-card[data-slug="area-07"] .channel-counts:has-text("2 members"):has-text("2 people answer")',
    )
    await ben.page.click('button.show-more')
    await ben.page.waitForFunction(
      () => (globalThis as any).document.querySelectorAll('.channel-card').length === 27,
    )
    assert.equal(await ben.page.locator('button.show-more').count(), 0)
    await ben.page.fill('input[name=q]', 'area-2')
    await ben.page.waitForFunction(
      () => (globalThis as any).document.querySelectorAll('.channel-card').length === 6,
    )
    await inThemes(ben.page, 'browse-searches-many-channels')
    assert.equal(
      await ben.page.locator('.channel-rooms .conversation').count(),
      1,
      'the sidebar lists only my channels',
    )
    await ben.page.waitForSelector('.channel-rooms .conversation-counts:has-text("1 member")')

    // -- 2: a person in many channels shows six chips and the rest behind a disclosure -------------
    await api(ben, 'PUT', '/channels/area-20/membership', {})
    await ben.page.goto(`${base}/#/people`)
    const anaCard = ben.page.locator('.person:has-text("ana@example.com")')
    await anaCard.locator('.more-channels summary:has-text("more channels")').waitFor()
    assert.equal(await anaCard.locator('.person-channels > .channel-chips .channel-chip').count(), 6)
    assert.equal(await anaCard.locator('.more-channels .channel-chip').first().isVisible(), false)
    assert.equal(
      await anaCard.locator('.person-channels > .channel-chips .channel-chip').first().textContent(),
      '#area-20',
      'the channels we share come first',
    )
    await inThemes(ben.page, 'people-card-with-many-channels-collapsed')
    await anaCard.locator('.more-channels summary').click()
    await anaCard.locator('.more-channels .channel-chip').first().waitFor()
    await shot(ben.page, 'people-card-with-many-channels-expanded')
    await ben.page.setViewportSize(NARROW)
    await anaCard.scrollIntoViewIfNeeded()
    await shot(ben.page, 'people-card-with-many-channels-expanded-narrow')
    await ben.page.setViewportSize(VIEWPORT)
    await api(ben, 'DELETE', '/channels/area-20/membership')

    // -- 7: the answering switch, by keyboard, in both themes, and contrast ---------------------
    const billing = (await api(ben, 'GET', '/channels/billing')).conversationId as string
    await ben.page.goto(`${base}/#/c/${billing}`)
    const toggle = ben.page.locator('.answering-toggle [role=switch]')
    await toggle.waitFor()
    await ben.page.waitForSelector('.thread-head .channel-counts:has-text("1 member")')
    await ben.page.waitForSelector('.answering-toggle .switch-state:has-text("On")')
    await toggle.focus()
    await ben.page.keyboard.press('Enter')
    await ben.page.waitForSelector(
      '.answering-toggle [role=switch][aria-checked="false"] .switch-state:has-text("Off")',
    )
    await inThemes(ben.page, 'answer-questions-here-off', false)
    await toggle.focus()
    await ben.page.keyboard.press('Enter')
    await ben.page.waitForSelector(
      '.answering-toggle [role=switch][aria-checked="true"] .switch-state:has-text("On")',
    )
    await inThemes(ben.page, 'answer-questions-here-on-with-focus')
    await contrastIsFine(ben.page, 'channel room')

    // -- 8: my own row in the members panel ------------------------------------------------------
    await ben.page.locator('.room-actions').getByRole('button', { name: 'Members' }).click()
    const ownRow = ben.page.locator(`dialog[open] .channel-member[data-member="${ids.Ben}"]`)
    await ownRow.locator('.is-you:has-text("(you)")').waitFor()
    assert.equal(await ownRow.getByRole('button', { name: 'Remove' }).count(), 0)
    assert.equal(await ownRow.getByRole('button', { name: 'Remove as manager' }).count(), 0)
    await ownRow.getByRole('button', { name: 'Leave channel' }).waitFor()
    await ownRow.getByRole('button', { name: 'Step down as manager' }).click()
    await ben.page.waitForSelector('dialog[open]:has-text("you can no longer add or remove people")')
    await inThemes(ben.page, 'stepping-down-states-the-consequence', false)
    await ben.page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click()
    await api(ben, 'PUT', `/channels/billing/members/${ids.June}`).catch(() => undefined)
    await api(june, 'PUT', '/channels/billing/membership', {})
    await ben.page.reload()
    await ben.page.waitForSelector('.room-actions .disabled-control:has-text("You are the last manager")')
    assert.equal(await ben.page.locator('.room-actions button.leave-channel').isDisabled(), true)
    await ben.page.locator('.room-actions').getByRole('button', { name: 'Members' }).click()
    await ben.page.waitForSelector(
      'dialog[open] .is-self .disabled-control:has-text("You are the last manager")',
    )
    await inThemes(ben.page, 'last-manager-cannot-step-down-or-leave', false)
    await ben.page.keyboard.press('Escape')

    // -- 10: a refusal the client can foresee is shown disabled with its reason ------------------
    await api(ana, 'DELETE', '/channels/area-03/membership')
    await ana.page.goto(`${base}/#/channel/area-03`)
    await ana.page.locator('.room-actions').getByRole('button', { name: 'Members' }).click()
    await ana.page.waitForSelector('dialog[open] .disabled-control:has-text("Only a channel with a manager")')
    assert.equal(await ana.page.locator('dialog[open] button.make-private').isDisabled(), true)
    await inThemes(ana.page, 'make-private-disabled-with-the-reason', false)
    await ana.page.keyboard.press('Escape')
    await ana.page.goto(`${base}/#/admin/members`)
    await ana.page.waitForSelector(`.member[data-member-id="${ids.Ana}"] .is-you`)
    await ana.page.waitForSelector(`.member[data-member-id="${ids.Ana}"] .own-row-reason`)
    await inThemes(ana.page, 'admin-members-marks-my-own-row', false)

    // -- 11b: moving a question when only one other place exists ---------------------------------
    await api(ana, 'PUT', '/channels/billing/membership', { answering: true }).catch(() => undefined)
    await sendThroughApi(june, { channel: 'billing', body: 'Who can refund invoice 4411?' })
    await ben.page.goto(`${base}/#/c/${billing}`)
    await ben.page.locator('.note:has-text("invoice 4411") .move-question').click()
    await ben.page.waitForSelector('dialog[open] .channel-option:has-text("A new channel")')
    await ben.page.check('dialog[open] input[name=destination][value=""]')
    await ben.page.fill('dialog[open] input[name=slug]', 'refunds')
    await ben.page.fill('dialog[open] input[name=description]', 'Refunds and chargebacks.')
    await inThemes(ben.page, 'move-picker-creates-a-channel-inline', false)
    await ben.page.locator('dialog[open]').getByRole('button', { name: 'Move' }).click()
    await ben.page.waitForSelector('.toast:has-text("The question is now in #refunds") a:has-text("Open")')
    await shot(ben.page, 'question-moved-says-where-with-a-link')
    await ben.page.click('.toast a:has-text("Open")')
    await ben.page.waitForSelector('.thread-head h1:has-text("#refunds")')

    // -- 6: characters in the thread, live --------------------------------------------------------
    await api(ben, 'PUT', '/me/character', FOX)
    await api(june, 'PUT', '/me/character', OWL)
    const direct = await api(ben, 'POST', '/conversations', { participantIds: [ids.June] })
    await sendThroughApi(june, { conversationId: direct.id, body: 'Morning! Did the export finish?' })
    await sendThroughApi(june, { conversationId: direct.id, body: 'It usually ends by eight.' })
    await sendThroughApi(ben, { conversationId: direct.id, body: 'It finished at 7:52.' })
    await ben.page.goto(`${base}/#/c/${direct.id}`)
    await ben.page.waitForSelector('.note.is-mine .author-button canvas[data-character="fox"]')
    assert.equal(await ben.page.locator('.note.is-theirs .note-face canvas[data-character="owl"]').count(), 1)
    assert.equal(await ben.page.locator('.note.is-mine .pip').count(), 0, 'Pip never stands for a person')
    assert.equal(await ben.page.locator('.thread-head canvas').count(), 0, 'the header names, the notes show')
    await inThemes(ben.page, 'each-note-shows-its-author-character')
    await api(june, 'PUT', '/me/character', FOX)
    await ben.page.waitForSelector('.note.is-theirs .note-face canvas[data-character="fox"]')
    await ben.page.waitForSelector(`.conversation[href="#/c/${direct.id}"] canvas[data-character="fox"]`)
    await shot(ben.page, 'a-changed-character-shows-without-reload')

    // -- 12, 13: my agent declines, and a draft says who receives it ----------------------
    const agent = await connectAgent(base, ben, 'Ben desk')
    const question = (await api(ben, 'GET', `/conversations/${direct.id}/notes`)).notes.find(
      (note: { body: string }) => note.body.startsWith('It usually'),
    )
    await agent.call('POST', `/notes/${question.id}/pickup`)
    await agent.call('POST', `/notes/${question.id}/release`, { reason: 'I cannot see the export logs.' })
    await ben.page.waitForSelector(
      '.released:has-text("Your agent did not draft a reply: I cannot see the export logs.")',
    )
    await inThemes(ben.page, 'agent-did-not-draft-says-why')
    await ben.page.click('.released button:has-text("Ask anyway")')
    await ben.page.waitForSelector('.asked-chip')
    assert.equal(await ben.page.locator('.released').count(), 0)
    await agent.call('POST', '/drafts', {
      conversationId: direct.id,
      inReplyTo: question.id,
      body: 'Yes — it finished at 7:52, ahead of the usual eight.',
    })
    await ben.page.waitForSelector('.draft:has-text("ahead of the usual eight")')
    await ben.page.waitForSelector('.draft .draft-destination:has-text("Send delivers it to June.")')
    await inThemes(ben.page, 'draft-shows-who-gets-it')

    // -- 5: archiving a channel: one action, says what happens; the old room is read-only ------------
    const refunds = (await api(ben, 'GET', '/channels/refunds')).conversationId as string
    const waiting = await api(ben, 'POST', '/drafts', {
      channel: 'refunds',
      body: 'A draft the archive discards.',
    })
    await ben.page.goto(`${base}/#/c/${refunds}`)
    await ben.page.waitForSelector('.composer textarea')
    await ana.page.goto(`${base}/#/admin/channels`)
    const refundsRow = ana.page.locator('.admin-channels [data-slug="refunds"]')
    assert.equal(await refundsRow.getByRole('button', { name: 'Remove' }).count(), 0)
    assert.equal(await refundsRow.getByRole('button', { name: /Merge/ }).count(), 0)
    await refundsRow.getByRole('button', { name: 'Archive channel' }).click()
    const dialog = ana.page.locator('dialog[open]')
    await dialog.locator('h2:has-text("Archive #refunds?")').waitFor()
    for (const effect of [
      'The channel is removed from the list',
      'Its room becomes read-only and stays readable to its members, under Archived.',
      'Its notes are not moved anywhere.',
      'Drafts waiting in it are discarded, and their authors are told why.',
    ])
      await dialog.locator(`li:has-text("${effect}")`).waitFor()
    assert.equal(await dialog.locator('select[name=moveMembersTo]').isDisabled(), true)
    await dialog.locator('label:has-text("Move its members to another channel") input').check()
    await dialog.locator('select[name=moveMembersTo]').selectOption('billing')
    await inThemes(ana.page, 'archive-channel-dialog-says-what-happens', false)
    await dialog.getByRole('button', { name: 'Archive channel' }).click()
    await ana.page.waitForSelector('.admin-channels [data-slug="refunds"]', { state: 'detached' })
    assert.equal(
      (await api(ana, 'GET', '/admin/audit?action=admin.channels.archive')).entries[0].detail.request
        .moveMembersTo,
      'billing',
    )

    await ben.page.waitForSelector('.thread-head .archived-mark:has-text("Archived")')
    await ben.page.waitForSelector('.archived-notice:has-text("This room is archived.")')
    await ben.page.waitForSelector(
      '.archive-discard:has-text("Your draft in #refunds was discarded because the channel was archived.")',
    )
    assert.equal(await ben.page.locator('.composer textarea').isDisabled(), true)
    assert.equal(await ben.page.locator('.composer button.send').isDisabled(), true)
    assert.equal(
      await ben.page.locator('.composer textarea').getAttribute('aria-describedby'),
      await ben.page.locator('.composer .archived-notice').getAttribute('id'),
    )
    assert.equal(await ben.page.locator('.note .move-question, .note .ask-reply').count(), 0)
    await ben.page.waitForSelector('.sidebar details.archived-rooms summary:has-text("Archived (1)")')
    await ben.page.reload()
    await ben.page.waitForSelector(
      '.archive-discard:has-text("Your draft in #refunds was discarded because the channel was archived.")',
    )
    await ben.page.waitForSelector('.thread-head h1:has-text("refunds")')
    await inThemes(ben.page, 'archived-room-is-read-only')
    assert.equal((await api(ben, 'GET', `/notes/${waiting.id}`)).status, 'discarded')
    const refused = await ben.context.request.fetch(`${base}/api/v1/drafts`, {
      method: 'POST',
      headers: { 'x-homingbird-request': '1', 'content-type': 'application/json' },
      data: { conversationId: refunds, body: 'Anyone here?' },
    })
    assert.equal(refused.status(), 409)
    await ben.page.goto(`${base}/#/`)
    await ben.page.waitForTimeout(800)
    assert.notEqual(await ben.page.evaluate(() => (globalThis as any).location.hash), `#/c/${refunds}`)
    assert.equal(
      await ben.page
        .locator(`.sidebar .conversation-list:not(details .conversation-list) a[href="#/c/${refunds}"]`)
        .count(),
      0,
    )
    await ben.page.waitForSelector('.sidebar details.archived-rooms:not([open])')
    assert.equal(
      await ben.page.locator('.sidebar details.archived-rooms a', { hasText: 'refunds' }).count(),
      1,
    )
    await inThemes(ben.page, 'archived-group-collapsed-at-the-bottom', false)

    await ben.page.goto(`${base}/#/c/${direct.id}`)
    await ben.page.waitForSelector('.draft:has-text("ahead of the usual eight")')

    // -- 11a: from the My agent tab to its Connection section, and back --------------------------
    await ben.page.click('.tab:has-text("My agent")')
    await ben.page.click('.my-agent-nav a:has-text("Connection")')
    await ben.page.waitForFunction(() => (globalThis as any).location.hash === '#/agent/connection')
    await ben.page.waitForSelector('.desk-recommendation:has-text("Keep one agent session open")')
    await ben.page.waitForSelector('.connected-agents .credential:has-text("Ben desk")')
    assert.equal(await ben.page.locator('#user-menu .menu-item:has-text("Devices and agents")').count(), 0)
    await ben.page.waitForSelector(
      'details.have-a-code:not([open]) summary:has-text("a connection code instead of a link")',
    )
    await ben.page.waitForSelector('.not-set-up:has-text("Ask your administrator")')
    for (const name of ['Claude', 'MCP', 'command line', 'connector'])
      assert.equal(await ben.page.locator(`.stage :text("${name}")`).count(), 0, `no ${name} on the page`)
    assert.equal(
      await ben.page.locator('.stage pre, .stage code, .stage button.copy').count(),
      0,
      'the page shows no installation commands',
    )
    for (const word of ['npx', 'npm', '@homingbird/', '/plugin', base])
      assert.equal(await ben.page.locator(`.stage :text("${word}")`).count(), 0, `no ${word} on the page`)
    await inThemes(ben.page, 'connect-an-agent-page')
    const device = (await (
      await fetch(`${base}/oauth/device_authorization`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_name: 'Laptop runner', scope: 'notes' }).toString(),
      })
    ).json()) as { user_code: string }
    await ben.page.click('.have-a-code summary')
    await ben.page.fill('.have-a-code input[name=code]', device.user_code)
    await ben.page.click('.have-a-code button[type=submit]')
    await ben.page.waitForSelector('.connect-window .back-to-app:has-text("Back to Homingbird")')
    await ben.page.waitForSelector('.connect-window .back-to-connect:has-text("Back to My agent")')
    await inThemes(ben.page, 'device-approval-offers-a-way-back', false)
    await ben.page.click('.connect-window .back-to-connect')
    await ben.page.waitForSelector('.app .desk-recommendation')
    await ben.page.goto(`${base}/#/credentials`)
    await ben.page.waitForSelector('.credential .is-you:has-text("(this browser)")')

    // -- 16: a member who is not an administrator sees no way into administration ---------------
    await ben.page.click('.user-button')
    await ben.page.waitForSelector('#user-menu:popover-open .menu-item:has-text("Profile")')
    assert.equal(await ben.page.locator('#user-menu .menu-item:has-text("Administration")').count(), 0)
    assert.equal(await ben.page.locator('a[href^="#/admin"]').count(), 0)
    await ben.page.keyboard.press('Escape')
    for (const section of ['settings', 'members', 'channels', 'audit']) {
      await ben.page.goto(`${base}/#/admin/${section}`)
      await ben.page.waitForSelector('.empty:has-text("This page does not exist.")')
      assert.equal(
        await ben.page.locator('.audit, table, .admin-nav').count(),
        0,
        `admin ${section} stays hidden`,
      )
    }
    await ana.page.goto(`${base}/#/`)
    await ana.page.click('.user-button')
    await ana.page.waitForSelector('#user-menu:popover-open .menu-item:has-text("Administration")')
    await ana.page.keyboard.press('Escape')

    // -- Answering flow: only an administrator sees it, in Settings ------------------------------
    await ana.page.goto(`${base}/#/admin/settings`)
    await ana.page.waitForSelector('.answering-flow .flow-count:has-text("0 of 4,000 characters")')
    await ana.page.click('.answering-flow button.insert-example')
    await ana.page.waitForSelector('.answering-flow .todo-row textarea[name=text]')
    assert.equal(await ana.page.locator('.answering-flow .todo-row').count(), 3)
    assert.equal(await ana.page.locator('.answering-flow button.insert-example').isDisabled(), true)
    await ana.page.waitForSelector(
      '.answering-flow #example-reason:has-text("only while both lists are empty")',
    )
    const checks = ana.page.locator('.answering-flow .todo').nth(1)
    await checks.locator('.todo-add textarea[name=text]').fill('Dates name the weekday and the time zone.')
    await checks.locator('.todo-add button:has-text("Add a step")').click()
    await ana.page.waitForSelector(
      '.answering-flow .todo-row[data-name="Dates name the weekday and the time zone."]',
    )
    await checks.locator('.todo-row').nth(1).locator('[role=switch]').click()
    await ana.page.waitForSelector('.answering-flow .todo-row.is-off')
    await checks
      .locator('.todo-row[data-name="Dates name the weekday and the time zone."] .todo-move')
      .first()
      .click()
    await inThemes(ana.page, 'admin-answering-flow')
    await ana.page.click('.form > button[type=submit]:has-text("Save")')
    await ana.page.waitForSelector('.toast:has-text("Saved.")')
    const savedFlow = (await api(ana, 'GET', '/admin/settings')).answeringFlow as string
    assert.match(savedFlow, /## Check the draft\n1\. Nothing confidential/)
    assert.match(savedFlow, /\[off\] /)
    assert.match(savedFlow, /Dates name the weekday and the time zone\./)
    const tooLong = 'x'.repeat(3990)
    await checks.locator('.todo-add textarea[name=text]').fill(tooLong)
    await checks.locator('.todo-add button:has-text("Add a step")').click()
    await ana.page.waitForSelector('.answering-flow .flow-count.is-over')
    await ana.page.click('.form > button[type=submit]:has-text("Save")')
    await ana.page.waitForSelector('.answering-flow .flow-problem:has-text("4000")')
    await shot(ana.page, 'admin-answering-flow-refused-with-the-server-reason')
    await ana.page.click('.toast button')
    await ben.page.goto(`${base}/#/connect`)
    await ben.page.waitForSelector('.desk-recommendation')
    assert.equal(await ben.page.locator('text=answering flow').count(), 0, 'members never see the flow')

    // -- Settings fit a phone in Korean too, with its longer words ----------------------------------
    const koreanAdmin = await newPage(browser, base, 'ko-KR', { viewport: NARROW })
    await submitDevelopmentLogin(koreanAdmin.page, 'ana@example.com', 'Ana')
    await koreanAdmin.page.waitForSelector('.app')
    await koreanAdmin.page.goto(`${base}/#/admin/settings`)
    await koreanAdmin.page.waitForSelector('.answering-flow .todo-row')
    await koreanAdmin.page.waitForSelector('.feature-switches, fieldset:has(.feature-loss)')
    assert.equal(
      await overflowsSideways(koreanAdmin.page),
      false,
      'Korean settings scroll sideways when narrow',
    )
    assert.deepEqual(
      await pastTheRightEdge(koreanAdmin.page),
      [],
      'Korean settings reach past the right edge',
    )
    await shot(koreanAdmin.page, 'admin-settings-korean-narrow')
    await koreanAdmin.context.close()

    // -- Tour: once on home, never over a deep link, remembered, reopened, broken storage ------
    const visitor = await newPage(browser, base, 'en-US', { tour: true })
    await submitDevelopmentLogin(visitor.page, 'cy@example.com', 'Cy')
    await visitor.page.waitForSelector('.app')
    await visitor.page.goto('about:blank')
    await visitor.page.goto(`${base}/#/c/${billing}`)
    await visitor.page.waitForSelector(
      '.empty:has-text("This direct message or channel does not exist, or you are not in it.")',
    )
    await visitor.page.waitForTimeout(500)
    assert.equal(
      await visitor.page.locator('.toast').count(),
      0,
      'a room I am not in is a page, not an error',
    )
    assert.equal(await visitor.page.locator('#tour:popover-open').count(), 0, 'no tour over a deep link')
    await visitor.page.goto(`${base}/#/`)
    await visitor.page.waitForSelector('#tour:popover-open .tour-progress:has-text("Step 1 of 4")')
    assert.equal(
      await visitor.page.evaluate(() => (globalThis as any).document.activeElement?.className),
      'primary tour-next',
    )
    assert.equal(await visitor.page.locator('.toast').count(), 0, 'an empty home raises no error')
    assert.equal(
      await tourCoversAButton(visitor.page),
      false,
      'the callout leaves the sidebar controls visible',
    )
    await inThemes(visitor.page, 'tour-step-1-the-notes-list', false)
    await visitor.page.click('#tour .tour-next')
    await visitor.page.waitForSelector('#tour .tour-progress:has-text("Step 2 of 4")')
    await visitor.page.waitForSelector('#tour a.button:has-text("Open My agent")')
    await shot(visitor.page, 'tour-step-2-connect-your-agent')
    await visitor.page.click('#tour .tour-next')
    await visitor.page.waitForSelector('.tab.tour-target')
    await visitor.page.click('#tour .tour-back')
    await visitor.page.waitForSelector('#tour .tour-progress:has-text("Step 2 of 4")')
    await visitor.page.keyboard.press('Escape')
    await visitor.page.waitForFunction(() => !(globalThis as any).document.querySelector('#tour'))
    await visitor.page.reload()
    await visitor.page.waitForSelector('.app')
    await visitor.page.waitForTimeout(500)
    assert.equal(await visitor.page.locator('#tour').count(), 0, 'skipping is remembered')
    await visitor.page.goto(`${base}/#/me`)
    await visitor.page.click('button.show-tour')
    await visitor.page.waitForSelector('#tour .tour-progress:has-text("Step 1 of 4")')
    await visitor.page.setViewportSize(NARROW)
    for (let step = 0; step < 3; step++) await visitor.page.click('#tour .tour-next')
    await visitor.page.waitForSelector('#tour .tour-progress:has-text("Step 4 of 4")')
    await shot(visitor.page, 'tour-last-step-narrow')
    await visitor.page.click('#tour .tour-next:has-text("Get started")')
    await visitor.page.waitForFunction(() => !(globalThis as any).document.querySelector('#tour'))
    await visitor.page.setViewportSize(VIEWPORT)
    await visitor.page.goto(`${base}/#/connect`)
    await visitor.page.waitForSelector('.no-agents:has-text("replies are drafted for you as notes arrive")')
    await inThemes(visitor.page, 'connect-an-agent-with-no-agent-yet')
    await visitor.context.close()

    const blocked = await newPage(browser, base, 'en-US', { tour: true })
    await blocked.context.addInitScript(
      "Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('storage is blocked') } })",
    )
    await submitDevelopmentLogin(blocked.page, 'dee@example.com', 'Dee')
    await blocked.page.waitForSelector('.app')
    await blocked.page.waitForSelector('#tour .tour-progress:has-text("Step 1 of 4")')
    await blocked.page.click('#tour .tour-skip')
    await blocked.page.waitForFunction(() => !(globalThis as any).document.querySelector('#tour'))
    await blocked.context.close()

    // -- Every tour step sits beside its control, wide and narrow --------------------------------
    for (const [label, viewport] of [
      ['wide', VIEWPORT],
      ['narrow', NARROW],
    ] as const) {
      const touring = await newPage(browser, base, 'en-US', { tour: true, viewport })
      await submitDevelopmentLogin(touring.page, `tour-${label}@example.com`, 'Tour')
      await touring.page.waitForSelector('#tour:popover-open .tour-progress:has-text("Step 1 of 4")')
      for (let step = 1; step <= 4; step++) {
        await touring.page.waitForSelector(`#tour .tour-progress:has-text("Step ${step} of 4")`)
        await touring.page.waitForTimeout(300)
        const placement = await tourPlacement(touring.page)
        assert.equal(placement.overHeader, false, `step ${step} (${label}) covers the header`)
        assert.ok(
          placement.width <= TOUR_CALLOUT_MAX_WIDTH,
          `step ${step} (${label}) stretches ${placement.width}px wide instead of sitting by its control`,
        )
        if (placement.targetShown)
          assert.ok(
            placement.gap <= 24,
            `step ${step} (${label}) sits ${placement.gap}px from its control, not beside it`,
          )
        else assert.equal(placement.namesThePlace, true, `step ${step} (${label}) names where to look`)
        for (const scheme of ['light', 'dark'] as const) {
          await touring.page.emulateMedia({ colorScheme: scheme })
          await shot(touring.page, `tour-step-${step}-${label}-${scheme}`)
        }
        await touring.page.emulateMedia({ colorScheme: 'light' })
        if (step < 4) await touring.page.click('#tour .tour-next')
      }
      await touring.context.close()
    }

    // -- "Newer notes below" only for something new below, never over a draft's buttons ----------
    for (let index = 0; index < 14; index++)
      await sendThroughApi(june, { conversationId: direct.id, body: `Earlier note number ${index + 1}.` })
    await ben.page.goto(`${base}/#/c/${direct.id}`)
    await ben.page.waitForSelector('.note-body:has-text("Earlier note number 14.")')
    await ben.page.waitForTimeout(800)
    await ben.page.locator('.thread-scroll').evaluate((element: { scrollTop: number }) => {
      element.scrollTop = 0
    })
    await ben.page.waitForTimeout(500)
    assert.equal(await ben.page.locator('.newer-below').isVisible(), false, 'nothing new below: no indicator')
    await sendThroughApi(june, { conversationId: direct.id, body: 'Something new while you read above.' })
    await ben.page.waitForSelector('.newer-below:visible')
    const indicator = await ben.page.locator('.newer-below').boundingBox()
    for (const box of await ben.page
      .locator('.draft button')
      .evaluateAll((buttons: any[]) => buttons.map((button) => button.getBoundingClientRect().toJSON())))
      assert.ok(
        indicator.y >= box.bottom || indicator.y + indicator.height <= box.top || box.width === 0,
        'the indicator never covers a draft button',
      )
    await inThemes(ben.page, 'newer-notes-below-only-for-something-new', false)
    await ben.page.locator('.newer-below').click()
    await ben.page.waitForSelector('.newer-below', { state: 'hidden' })

    // -- A conversation opened directly right after sign-in shows its notes ---------------------
    const fresh = await newPage(browser, base)
    await submitDevelopmentLogin(fresh.page, 'ben@example.com', 'Ben')
    await fresh.page.waitForSelector('.app')
    await fresh.page.goto(`${base}/#/c/${direct.id}`)
    await fresh.page.waitForSelector('.note-body:has-text("It usually ends by eight.")', { timeout: 5_000 })
    assert.equal(await fresh.page.locator('.empty:has-text("No notes here yet")').count(), 0)
    const typed = await newPage(browser, base)
    await submitDevelopmentLogin(typed.page, 'ben@example.com', 'Ben')
    await typed.page.evaluate((id: string) => {
      ;(globalThis as any).location.hash = `#/c/${id}`
    }, direct.id)
    await typed.page.waitForSelector('.note-body:has-text("It usually ends by eight.")', { timeout: 5_000 })
    await typed.page.waitForTimeout(800)
    assert.equal(
      await typed.page.evaluate(() => (globalThis as any).location.hash),
      `#/c/${direct.id}`,
      'a route chosen right after load wins over reopening the last conversation',
    )
    await fresh.context.close()
    await typed.context.close()

    // -- Home in a wide container opens the latest conversation; narrow shows the list ----------
    await ben.page.goto(`${base}/#/people`)
    await ben.page.waitForSelector('.thread', { state: 'detached' })
    await sendThroughApi(june, { conversationId: direct.id, body: 'One more thing: the March export too.' })
    await ben.page.goto(`${base}/#/`)
    await ben.page.waitForFunction(
      (id: string) => (globalThis as any).location.hash === `#/c/${id}`,
      direct.id,
    )
    await ben.page.waitForSelector('.thread-scroll[data-reading="waiting-for-the-person"]')
    await ben.page.waitForSelector('.note:has-text("the March export too")')
    const readByBen = async (): Promise<boolean> =>
      (await api(june, 'GET', `/conversations/${direct.id}/notes`)).notes
        .find((note: { body: string }) => note.body.includes('March export'))
        .receipts.some(
          (receipt: { memberId: string; readAt: number | null }) =>
            receipt.memberId === ids.Ben && receipt.readAt !== null,
        )
    assert.equal(await readByBen(), false, 'opening by itself does not count as reading')
    await ben.page.dispatchEvent('.thread-scroll', 'pointerdown')
    assert.equal(
      await ben.page.locator('.thread-scroll[data-reading="waiting-for-the-person"]').count(),
      1,
      'a synthetic event is not the person acting',
    )
    await ben.page.mouse.click(1000, 400)
    await ben.page.waitForSelector('.thread-scroll:not([data-reading])')
    for (let tries = 0; tries < 40 && !(await readByBen()); tries++) await ben.page.waitForTimeout(100)
    assert.equal(await readByBen(), true, 'the person acting on the page reads it')
    await shot(ben.page, 'home-wide-opens-the-latest-conversation')
    await ben.page.waitForSelector('.connection.is-connected[role=status]:has-text("Connected")')
    assert.equal(await ben.page.locator('.connection .pip, .connection canvas').count(), 0)
    await shot(ben.page, 'header-connected')
    await ben.context.setOffline(true)
    await ben.page.waitForSelector('.connection.is-offline:has-text("Offline")')
    await ben.page.waitForSelector(
      '.connection-notice:has-text("new notes will appear when you are back online")',
    )
    assert.match(
      (await ben.page.locator('.connection').getAttribute('aria-label')) ?? '',
      /^Offline: new notes will appear/,
    )
    await shot(ben.page, 'header-offline-explains-itself')
    await ben.context.setOffline(false)
    await ben.page.waitForSelector('.connection.is-connected', { timeout: 60_000 })
    const phone = await newPage(browser, base, 'en-US', { viewport: NARROW })
    await submitDevelopmentLogin(phone.page, 'ben@example.com', 'Ben')
    await phone.page.waitForSelector('.app')
    await phone.page.goto(`${base}/#/`)
    await phone.page.waitForSelector('.sidebar .conversation')
    await phone.page.waitForSelector('.connection.is-connected')
    const badge = phone.page.locator('.connection')
    assert.ok(((await badge.boundingBox())?.width ?? 0) <= 1, 'a connected badge takes no room when short')
    assert.equal(await badge.getAttribute('role'), 'status')
    assert.equal(await badge.getAttribute('aria-label'), 'Connected')
    await shot(phone.page, 'header-narrow-connected-shows-no-bare-mark')
    let holdStream = true
    await phone.context.route('**/api/v1/events/**', async (route: any) => {
      while (holdStream) await new Promise((resolve) => setTimeout(resolve, 100))
      // The page may have given up on a held request; Playwright then counts it as handled.
      await route.continue().catch(() => undefined)
    })
    await phone.context.setOffline(true)
    await phone.page.waitForSelector('.connection.is-offline .connection-label:visible:has-text("Offline")')
    assert.equal(await overflowsSideways(phone.page), false, 'Offline fits the narrow header')
    await shot(phone.page, 'header-narrow-offline-in-words')
    await phone.context.setOffline(false)
    await phone.page.waitForSelector(
      '.connection.is-connecting .connection-label:visible:has-text("Connecting…")',
    )
    assert.equal(await overflowsSideways(phone.page), false, 'Connecting… fits the narrow header')
    await shot(phone.page, 'header-narrow-connecting-in-words')
    holdStream = false
    await phone.context.unroute('**/api/v1/events/**')
    await phone.page.waitForSelector('.connection.is-connected', { timeout: 60_000 })
    await phone.page.waitForTimeout(400)
    assert.equal(await phone.page.evaluate(() => (globalThis as any).location.hash), '#/')
    await inThemes(phone.page, 'home-narrow-shows-the-list', false)
    await phone.context.close()

    // -- Korean -----------------------------------------------------------------------------------
    const korean: Person = await newPage(browser, base, 'ko-KR')
    await submitDevelopmentLogin(korean.page, 'ben@example.com', 'Ben')
    await korean.page.waitForSelector('.app')
    await korean.page.goto(`${base}/#/c/${direct.id}`)
    await korean.page.waitForSelector('.draft .draft-destination')
    await inThemes(korean.page, 'korean-draft-waiting', false)
    await korean.page.goto(`${base}/#/c/${billing}`)
    await korean.page.waitForSelector('.answering-toggle .switch-state:has-text("켜짐")')
    await korean.page.waitForSelector('.thread-head .channel-counts:has-text("답변자")')
    await inThemes(korean.page, 'korean-channel-room')
    await korean.page.goto(`${base}/#/connect`)
    await korean.page.waitForSelector('.desk-recommendation:has-text("데스크로 열어 두세요")')
    await korean.page.waitForSelector('.not-set-up:has-text("관리자에게 문의하세요")')
    assert.equal(await korean.page.locator('.stage :text("모드")').count(), 0)
    await inThemes(korean.page, 'korean-connect-an-agent')
    await korean.page.goto(`${base}/#/`)
    await korean.page.waitForSelector('.connection.is-connected:has-text("연결됨")')
    await shot(korean.page, 'korean-header-connected')
    await korean.page.goto(`${base}/#/people`)
    await korean.page.setViewportSize({ width: 620, height: 800 })
    assert.deepEqual(await overlapsInPeopleCards(korean.page), [])
    await korean.page.emulateMedia({ colorScheme: 'dark' })
    await shot(korean.page, 'korean-people-cards-narrow-dark')
    await korean.context.close()
  } finally {
    await browser.close()
    await dovecote.stop()
  }
  await themeScenario()
}

const themeScenario = async (): Promise<void> => {
  const port = await freePort()
  const base = `http://localhost:${port}`
  const theme = join(here, 'fixtures', 'test-theme')
  const dovecote = await startDovecote(
    port,
    join(tmpdir(), `homingbird-e2e-theme-${port}.sqlite`),
    'billing',
    theme,
  )
  const browser = await chromium.launch()
  try {
    const palette = [...(await readFile(join(theme, 'theme.css'), 'utf8')).matchAll(/#[0-9a-f]{6}\b/gi)].map(
      (match) => match[0],
    )
    const person = await signInWith(browser, base)('ana@example.com', 'Ana')
    await api(person, 'PUT', '/channels/billing/membership', { answering: true })
    await sendThroughApi(person, { channel: 'billing', body: 'Is the theme applied everywhere?' })
    const room = (await api(person, 'GET', '/channels/billing')).conversationId as string
    for (const [path, ready] of [
      [`/#/c/${room}`, '.answering-toggle'],
      ['/#/people', '.person'],
      ['/#/channels', '.channel-card'],
      ['/#/connect', '.desk-recommendation'],
    ] as const) {
      await person.page.goto(`${base}${path}`)
      await person.page.waitForSelector(ready)
      for (const scheme of ['light', 'dark']) {
        await person.page.emulateMedia({ colorScheme: scheme })
        await person.page.waitForTimeout(150)
        assert.deepEqual(await themeColorsOutside(person.page, palette), [], `${path} in ${scheme}`)
        await person.page.screenshot({
          path: join(screenshots, `theme-${path.replace(/[^a-z]+/g, '-')}${scheme}.png`),
        })
      }
      await person.page.emulateMedia({ colorScheme: 'light' })
    }
  } finally {
    await browser.close()
    await dovecote.stop()
  }
}

const tourPlacement = (
  page: any,
): Promise<{
  readonly targetShown: boolean
  readonly gap: number
  readonly namesThePlace: boolean
  readonly overHeader: boolean
  readonly width: number
}> =>
  page.evaluate(() => {
    const { document } = globalThis as any
    const callout = document.querySelector('#tour').getBoundingClientRect()
    const target = document.querySelector('.tour-target')
    const namesThePlace = document.querySelector('#tour .tour-look-for') !== null
    const header = document.querySelector('.app-header, header')?.getBoundingClientRect()
    const overHeader =
      header !== undefined && callout.top < header.bottom && callout.bottom > header.top && header.height > 0
    if (target === null || !document.querySelector('#tour').classList.contains('is-anchored'))
      return { targetShown: false, gap: 0, namesThePlace, overHeader, width: Math.round(callout.width) }
    const box = target.getBoundingClientRect()
    // A control in the header gets its callout under the header, so it is measured from there.
    const below = target.closest('.titlebar')?.getBoundingClientRect().bottom ?? box.bottom
    const across = Math.max(0, box.left - callout.right, callout.left - box.right)
    const along = Math.max(0, box.top - callout.bottom, callout.top - below)
    return {
      targetShown: true,
      gap: Math.round(Math.max(across, along)),
      namesThePlace,
      overHeader,
      width: Math.round(callout.width),
    }
  })

const TOUR_CALLOUT_MAX_WIDTH = Math.max(22 * 16, NARROW.width - 2 * 16) + 1

const tourCoversAButton = (page: any): Promise<boolean> =>
  page.evaluate(() => {
    const { document } = globalThis as any
    const callout = document.querySelector('#tour')?.getBoundingClientRect()
    if (callout === undefined) return false
    return [...document.querySelectorAll('.sidebar a.button, .sidebar button')].some((control: any) => {
      const box = control.getBoundingClientRect()
      return (
        box.width > 0 &&
        box.left < callout.right &&
        callout.left < box.right &&
        box.top < callout.bottom &&
        callout.top < box.bottom
      )
    })
  })

const overlapsInPeopleCards = (page: any): Promise<string[]> =>
  page.evaluate(() => {
    const { document } = globalThis as any
    const found: string[] = []
    for (const card of document.querySelectorAll('.person')) {
      const actions = [...card.querySelectorAll('.person-actions button')].map((button: any) =>
        button.getBoundingClientRect(),
      )
      const identity = [...card.querySelectorAll('.person-email, .relation, .presence, .person-name strong')]
      for (const element of identity) {
        const box = element.getBoundingClientRect()
        for (const action of actions)
          if (
            box.left < action.right &&
            action.left < box.right &&
            box.top < action.bottom &&
            action.top < box.bottom
          )
            found.push(`${element.className} overlaps an action`)
      }
      const email = card.querySelector('.person-email')
      if (email !== null && email.getBoundingClientRect().height > 30) found.push('the email wraps')
    }
    return found
  })

await scenario()
process.stdout.write(`feedback e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
