import { strict as assert } from 'node:assert'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Task as T } from '@homingbird/kernel'
import { loadConfig } from '../../dovecote/src/config.ts'
import { startServer } from '../../dovecote/src/http/node-server.ts'
import { buildRuntime } from '../../dovecote/src/runtime.ts'
import { openDatabase } from '../../dovecote/src/sql/open.ts'
import { migrate } from '../../dovecote/src/sql/schema.ts'

const here = dirname(fileURLToPath(import.meta.url))
const screenshots = process.env.HB_E2E_SCREENSHOTS ?? join(here, 'screenshots')
const { chromium } = createRequire(import.meta.url)('playwright')

const scenario = async (): Promise<void> => {
  const port = await freePort()
  const base = `http://localhost:${port}`
  const databasePath = join(tmpdir(), `homingbird-e2e-${port}.sqlite`)
  await rm(screenshots, { recursive: true, force: true })
  await mkdir(screenshots, { recursive: true })
  let dovecote = await startDovecote(port, databasePath)
  const browser = await chromium.launch()
  const capture = screenshotCounter()
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
    await capture(ana.page, 'empty-home')

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
    await june.page.waitForFunction(() => document.querySelectorAll('.pending .draft').length === 2)
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
    await june.page.waitForFunction(() => document.querySelectorAll('.pending .draft').length === 0)
    await capture(ana.page, 'replied-seen-by-sender')
    await capture(june.page, 'replied-seen-by-recipient-alternatives-discarded')

    const anaAgent = await connectAgent(base, ana, 'Ana laptop agent', true)
    const follow = await anaAgent.call('POST', '/drafts', {
      to: [ids.June],
      body: 'Thanks. I will run it at 2am and report back.',
    })
    await anaAgent.call('POST', '/drafts', { to: [ids.June], body: 'A draft that will be thrown away.' })
    await ana.page.waitForFunction(() => document.querySelectorAll('.pending .draft').length === 2)
    await capture(ana.page, 'drafts-before-discarding')
    await ana.page
      .locator('.draft', { hasText: 'thrown away' })
      .getByRole('button', { name: 'Discard' })
      .click()
    await ana.page.waitForFunction(() => document.querySelectorAll('.pending .draft').length === 1)
    await capture(ana.page, 'after-discarding')

    await ana.page.locator('.draft', { hasText: 'report back' }).getByRole('button', { name: 'Send' }).click()
    await ana.page.waitForFunction(() => document.querySelectorAll('.pending .draft').length === 0)
    await ana.page.waitForSelector('.origin.is-agent')
    await capture(ana.page, 'origin-badges-human-edited-and-agent')
    assert.equal((await api(ana, 'GET', `/notes/${follow.id}`)).status, 'sent')
    const origins = await ana.page
      .locator('.origin')
      .evaluateAll((nodes: Element[]) => nodes.map((node) => node.className))
    for (const origin of ['is-human', 'is-human_edited', 'is-agent'])
      assert.ok(
        origins.some((name: string) => name.split(' ').includes(origin)),
        `missing origin badge ${origin}`,
      )

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
      await toggle.check().catch(() => undefined)
      await ana.page.waitForTimeout(1500)
      await capture(ana.page, 'notification-toggle-after-turning-on')
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
    const buttonDevice = await startDeviceFlow(base, 'Homingbird mod', 'notes approve')
    await ana.page.goto(`${base}/#/device/${buttonDevice.user_code}`)
    await ana.page.waitForSelector('input[type=checkbox]')
    await capture(ana.page, 'device-approval-with-approve-button-checkbox')
    await ana.page.getByRole('button', { name: 'Approve' }).click()
    await ana.page.waitForSelector('text=Connected')
    await capture(ana.page, 'device-approved')

    const consentUrl = await startAuthorization(base, 'Example MCP client')
    await ana.page.goto(consentUrl)
    await ana.page.waitForSelector('text=Example MCP client')
    await capture(ana.page, 'oauth-consent')

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
    await capture(ana.page, 'group-conversation')

    // -- Connection lost and restored ------------------------------------------------------------
    await dovecote.stop()
    await ana.page.waitForSelector('.connection.is-offline, .connection:has-text("Offline")', {
      timeout: 20_000,
    })
    await capture(ana.page, 'connection-lost')
    dovecote = await startDovecote(port, databasePath)
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
    kaiStream.abort()
  } finally {
    await browser.close()
    await dovecote.stop()
    for (const suffix of ['', '-wal', '-shm']) await rm(`${databasePath}${suffix}`, { force: true })
  }
}

interface Person {
  readonly name: string
  readonly context: any
  readonly page: any
}

