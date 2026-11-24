import { strict as assert } from 'node:assert'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { en } from '../src/languages/en.ts'
import {
  type Person,
  VIEWPORT,
  api,
  clippedText,
  connectAgent,
  freePort,
  newPage,
  overflowsSideways,
  screenshotCounter,
  sendDraft,
  signInWith,
  startDovecote,
  submitDevelopmentLogin,
} from './support.ts'

const here = dirname(fileURLToPath(import.meta.url))
const screenshots = process.env.HB_E2E_SCREENSHOTS_DASHBOARD ?? join(here, 'screenshots-dashboard')
const { chromium } = createRequire(import.meta.url)('playwright')

const SECOND = 1000
const HOUR = 60 * 60 * SECOND
const DAY = 24 * HOUR
const NARROW = { width: 390, height: 844 }

interface Timing {
  readonly id: string
  readonly question?: string
  readonly decidedAgo: number
  readonly secondsToDecide: number
}

const scenario = async (): Promise<void> => {
  const port = await freePort()
  const base = `http://localhost:${port}`
  const databasePath = join(tmpdir(), `homingbird-e2e-dashboard-${port}.sqlite`)
  await rm(screenshots, { recursive: true, force: true })
  await rm(databasePath, { force: true })
  await mkdir(screenshots, { recursive: true })
  const dovecote = await startDovecote(
    port,
    databasePath,
    'billing:Invoices and refunds,payroll:Salaries and payslips',
  )
  const browser = await chromium.launch()
  const { capture } = screenshotCounter(screenshots)
  const captureScrolled = async (page: any, name: string, selector: string): Promise<void> => {
    await page.locator(selector).evaluate((element: any) => {
      const stage = element.closest('.stage')
      stage.scrollTo(
        0,
        element.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop - 16,
      )
      ;(globalThis as any).scrollTo(0, 0)
    })
    await page.evaluate(() => (globalThis as any).document.querySelector('.toast button')?.click())
    await capture(page, name)
    await page.locator('.stage').evaluate((element: any) => element.scrollTo(0, 0))
  }
  const signIn = signInWith(browser, base)
  const timings: Timing[] = []

  try {
    const ana = await signIn('ana@example.com', 'Ana')
    const colleagues: Person[] = []
    for (const [email, name] of [
      ['ben@example.com', 'Ben'],
      ['cy@example.com', 'Cy'],
      ['dee@example.com', 'Dee'],
      ['eve@example.com', 'Eve'],
      ['fay@example.com', 'Fay'],
    ] as const)
      colleagues.push(await signIn(email, name))
    const [ben, cy, dee, eve, fay] = colleagues as [Person, Person, Person, Person, Person]
    const idOf = async (person: Person): Promise<string> => (await api(person, 'GET', '/me')).member.id
    const anaId = await idOf(ana)
    const agent = await connectAgent(base, ana, 'Ana desk')
    await api(ana, 'PUT', '/channels/billing/membership', { answering: true })
    await api(ana, 'PUT', '/channels/payroll/membership', { answering: true })

    const ask = async (person: Person, channel: string, body: string): Promise<string> => {
      const draft = await api(person, 'POST', '/drafts', { channel, body })
      return (await sendDraft(person, draft.id)).id
    }
    const answer = async (
      question: string,
      body: string,
      decide: 'as_written' | 'edited' | 'discarded',
      decidedAgo: number,
      secondsToDecide = 45,
    ): Promise<void> => {
      const draft = await agent.call('POST', '/drafts', { inReplyTo: question, body })
      await decideDraft(draft.id, body, decide, decidedAgo, secondsToDecide, question)
    }
    const decideDraft = async (
      id: string,
      body: string,
      decide: 'as_written' | 'edited' | 'discarded',
      decidedAgo: number,
      secondsToDecide: number,
      question?: string,
    ): Promise<void> => {
      await api(ana, 'POST', `/drafts/${id}/seen`)
      if (decide === 'discarded') await api(ana, 'POST', `/drafts/${id}/discard`)
      else await sendDraft(ana, id, decide === 'edited' ? `${body} (checked)` : undefined)
      timings.push({ id, decidedAgo, secondsToDecide, ...(question !== undefined && { question }) })
    }

    // -- A realistic week: #billing mostly sent as written, #payroll mostly edited -------------------
    const askers = [ben, cy, dee, eve, fay]
    for (let index = 0; index < 10; index++) {
      const question = await ask(askers[index % 5]!, 'billing', `Has invoice ${4100 + index} been paid?`)
      await answer(
        question,
        `Yes, invoice ${4100 + index} was paid on the 3rd.`,
        index === 6 ? 'edited' : 'as_written',
        (index % 7) * DAY + 3 * HOUR + index * 600 * SECOND,
        index < 4 ? 2 : 30 + index * 9,
      )
    }
    for (let index = 0; index < 6; index++) {
      const question = await ask(
        askers[(index + 2) % 5]!,
        'payroll',
        `When does the payslip for month ${index + 1} arrive?`,
      )
      await answer(
        question,
        `Payslips for month ${index + 1} arrive on the 25th.`,
        index === 1 || index === 4 ? 'as_written' : index === 5 ? 'discarded' : 'edited',
        (index % 6) * DAY + 5 * HOUR,
        80 + index * 20,
      )
    }
    for (const [index, person] of [ben, cy].entries()) {
      const draft = await agent.call('POST', '/drafts', {
        to: [await idOf(person)],
        body: `Thanks, I will look at it today (${index + 1}).`,
      })
      await decideDraft(draft.id, '', 'as_written', (index + 1) * DAY, 25)
    }
    const skipped = await ask(dee, 'payroll', 'Can you change my bank account?')
    await agent.call('POST', `/notes/${skipped}/release`, { reason: 'Needs payroll system access' })
    const skippedToo = await ask(eve, 'payroll', 'What is my remaining leave?')
    await agent.call('POST', `/notes/${skippedToo}/release`, { reason: 'needs payroll system access' })
    for (const body of ['I will be out on Friday.', 'Lunch at noon?']) {
      const own = await api(ana, 'POST', '/drafts', { to: [await idOf(ben)], body })
      await sendDraft(ana, own.id)
    }
    for (const person of colleagues) {
      const note = await api(person, 'POST', '/drafts', { to: [anaId], body: 'Quick hello for the numbers.' })
      await sendDraft(person, note.id)
    }

    // -- Earlier weeks for the trend: the share sent as written grew week by week -------------------
    const earlier: ReadonlyArray<readonly [number, number]> = [
      [6, 2],
      [6, 3],
      [5, 3],
      [6, 4],
      [7, 5],
      [8, 6],
      [9, 6],
    ]
    for (const [weeksBack, [decided, asWritten]] of earlier.map((week, index) => [7 - index, week] as const))
      for (let index = 0; index < decided; index++) {
        const draft = await agent.call('POST', '/drafts', {
          to: [await idOf(fay)],
          body: `Earlier answer ${weeksBack}.${index}`,
        })
        await decideDraft(
          draft.id,
          draft.body,
          index < asWritten ? 'as_written' : 'edited',
          weeksBack * 7 * DAY + (index + 1) * 5 * HOUR,
          60,
        )
      }
    spreadOverTime(databasePath, timings)

    // -- A waiting draft is reported as seen once its card is on screen -----------------------------
    const waiting = await agent.call('POST', '/drafts', { to: [await idOf(cy)], body: 'Shall we meet at 3?' })
    await ana.page.goto(`${base}/#/c/${waiting.conversationId}`)
    await ana.page.waitForSelector(`.draft[data-draft-id="${waiting.id}"]`)
    await waitUntilSeen(databasePath, waiting.id)

    // -- Approving quickly often: a draft with a number asks for a careful read, without blocking ------
    await ana.page.waitForSelector(
      `.draft[data-draft-id="${waiting.id}"] .careful-reading:has-text("This draft has a number in it. Read it before sending.")`,
    )
    assert.equal(
      await ana.page.locator(`.draft[data-draft-id="${waiting.id}"] button:has-text("Send")`).isEnabled(),
      true,
    )
    await capture(ana.page, 'draft-with-a-number-asks-for-a-careful-read')

    // -- For someone new, resting the mouse on Approve and send shows one quiet line of what it does ----
    await ana.page.hover(`.draft[data-draft-id="${waiting.id}"] .draft-send`)
    await ana.page.waitForSelector('.hint-tip:popover-open:has-text("nothing leaves until you do")')
    await ana.page.mouse.move(0, 0)
    await ana.page.waitForSelector('.hint-tip:popover-open', { state: 'detached' })
    assert.equal(await ana.page.locator('.trust-card').count(), 0)

    // -- The page, from the header: where it answers like you, verdict, numbers, trend, what is measured ----------------
    await ana.page.click('.tab:has-text("Nest")')
    await ana.page.click('.my-agent-tabs a:has-text("How it is doing")')
    await ana.page.waitForFunction(() => (globalThis as any).location.hash === '#/agent/doing')
    await ana.page.waitForSelector('#trust-verdict:has-text("usually sent as written")')
    await ana.page.waitForSelector(
      '.answers-place[data-place="billing"]:has-text("9 of 10 decided drafts sent as written")',
    )
    await ana.page.waitForSelector(
      '.answers-place[data-place="payroll"]:has-text("2 of 6 decided drafts sent as written")',
    )
    await ana.page.waitForSelector('.trust-reasons li:has-text("Needs payroll system access: 2 times")')
    assert.equal(await ana.page.locator('.trend-week').count(), 8)
    await ana.page.click('.trust-measured summary')
    await ana.page.click('.trend-table summary')
    assert.equal(await overflowsSideways(ana.page), false)
    assert.deepEqual(await clippedText(ana.page), [])
    await captureScrolled(ana.page, 'page-wide-light', '#agent-doing')
    await captureScrolled(ana.page, 'page-wide-light-channels', '#answers-like-you')
    await captureScrolled(ana.page, 'page-wide-light-trend', '#trust-trend')
    await ana.page.emulateMedia({ colorScheme: 'dark' })
    await captureScrolled(ana.page, 'page-wide-dark', '#agent-doing')
    await captureScrolled(ana.page, 'page-wide-dark-trend', '#trust-trend')
    await ana.page.emulateMedia({ colorScheme: 'light' })
    await ana.page.check('input[name="trust-period"][value="30"]')
    await ana.page.waitForSelector('.trust-table caption:has-text("last 30 days")')
    await captureScrolled(ana.page, 'page-last-30-days', '#agent-doing')

    // -- Keyboard: the period choice and the disclosures are reachable without a pointer -------------
    await ana.page.focus('input[name="trust-period"][value="30"]')
    await ana.page.keyboard.press('ArrowLeft')
    await ana.page.waitForSelector('.trust-table caption:has-text("last 7 days")')

    // -- Narrow screens -----------------------------------------------------------------------------
    await ana.page.setViewportSize(NARROW)
    await ana.page.goto(`${base}/#/agent/doing`)
    await ana.page.waitForSelector('#trust-verdict')
    assert.equal(await overflowsSideways(ana.page), false)
    await captureScrolled(ana.page, 'page-narrow-light', '#agent-doing')
    await captureScrolled(ana.page, 'page-narrow-light-channels', '#answers-like-you')
    await captureScrolled(ana.page, 'page-narrow-light-trend', '#trust-trend')
    await ana.page.emulateMedia({ colorScheme: 'dark' })
    await captureScrolled(ana.page, 'page-narrow-dark', '#agent-doing')
    await captureScrolled(ana.page, 'page-narrow-dark-trend', '#trust-trend')
    await ana.page.emulateMedia({ colorScheme: 'light' })
    await ana.page.setViewportSize(VIEWPORT)

    // -- Administrators: organization-wide totals only ----------------------------------------------
    await ana.page.goto(`${base}/#/admin/insights`)
    await ana.page.waitForSelector('.insights .trust-table')
    await ana.page.waitForSelector(`.insights:has-text("${en.insights.noTeams}")`)
    const adminText = await ana.page.locator('.insights').innerText()
    for (const name of ['Ana', 'Ben', 'Cy', 'Dee', 'Eve', 'Fay', 'invoice', 'payslip'])
      assert.equal(new RegExp(`\\b${name}\\b`).test(adminText), false, `the admin view shows ${name}`)
    await capture(ana.page, 'admin-insights-wide-light')
    await ana.page.emulateMedia({ colorScheme: 'dark' })
    await capture(ana.page, 'admin-insights-wide-dark')
    await ana.page.emulateMedia({ colorScheme: 'light' })
    await ana.page.setViewportSize(NARROW)
    assert.equal(await overflowsSideways(ana.page), false)
    await capture(ana.page, 'admin-insights-narrow-light')
    await ana.page.setViewportSize(VIEWPORT)

    // -- Korean ---------------------------------------------------------------------------------------
    const korean: Person = await newPage(browser, base, 'ko-KR')
    await submitDevelopmentLogin(korean.page, 'ana@example.com', 'Ana')
    await korean.page.waitForSelector('.tab:has-text("둥지")')
    await korean.page.goto(`${base}/#/agent/doing`)
    await korean.page.waitForSelector('#trust-verdict:has-text("에이전트 초안은 대개 그대로 보내요")')
    await korean.page.waitForSelector(
      '.answers-place[data-place="billing"]:has-text("결정한 초안 10개 중 9개를 그대로 보냄")',
    )
    await korean.page.click('.trust-measured summary')
    await korean.page.locator('.stage').evaluate((element: any) => element.scrollTo(0, 0))
    assert.deepEqual(await clippedText(korean.page), [])
    await captureScrolled(korean.page, 'korean-page', '#agent-doing')
    await korean.context.close()
  } finally {
    await browser.close()
    await dovecote.stop()
  }
}

