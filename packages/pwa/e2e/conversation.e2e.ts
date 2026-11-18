import { strict as assert } from 'node:assert'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Person,
  VIEWPORT,
  api,
  clippedText,
  connectAgent,
  freePort,
  holdEventStream,
  newPage,
  overflowsSideways,
  pendingDraftsAre,
  screenshotCounter,
  sendThroughApi,
  signInWith,
  startAuthorization,
  startDeviceFlow,
  startDovecote,
  submitDevelopmentLogin,
} from './support.ts'

const here = dirname(fileURLToPath(import.meta.url))
const screenshots = process.env.HB_E2E_SCREENSHOTS ?? join(here, 'screenshots')
const koreanScreenshots = process.env.HB_E2E_SCREENSHOTS_KO ?? join(here, 'screenshots-ko')
const { chromium } = createRequire(import.meta.url)('playwright')

const scenario = async (): Promise<void> => {
  const port = await freePort()
  const base = `http://localhost:${port}`
  const databasePath = join(tmpdir(), `homingbird-e2e-${port}.sqlite`)
  for (const directory of [screenshots, koreanScreenshots]) {
    await rm(directory, { recursive: true, force: true })
    await mkdir(directory, { recursive: true })
  }
  let dovecote = await startDovecote(port, databasePath, 'on')
  const browser = await chromium.launch()
  const { capture, nextPath } = screenshotCounter(screenshots)
  const korean = screenshotCounter(koreanScreenshots)
  const signIn = signInWith(browser, base)

  try {
    // -- Signing in ------------------------------------------------------------------------------
    const visitor = await newPage(browser, base)
    await visitor.page.waitForSelector('a[href^="/auth/login"]')
    await capture(visitor.page, 'sign-in-page')

    await submitDevelopmentLogin(visitor.page, 'mallory@elsewhere.org', 'Mallory')
    await visitor.page.waitForSelector('text=not allowed here')
    await capture(visitor.page, 'sign-in-refused')
    await visitor.context.close()

    const ana = await signIn('ana@example.com', 'Ana')
    await ana.page.waitForSelector('text=No conversations yet')
    await ana.page.waitForSelector('.onboarding:has-text("Keep one agent session open for Homingbird")')
    await capture(ana.page, 'empty-home-with-desk-session-hint')

    // -- Directory -------------------------------------------------------------------------------
    const june = await signIn('june@example.com', 'June')
    const kai = await signIn('kai@example.com', 'Kai')
    const lee = await signIn('lee@example.com', 'Lee')
    const mo = await signIn('mo@example.com', 'Mo')
    const nia = await signIn('nia@example.com', 'Nia')
    await api(kai, 'PATCH', '/me', { profile: 'Billing, invoices and the payments database.' })
    const kaiAgent = await connectAgent(base, kai, 'Kai laptop agent', false)
    const kaiStream = holdEventStream(base, kaiAgent.token)
    const ids = Object.fromEntries(
      await Promise.all(
        [ana, june, kai, lee, mo, nia].map(async (person) => [
          person.name,
          (await api(person, 'GET', '/me')).member.id,
        ]),
      ),
    ) as Record<string, string>
    await kai.context.close()
    await lee.context.close()
    await api(ana, 'PUT', `/blocks/${ids.Mo}`)
    await api(nia, 'PUT', `/blocks/${ids.Ana}`)
    await ana.page.goto(`${base}/#/people`)
    await ana.page.waitForSelector('.person .agent-light:not(.is-off)')
    await ana.page.locator('.person', { hasText: 'kai@example.com' }).locator('summary').click()
    await capture(ana.page, 'directory-presence-blocked-and-cannot-message')
    assert.equal(
      await ana.page
        .locator('.person', { hasText: 'nia@example.com' })
        .getByRole('button', { name: 'Message' })
        .count(),
      0,
    )

    const pat = await signIn('pat@example.com', 'Pat')
    await ana.page.waitForSelector('.person:has-text("pat@example.com")')
    await capture(ana.page, 'new-member-appears-in-an-open-directory')
    await pat.context.close()

    await api(ana, 'PUT', '/admin/settings', {
      allowedDomains: ['example.com'],
      contactMode: 'contacts',
      auditRetentionDays: null,
    })
    await api(ana, 'POST', '/contacts', { memberId: ids.June })
    await api(lee, 'POST', '/contacts', { memberId: ids.Ana }).catch(() => undefined)
    const leeAgain = await signIn('lee@example.com', 'Lee')
    await api(leeAgain, 'POST', '/contacts', { memberId: ids.Ana })
    await ana.page.reload()
    await ana.page.waitForSelector('.person')
    await ana.page.waitForSelector('text=Accept')
    await capture(ana.page, 'directory-contacts-mode-request-sent-and-received')
    await leeAgain.context.close()
    await api(ana, 'PUT', '/admin/settings', {
      allowedDomains: ['example.com'],
      contactMode: 'open',
      auditRetentionDays: null,
    })
    await ana.page.reload()

    // -- A conversation --------------------------------------------------------------------------
    await ana.page
      .locator('.person', { hasText: 'june@example.com' })
      .getByRole('button', { name: 'Message' })
      .click()
    await ana.page.waitForSelector('.composer textarea')
    await capture(ana.page, 'starting-a-conversation')

    const question = 'Is the billing migration safe to run today? Plan: https://example.com/plans/billing'
    await ana.page.fill('.composer textarea', question)
    await capture(ana.page, 'composing')

    await ana.page.click('.composer button[type=submit]')
    await ana.page.waitForSelector('.note-status:has-text("Delivered")')
    await capture(ana.page, 'note-sent-delivered')

    await june.page.waitForSelector('a[href^="#/c/"]')
    await capture(june.page, 'recipient-receives-it-live')

    await june.page.locator('a[href^="#/c/"]').first().click()
    await june.page.waitForSelector('.note-body')
    await ana.page.waitForSelector('.note-status:has-text("Read")')
    await capture(ana.page, 'read-seen-by-sender')

    // -- Agent drafts and approval ---------------------------------------------------------------
    const laptop = await connectAgent(base, june, 'June laptop agent', false)
    const cursor = await connectAgent(base, june, 'Cursor', false)
    const waiting = (await laptop.call('GET', '/inbox')).items[0].note.id as string
    await laptop.call('POST', `/notes/${waiting}/pickup`)
    await ana.page.waitForSelector('.note-status:has-text("Drafting reply")')
    await capture(ana.page, 'drafting-reply-status-seen-by-sender')

    await laptop.call('POST', '/drafts', {
      inReplyTo: waiting,
      body: 'Yes. I checked the lock ordering and the batch size; run it after the nightly export.',
    })
    await june.page.waitForSelector('.pending .draft')
    await capture(june.page, 'agent-draft-waiting-for-approval')

    await cursor.call('POST', '/drafts', {
      inReplyTo: waiting,
      body: 'Looks safe, but wait for the export job first.',
    })
    await june.page.waitForFunction(pendingDraftsAre, 2)
    await capture(june.page, 'several-alternative-drafts')

    await june.page.locator('.draft').first().getByRole('button', { name: 'Edit' }).click()
    await june.page.waitForSelector('dialog[open] textarea')
    await june.page.fill(
      'dialog[open] textarea',
      'Yes, it is safe. Run it after the nightly export finishes, around 2am.',
    )
    await capture(june.page, 'editing-a-draft-before-sending')

    await june.page.click('dialog[open] button[type=submit]')
    await ana.page.waitForSelector('.note-status:has-text("Replied")')
    await june.page.waitForFunction(pendingDraftsAre, 0)
    await capture(ana.page, 'replied-seen-by-sender')
    await capture(june.page, 'replied-seen-by-recipient-alternatives-discarded')

    // -- Draft requests --------------------------------------------------------------------------
    await june.page
      .locator('.note.is-theirs')
      .first()
      .getByRole('button', { name: 'Ask my agent to draft a reply' })
      .click()
    await june.page.waitForSelector('.asked-chip')
    await june.page.waitForSelector('.no-agent:has-text("desk session is running")')
    await capture(june.page, 'draft-request-waiting-while-the-desk-session-is-offline')
    await june.page.locator('.asked-chip').getByRole('button', { name: 'Withdraw' }).click()
    await june.page.waitForSelector('.asked-chip', { state: 'detached' })

    await june.page.click('.ask-agent summary')
    await june.page.fill('.ask-agent input[name=instruction]', 'Tell Ana the export finishes at 1:40am')
    assert.equal(await june.page.locator('.ask-agent select[name=agent] option').count(), 3)
    await capture(june.page, 'let-my-agent-write-it-with-instruction-and-agent-picker')
    await june.page.locator('.ask-agent').getByRole('button', { name: 'Ask my agent' }).click()
    await june.page.waitForSelector('.asked-chip:has-text("export finishes")')
    const asked = (await laptop.call('GET', '/draft-requests')).requests.find(
      (request: { cancelledAt: number | null }) => request.cancelledAt === null,
    )
    assert.equal(asked.instruction, 'Tell Ana the export finishes at 1:40am')
    await laptop.call('POST', '/drafts', {
      requestId: asked.id,
      body: 'The nightly export finishes at 1:40am, so 2am is safe.',
    })
    await cursor.call('POST', '/drafts', { requestId: asked.id, body: 'Export ends 1:40am. Go at 2.' })
    await june.page.waitForFunction(pendingDraftsAre, 2)
    await june.page.waitForSelector('.asked-chip', { state: 'detached' })
    await june.page.waitForSelector('.pending-choose:has-text("2 alternatives")')
    await capture(june.page, 'draft-request-answered-by-two-agents-as-alternatives')
    await june.page
      .locator('.draft', { hasText: '1:40am, so 2am' })
      .getByRole('button', { name: 'Send' })
      .click()
    await june.page.waitForFunction(pendingDraftsAre, 0)
    await june.page.waitForSelector('.note-body:has-text("1:40am, so 2am")')
    await capture(june.page, 'draft-request-one-alternative-sent-the-other-discarded')
    assert.equal((await api(june, 'GET', '/drafts')).drafts.length, 0)

    const anaAgent = await connectAgent(base, ana, 'Ana laptop agent', true)
    const follow = await anaAgent.call('POST', '/drafts', {
      to: [ids.June],
      body: 'Thanks. I will run it at 2am and report back.',
    })
    await anaAgent.call('POST', '/drafts', { to: [ids.June], body: 'A draft that will be thrown away.' })
    await ana.page.waitForFunction(pendingDraftsAre, 2)
    await capture(ana.page, 'drafts-before-discarding')
    await ana.page
      .locator('.draft', { hasText: 'thrown away' })
      .getByRole('button', { name: 'Discard' })
      .click()
    await ana.page.waitForFunction(pendingDraftsAre, 1)
    await capture(ana.page, 'after-discarding')

    await ana.page
      .locator('.draft', { hasText: 'report back' })
      .getByRole('button', { name: 'Send', exact: true })
      .click()
    await ana.page.waitForFunction(pendingDraftsAre, 0)
    await ana.page.waitForSelector('.origin.is-agent')
    await capture(ana.page, 'origin-badges-human-edited-and-agent')
    assert.equal((await api(ana, 'GET', `/notes/${follow.id}`)).status, 'sent')
    const origins = await ana.page
      .locator('.origin')
      .evaluateAll((nodes: ReadonlyArray<{ className: string }>) => nodes.map((node) => node.className))
    for (const origin of ['is-human', 'is-human_edited', 'is-agent'])
      assert.ok(
        origins.some((name: string) => name.split(' ').includes(origin)),
        `missing origin badge ${origin}`,
      )

    // -- Topic rooms -----------------------------------------------------------------------------
    await ana.page.goto(`${base}/#/topics`)
    await ana.page.waitForSelector('.topic-card[data-slug="general"]')
    await capture(ana.page, 'browse-topics')
    await ana.page.fill('.create-topic input[name=slug]', 'General')
    await ana.page.waitForSelector('.topic-exists:has-text("#general already exists")')
    assert.equal(await ana.page.locator('.create-topic button[type=submit]').isDisabled(), true)
    await capture(ana.page, 'create-topic-refuses-a-duplicate')
    await ana.page.fill('.create-topic input[name=slug]', 'Billing')
    await ana.page.fill(
      '.create-topic input[name=description]',
      'Invoices, refunds and the payments database.',
    )
    await ana.page.click('.create-topic button[type=submit]')
    await ana.page.waitForSelector('.thread-head h1:has-text("#billing")')
    await ana.page.waitForSelector('.topic-rooms a:has-text("#billing")')
    await capture(ana.page, 'new-topic-room-in-the-sidebar')

    await june.page.goto(`${base}/#/topics`)
    await june.page
      .locator('.topic-card[data-slug="billing"]')
      .getByRole('button', { name: 'Join and answer', exact: true })
      .click()
    await june.page.waitForSelector('.topic-card.is-helping[data-slug="billing"]')
    await june.page.fill('input[name=q]', 'refund')
    await june.page.waitForFunction(
      () => (globalThis as any).document.querySelectorAll('.topic-card').length === 1,
    )
    await capture(june.page, 'searching-topics-and-answering-in-one')

    await ana.page.goto(`${base}/#/people`)
    await ana.page.waitForSelector('.person:has-text("june@example.com") .topic-chip:has-text("#billing")')
    await capture(ana.page, 'directory-shows-topic-chips')
    await june.page.goto(`${base}/#/me`)
    await june.page.waitForSelector('.my-topics .topic-chip:has-text("#billing")')
    await june.page.locator('.my-topics').scrollIntoViewIfNeeded()
    await capture(june.page, 'profile-my-agent-can-help-with')

    const asker = await signIn('lee@example.com', 'Lee')
    await asker.page.goto(`${base}/#/topics`)
    await asker.page.locator('.topic-card[data-slug="billing"]').getByRole('link', { name: 'Ask' }).click()
    await asker.page.waitForSelector('.ask-topic textarea')
    await asker.page.fill('.ask-topic textarea', 'Who can explain the refund rule for annual plans?')
    await capture(asker.page, 'asking-a-topic')
    await asker.page.click('.ask-topic button[type=submit]')
    await asker.page.waitForSelector('.thread-head h1:has-text("#billing")')
    await asker.page.waitForSelector('.note-status:has-text("Read by 0 of 2")')
    await capture(asker.page, 'question-in-a-topic-room-read-by-0-of-2')

    const billingRoom = (await api(june, 'GET', '/topics')).topics.find(
      (topic: { slug: string }) => topic.slug === 'billing',
    ).conversationId as string
    await june.page.goto(`${base}/#/c/${billingRoom}`)
    await june.page.waitForSelector('.note-author:has-text("Lee")')
    await june.page.waitForSelector('.move-question')
    await capture(june.page, 'helper-sees-the-question-with-its-author')
    await june.page
      .locator('.note', { hasText: 'refund rule' })
      .getByRole('button', { name: 'Reply', exact: true })
      .click()
    await june.page.fill('.composer textarea', 'Annual plans are refunded pro rata for the unused months.')
    await june.page.click('.composer button[type=submit]')
    await asker.page.waitForSelector('.answered-by:has-text("Answered by June")')
    await capture(asker.page, 'question-answered-by-a-helper')

    await sendThroughApi(asker, { topic: 'billing', body: 'Where do I find the release calendar?' })
    await june.page.waitForSelector('.note:has-text("release calendar") .move-question')
    assert.equal(
      await june.page.locator('.note', { hasText: 'refund rule' }).locator('.move-question').count(),
      0,
    )
    await june.page.locator('.note', { hasText: 'release calendar' }).locator('.move-question').click()
    await june.page.waitForSelector('dialog[open] select[name=topic]')
    await june.page.selectOption('dialog[open] select[name=topic]', 'general')
    await capture(june.page, 'move-question-to-another-topic')
    await june.page.click('dialog[open] button[type=submit]')
    await june.page.waitForSelector('.note:has-text("release calendar")', { state: 'detached' })
    await capture(june.page, 'question-moved-out-of-the-room')
    await asker.context.close()

    await anaAgent.call('POST', '/drafts', {
      topic: 'general',
      body: 'Does anyone know when the payments database maintenance window is?',
    })
    const generalRoom = (await api(ana, 'GET', '/topics')).topics.find(
      (topic: { slug: string }) => topic.slug === 'general',
    ).conversationId as string
    await ana.page.goto(`${base}/#/c/${generalRoom}`)
    await ana.page.waitForSelector('.goes-to:has-text("Goes to #general")')
    await capture(ana.page, 'draft-to-a-topic-shows-where-it-goes')
    await ana.page.locator('.draft').getByRole('button', { name: 'Change topic' }).click()
    await ana.page.selectOption('dialog[open] select[name=topic]', 'billing')
    await ana.page.click('dialog[open] button[type=submit]')
    await ana.page.waitForSelector('.goes-to:has-text("Goes to #billing · 2 helpers")')
    await ana.page.waitForSelector('.draft .origin.is-agent')
    assert.equal(await ana.page.locator('.draft .origin.is-human').count(), 0)
    assert.equal((await api(ana, 'GET', '/drafts')).drafts.length, 1)
    await capture(ana.page, 'draft-readdressed-to-another-topic')
    await ana.page.locator('.draft').getByRole('button', { name: 'Send', exact: true }).click()
    await ana.page.waitForFunction(pendingDraftsAre, 0)
    await ana.page.waitForSelector('.note-body:has-text("maintenance window")')

    // -- Other screens ---------------------------------------------------------------------------
    await ana.page.goto(`${base}/#/search?q=billing`)
    await ana.page.waitForSelector('text=billing migration')
    await capture(ana.page, 'search')

    await ana.page.goto(`${base}/#/me`)
    await ana.page.waitForSelector('textarea')
    await ana.page.fill('textarea', 'Deploys, migrations and the release calendar.')
    await capture(ana.page, 'profile-editor')

    await ana.context.grantPermissions(['notifications'])
    const toggle = ana.page.locator('input[name=notifications]')
    await toggle.scrollIntoViewIfNeeded()
    await capture(ana.page, 'notification-toggle')
    if ((await toggle.count()) === 1) {
      await toggle.click()
      await ana.page.waitForTimeout(1500)
      await capture(ana.page, 'notification-toggle-after-turning-on')
      await ana.page
        .locator('.toast button')
        .click()
        .catch(() => undefined)
    }

    await ana.page.goto(`${base}/#/credentials`)
    await ana.page.waitForSelector('.credential')
    await capture(ana.page, 'credentials-list')
    await ana.page
      .locator('.credential', { hasText: 'Ana laptop agent (approve button)' })
      .getByRole('button', { name: 'Revoke' })
      .click()
    await ana.page.waitForSelector('dialog[open]')
    await capture(ana.page, 'credentials-revoke-confirmation')
    await ana.page.locator('dialog[open]').getByRole('button', { name: 'Revoke' }).click()
    await ana.page.waitForSelector('.credential:has-text("Revoked")')
    await capture(ana.page, 'credentials-after-revoke')

    const plainDevice = await startDeviceFlow(base, 'Codex on build box', 'notes')
    await ana.page.goto(`${base}/#/device/${plainDevice.user_code}`)
    await ana.page.waitForSelector('text=Codex on build box')
    await capture(ana.page, 'device-approval-without-approve-button')
    await ana.page.getByRole('button', { name: 'Deny' }).click()
    await ana.page.waitForSelector('text=You denied the request.')
    await capture(ana.page, 'device-denied')

    const buttonDevice = await startDeviceFlow(base, 'Homingbird mod', 'notes approve')
    await ana.page.goto(`${base}/#/device/${buttonDevice.user_code}`)
    await ana.page.waitForSelector('input[type=checkbox]')
    await capture(ana.page, 'device-approval-with-approve-button-checkbox')
    await ana.page.getByRole('button', { name: 'Approve' }).click()
    await ana.page.waitForSelector('text=The device is connected to your account. You can close this tab.')
    await capture(ana.page, 'device-approved-success-state')

    const firstDevice = await startDeviceFlow(base, 'Cursor on a new laptop', 'notes')
    const newcomer = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: VIEWPORT,
      colorScheme: 'light',
    })
    const rae = await newcomer.newPage()
    await rae.goto(`${base}/#/device/${firstDevice.user_code}`)
    await rae.waitForSelector('input[name=email]')
    await capture(rae, 'device-link-while-signed-out-goes-straight-to-sign-in')
    await rae.fill('input[name=email]', 'rae@example.com')
    await rae.fill('input[name=name]', 'Rae')
    await rae.click('button')
    await rae.waitForSelector('text=Cursor on a new laptop')
    assert.equal(await rae.locator('.code-shown').innerText(), firstDevice.user_code)
    await capture(rae, 'new-member-back-on-the-device-page-after-sign-in')
    await rae.getByRole('button', { name: 'Approve' }).click()
    await rae.waitForSelector('text=The device is connected to your account. You can close this tab.')
    await capture(rae, 'new-member-device-connected')
    await newcomer.close()

    const consentUrl = await startAuthorization(base, 'Example MCP client')
    await ana.page.route('https://client.example/**', (route: any) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>client</title><p>Back at the client application.</p>',
      }),
    )
    await ana.page.goto(consentUrl)
    await ana.page.waitForSelector('text=Example MCP client')
    await capture(ana.page, 'oauth-consent')
    await ana.page.getByRole('button', { name: 'Approve' }).click()
    await ana.page.waitForSelector('text=Returning you to client.example')
    await ana.page.screenshot({ path: await nextPath('oauth-consent-success-state') })
    await ana.page.waitForURL(/client\.example\/callback\?code=/)

    const signedOutConsent = await startAuthorization(base, 'Another MCP client')
    const stranger = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: VIEWPORT,
      colorScheme: 'light',
    })
    await stranger.route('https://client.example/**', (route: any) =>
      route.fulfill({ contentType: 'text/html', body: '<title>client</title><p>Back at the client.</p>' }),
    )
    const sam = await stranger.newPage()
    await sam.goto(signedOutConsent)
    await sam.waitForSelector('input[name=email]')
    await sam.fill('input[name=email]', 'sam@example.com')
    await sam.fill('input[name=name]', 'Sam')
    await sam.click('button')
    await sam.waitForSelector('text=Another MCP client')
    await capture(sam, 'oauth-consent-after-signing-in-on-the-way')
    await sam.getByRole('button', { name: 'Approve' }).click()
    await sam.waitForSelector('.outcome.is-approved')
    await sam.screenshot({ path: await nextPath('oauth-consent-connected') })
    await sam.waitForURL(/client\.example\/callback\?code=/)
    await stranger.close()

    await ana.page.goto(`${base}/#/`)
    await api(ana, 'POST', '/topics', { slug: 'invoices', description: 'Sending and chasing invoices.' })
    await ana.page.goto(`${base}/#/admin/topics`)
    await ana.page.waitForSelector('.admin-topics [data-slug="invoices"]')
    assert.equal(
      await ana.page.locator('[data-slug="general"]').getByRole('button', { name: 'Remove' }).count(),
      0,
    )
    await capture(ana.page, 'admin-topics')
    await ana.page.locator('[data-slug="billing"]').getByRole('button', { name: 'Edit' }).click()
    await ana.page.fill('dialog[open] input[name=slug]', 'payments')
    await capture(ana.page, 'admin-renaming-a-topic')
    await ana.page.click('dialog[open] button[type=submit]')
    await ana.page.waitForSelector('.admin-topics [data-slug="payments"]')
    await ana.page.locator('[data-slug="invoices"]').getByRole('button', { name: 'Merge…' }).click()
    await ana.page.selectOption('dialog[open] select[name=into]', 'payments')
    await capture(ana.page, 'admin-merging-a-topic')
    await ana.page.click('dialog[open] button[type=submit]')
    await ana.page.waitForSelector('.admin-topics [data-slug="invoices"]', { state: 'detached' })
    await capture(ana.page, 'admin-topics-after-rename-and-merge')

    for (const section of ['settings', 'members', 'audit']) {
      await ana.page.goto(`${base}/#/admin/${section}`)
      await ana.page.waitForSelector(
        section === 'settings' ? 'textarea' : section === 'members' ? '.member' : 'table, .audit',
      )
      await ana.page.waitForTimeout(300)
      await capture(ana.page, `admin-${section === 'audit' ? 'audit-log' : section}`)
    }

    // -- Group conversation ----------------------------------------------------------------------
    const group = await api(ana, 'POST', '/conversations', {
      participantIds: [ids.June, ids.Kai],
      title: 'Billing migration',
    })
    await sendThroughApi(ana, { conversationId: group.id, body: 'Running the migration tonight at 2am.' })
    await sendThroughApi(june, { conversationId: group.id, body: 'I will watch the export job.' })
    await ana.page.goto(`${base}/#/c/${group.id}`)
    await ana.page.waitForSelector('.note-author')
    await ana.page.waitForSelector('.note-status:has-text("Read by 0 of 2")')
    await capture(ana.page, 'group-conversation-with-authors-and-read-counts')

    // -- Connection lost and restored ------------------------------------------------------------
    await dovecote.stop()
    await ana.page.waitForSelector('.connection.is-offline, .connection:has-text("Offline")', {
      timeout: 20_000,
    })
    await capture(ana.page, 'connection-lost')
    dovecote = await startDovecote(port, databasePath, 'on')
    await ana.page.waitForSelector('.connection:has-text("Live")', { timeout: 60_000 })
    await capture(ana.page, 'connection-restored')

    // -- Dark mode and narrow containers ---------------------------------------------------------
    const conversationHref = await ana.page
      .locator('.sidebar a[href^="#/c/"]', { hasText: 'June' })
      .first()
      .getAttribute('href')
    const mainScreens: ReadonlyArray<readonly [string, string]> = [
      ['thread', `/${conversationHref}`],
      ['people', '/#/people'],
      ['profile', '/#/me'],
      ['credentials', '/#/credentials'],
      ['admin-settings', '/#/admin/settings'],
      ['group-conversation', `/#/c/${group.id}`],
      ['topics', '/#/topics'],
      ['topic-room', `/#/c/${billingRoom}`],
      ['admin-topics', '/#/admin/topics'],
    ]
    await ana.page.emulateMedia({ colorScheme: 'dark' })
    for (const [name, path] of mainScreens) {
      await ana.page.goto(`${base}${path}`)
      await ana.page.waitForTimeout(700)
      await capture(ana.page, `dark-${name}`)
    }
    await ana.page.emulateMedia({ colorScheme: 'light' })
    await ana.page.setViewportSize({ width: 390, height: 780 })
    await ana.page.goto(`${base}/#/`)
    await ana.page.waitForTimeout(700)
    await capture(ana.page, 'narrow-conversation-list')
    for (const [name, path] of mainScreens) {
      await ana.page.goto(`${base}${path}`)
      await ana.page.waitForTimeout(700)
      assert.equal(
        await overflowsSideways(ana.page),
        false,
        `${name} overflows sideways in a narrow container`,
      )
      await capture(ana.page, `narrow-${name}`)
    }

    // -- Korean ----------------------------------------------------------------------------------
    await ana.page.setViewportSize(VIEWPORT)
    await ana.page.goto(`${base}/#/me`)
    await ana.page.waitForSelector('.language input[name=language]')
    assert.equal(await ana.page.getAttribute('html', 'lang'), 'en')
    await ana.page.locator('.language input[value="ko"]').check()
    await ana.page.waitForSelector('html[lang="ko"]')
    await ana.page.waitForSelector('.tabs a:has-text("노트")')
    await ana.page.waitForSelector('h1:has-text("내 프로필")')
    assert.equal((await api(ana, 'GET', '/me')).locale, 'ko')
    assert.equal(await ana.page.locator('.language input[value="ko"]').isChecked(), true)
    await korean.capture(ana.page, 'profile-language-picker')
    await ana.page.reload()
    await ana.page.waitForSelector('.tabs a:has-text("노트")')

    const koreanScreens: ReadonlyArray<readonly [string, string]> = [
      ['home', '/#/'],
      ...mainScreens,
      ['search', '/#/search?q=migration'],
      ['device', '/#/device'],
      ['admin-members', '/#/admin/members'],
      ['admin-audit', '/#/admin/audit'],
    ]
    for (const width of [VIEWPORT.width, 390]) {
      await ana.page.setViewportSize({ width, height: width === 390 ? 780 : VIEWPORT.height })
      for (const [name, path] of koreanScreens) {
        await ana.page.goto(`${base}${path}`)
        await ana.page.waitForTimeout(700)
        const label = `${width === 390 ? 'narrow' : 'wide'}-${name}`
        assert.equal(await overflowsSideways(ana.page), false, `${label} overflows sideways in Korean`)
        assert.deepEqual(await clippedText(ana.page), [], `${label} clips Korean text`)
        await korean.capture(ana.page, label)
      }
    }
    await ana.page.setViewportSize(VIEWPORT)
    await ana.page.goto(`${base}/#/c/${group.id}`)
    await ana.page.waitForSelector('.note-status:has-text("명 읽음")')
    const koreanButtonDevice = await startDeviceFlow(base, 'Homingbird mod', 'notes approve')
    await ana.page.goto(`${base}/#/device/${koreanButtonDevice.user_code}`)
    await ana.page.waitForSelector('input[name=allowApproval]')
    assert.equal(await ana.page.locator('input[name=allowApproval]').isChecked(), false)
    await korean.capture(ana.page, 'device-approve-button-allowed-by-the-server')
    await ana.page.goto(`${base}/#/me`)
    await ana.page.locator('.language input[value=""]').check()
    await ana.page.waitForSelector('html[lang="en"]')
    await ana.page.waitForSelector('h1:has-text("Your profile")')
    assert.equal((await api(ana, 'GET', '/me')).locale, undefined)

    // -- Approve button turned off by the organization --------------------------------------------
    await dovecote.stop()
    dovecote = await startDovecote(port, databasePath, 'off')
    const offDevice = await startDeviceFlow(base, 'Homingbird mod', 'notes approve')
    await ana.page.goto(`${base}/#/device/${offDevice.user_code}`)
    await ana.page.waitForSelector('text=Homingbird mod wants to connect')
    assert.equal(await ana.page.locator('input[name=allowApproval]').count(), 0)
    await capture(ana.page, 'device-approval-with-the-approve-button-turned-off')
    await api(ana, 'PATCH', '/me', { locale: 'ko' })
    await ana.page.reload()
    await ana.page.waitForSelector('text=Homingbird 계정에 연결하려고 해요')
    assert.equal(await ana.page.locator('input[name=allowApproval]').count(), 0)
    await korean.capture(ana.page, 'device-approve-button-turned-off-by-the-server')
    await ana.page.getByRole('button', { name: '승인' }).click()
    await ana.page.waitForSelector('.outcome.is-approved')
    await api(ana, 'PATCH', '/me', { locale: null })

    const koreanVisitor = await newPage(browser, base, 'ko-KR')
    await koreanVisitor.page.waitForSelector('html[lang="ko"]')
    await koreanVisitor.page.waitForSelector('a[href^="/auth/login"]:has-text("로그인")')
    assert.deepEqual(await clippedText(koreanVisitor.page), [], 'the Korean sign-in page clips text')
    await korean.capture(koreanVisitor.page, 'sign-in-follows-the-browser')
    await koreanVisitor.context.close()
    kaiStream.abort()
  } finally {
    await browser.close()
    await dovecote.stop()
    for (const suffix of ['', '-wal', '-shm']) await rm(`${databasePath}${suffix}`, { force: true })
  }
}

await scenario()
process.stdout.write(`e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