const VIEWPORT = { width: 1200, height: 800 }

const newPage = async (browser: any, base: string): Promise<Person> => {
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: VIEWPORT, colorScheme: 'light' })
  const page = await context.newPage()
  page.on('pageerror', (error: Error) => {
    throw new Error(`page error: ${error.message}`)
  })
  await page.goto(base)
  return { name: '', context, page }
}

const submitDevelopmentLogin = async (page: any, email: string, name: string): Promise<void> => {
  await page.click('a[href^="/auth/login"]')
  await page.fill('input[name=email]', email)
  await page.fill('input[name=name]', name)
  await page.click('button')
}

const signInWith =
  (browser: any, base: string) =>
  async (email: string, name: string): Promise<Person> => {
    const person = await newPage(browser, base)
    await submitDevelopmentLogin(person.page, email, name)
    await person.page.waitForSelector('.app')
    return { ...person, name }
  }

const api = async (person: Person, method: string, path: string, body?: unknown): Promise<any> => {
  const origin = new URL(person.page.url()).origin
  const response = await person.context.request.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'x-homingbird-request': '1',
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    ...(body !== undefined && { data: body }),
  })
  if (!response.ok())
    throw new Error(`${method} ${path} answered ${response.status()}: ${await response.text()}`)
  return response.json()
}

const sendThroughApi = async (person: Person, draft: object): Promise<void> => {
  const created = await api(person, 'POST', '/drafts', draft)
  await api(person, 'POST', `/drafts/${created.id}/send`, {})
}

const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
})

const startDeviceFlow = async (base: string, clientName: string, scope: string): Promise<any> =>
  (await fetch(`${base}/oauth/device_authorization`, form({ client_name: clientName, scope }))).json()

const connectAgent = async (base: string, owner: Person, name: string, approveButton: boolean) => {
  const started = await startDeviceFlow(base, name, approveButton ? 'notes approve' : 'notes')
  await api(owner, 'POST', `/device/${started.user_code}`, {
    approve: true,
    name,
    allowApproval: approveButton,
  })
  const tokens = (await (
    await fetch(
      `${base}/oauth/token`,
      form({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: started.device_code }),
    )
  ).json()) as { access_token: string }
  return {
    token: tokens.access_token,
    call: async (method: string, path: string, body?: unknown): Promise<any> =>
      (
        await fetch(`${base}/api/v1${path}`, {
          method,
          headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json' },
          ...(body !== undefined && { body: JSON.stringify(body) }),
        })
      ).json(),
  }
}

const holdEventStream = (base: string, token: string): AbortController => {
  const held = new AbortController()
  void fetch(`${base}/api/v1/events/stream`, {
    headers: { authorization: `Bearer ${token}` },
    signal: held.signal,
  })
    .then(async (response) => {
      for await (const _ of response.body as unknown as AsyncIterable<Uint8Array>) continue
    })
    .catch(() => undefined)
  return held
}

const startAuthorization = async (base: string, clientName: string): Promise<string> => {
  const redirectUri = 'https://client.example/callback'
  const client = (await (
    await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: clientName, redirect_uris: [redirectUri] }),
    })
  ).json()) as { client_id: string }
  return `${base}/oauth/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    state: 'e2e',
  }).toString()}`
}

const overflowsSideways = (page: any): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)

const screenshotCounter = () => {
  let taken = 0
  return async (page: any, name: string): Promise<void> => {
    taken += 1
    await page.waitForTimeout(350)
    await page.screenshot({ path: join(screenshots, `${String(taken).padStart(2, '0')}-${name}.png`) })
  }
}

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const probe = createServer()
    probe.listen(0, () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    })
  })

const startDovecote = async (port: number, databasePath: string) => {
  const config = loadConfig({
    HB_PUBLIC_URL: `http://localhost:${port}`,
    HB_PORT: String(port),
    HB_DEV_LOGIN: '1',
    HB_ALLOWED_DOMAINS: 'example.com',
    HB_DATABASE_URL: `sqlite:${databasePath}`,
    HB_WEB_DIR: join(here, '..', 'dist'),
  })
  if (config._tag === 'Err') throw new Error(config.error.join('; '))
  const database = await openDatabase(config.value.databaseUrl)
  const { env, background } = buildRuntime({ config: config.value, database, log: () => {} })
  await T.runPromise(migrate, env)
  const work = T.runFork(background, env)
  const server = await startServer(env, port)
  let stopped = false
  return {
    stop: async (): Promise<void> => {
      if (stopped) return
      stopped = true
      await server.close()
      await work.interrupt()
      await database.close()
    },
  }
}

await scenario()
process.stdout.write(`e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