/** Moves each decision back in time, keeping its order, so the week and the trend look like weeks of use. */
const spreadOverTime = (databasePath: string, timings: ReadonlyArray<Timing>): void => {
  const database = new DatabaseSync(databasePath)
  const now = Date.now()
  const update = database.prepare(
    'UPDATE notes SET created_at = ?, seen_at = ?, decided_at = ?, sent_at = CASE WHEN sent_at IS NULL THEN NULL ELSE ? END, updated_at = ? WHERE id = ?',
  )
  const asked = database.prepare('UPDATE notes SET created_at = ?, sent_at = ?, updated_at = ? WHERE id = ?')
  for (const timing of timings) {
    const decidedAt = now - timing.decidedAgo
    const seenAt = decidedAt - timing.secondsToDecide * SECOND
    const draftedAt = seenAt - 90 * SECOND
    update.run(draftedAt, seenAt, decidedAt, decidedAt, decidedAt, timing.id)
    if (timing.question !== undefined) {
      const askedAt = draftedAt - 20 * 60 * SECOND
      asked.run(askedAt, askedAt, askedAt, timing.question)
    }
  }
  database.close()
}

const waitUntilSeen = async (databasePath: string, id: string): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const database = new DatabaseSync(databasePath)
    const row = database.prepare('SELECT seen_at FROM notes WHERE id = ?').get(id) as {
      seen_at: number | null
    }
    database.close()
    if (row.seen_at !== null) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('the draft card was shown but never reported as seen')
}

await scenario()
process.stdout.write(`dashboard e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
