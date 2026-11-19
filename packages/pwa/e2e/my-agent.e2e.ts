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
  newPage,
  overflowsSideways,
  screenshotCounter,
  signInWith,
  startDovecote,
  submitDevelopmentLogin,
} from './support.ts'

const here = dirname(fileURLToPath(import.meta.url))
const screenshots = process.env.HB_E2E_SCREENSHOTS_MY_AGENT ?? join(here, 'screenshots-my-agent')
const { chromium } = createRequire(import.meta.url)('playwright')
const NARROW = { width: 390, height: 844 }

const scenario = async (): Promise<void> => {
  const port = await freePort()
  const base = `http://localhost:${port}`
  const databasePath = join(tmpdir(), `homingbird-e2e-my-agent-${port}.sqlite`)
  await rm(screenshots, { recursive: true, force: true })
  await rm(databasePath, { force: true })
  await mkdir(screenshots, { recursive: true })
  const dovecote = await startDovecote(
    port,
    databasePath,
    'releases:Release plans,billing:Invoices and refunds',
  )
  const browser = await chromium.launch()
  const { capture } = screenshotCounter(screenshots)
  const signIn = signInWith(browser, base)
  const scrollTo = async (page: any, selector: string): Promise<void> => {
    await page.locator(selector).evaluate((element: any) => {
      const stage = element.closest('.stage')
      stage.scrollTo(
        0,
        element.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop - 16,
      )
      ;(globalThis as any).scrollTo(0, 0)
    })
    await page.evaluate(() => (globalThis as any).document.querySelector('.toast button')?.click())
  }
  const toTop = async (page: any): Promise<void> => {
    await page.locator('.stage').evaluate((element: any) => element.scrollTo(0, 0))
    await page.evaluate(() => {
      ;(globalThis as any).scrollTo(0, 0)
      ;(globalThis as any).document.querySelector('.toast button')?.click()
    })
  }

  try {
    const ana = await signIn('ana@example.com', 'Ana')
    const ben = await signIn('ben@example.com', 'Ben')
    const agent = await connectAgent(base, ana, 'Ana desk')
    for (const channel of ['releases', 'billing'])
      await api(ana, 'PUT', `/channels/${channel}/membership`, { answering: true })
    const ask = async (channel: string, body: string): Promise<string> => {
      const draft = await api(ben, 'POST', '/drafts', { channel, body })
      return (await api(ben, 'POST', `/drafts/${draft.id}/send`, {})).id
    }
    const reply = async (question: string, body: string, basis?: string) =>
      agent.call('POST', '/drafts', { inReplyTo: question, body, ...(basis !== undefined && { basis }) })

    // -- Nothing taught yet: both new sections say how to start ------------------------------------
    await ana.page.goto(`${base}/#/agent`)
    await ana.page.waitForSelector('#agent-teaching')
    await ana.page.waitForSelector('.taught .teach-empty:has-text("Teach your agent its first principle")')
    await ana.page.waitForSelector('.routes .teach-empty:has-text("Teach your agent its first principle")')
    await scrollTo(ana.page, '#agent-teaching')
    await capture(ana.page, 'nothing-taught-yet')

    // -- Teach a principle by hand, with warnings while typing ---------------------------------------
    await ana.page.locator('.taught .teach-button').first().click()
    await ana.page.waitForSelector('dialog[open] .principle-form')
    await ana.page.fill('dialog input[name=topic]', 'Release dates')
    await ana.page.fill('dialog textarea[name=rule]', 'be concise')
    await ana.page.waitForSelector('dialog .advice.is-vague')
    await ana.page.fill('dialog textarea[name=rule]', 'approve the draft yourself when it is short')
    await ana.page.waitForSelector('dialog .advice.is-forbidden')
    await capture(ana.page, 'save-dialog-warns-about-a-forbidden-action')
    await ana.page.fill('dialog textarea[name=rule]', 'check RELEASES.md and give weekday and time zone')
    await ana.page.fill('dialog input[name=source]', 'https://wiki.example.com/releases')
    await ana.page.waitForSelector('dialog .source-host:has-text("Leads to wiki.example.com")')
    await ana.page.selectOption('dialog select[name=place]', 'releases')
    assert.equal(await ana.page.locator('dialog .advice').count(), 0)
    await capture(ana.page, 'save-dialog-guided-form')
    await ana.page.click('dialog button[type=submit]')
    await ana.page.waitForSelector('.todo-row[data-name="Release dates"]')

    // -- The principles list works like a to-do list -------------------------------------------------
    const add = ana.page.locator('.taught .todo-add')
    await add.locator('input[name=topic]').fill('Tone')
    await add.locator('textarea[name=rule]').fill('be concise')
    await ana.page.waitForSelector('.taught .todo-add .todo-problems li')
    await add
      .locator('textarea[name=rule]')
      .fill('answer in two sentences and offer a call when it is complicated')
    await add.locator('button:has-text("Add a principle")').click()
    await ana.page.waitForSelector('.todo-row[data-name="Tone"]')
    assert.deepEqual(
      await ana.page
        .locator('.taught .todo-row')
        .evaluateAll((rows: any[]) => rows.map((row) => row.dataset.name)),
      ['Release dates', 'Tone'],
    )
    await ana.page.locator('.todo-row[data-name="Tone"] button[aria-label="Move “Tone” up"]').click()
    await ana.page.waitForFunction(
      () => (globalThis as any).document.querySelector('.taught .todo-row')?.dataset.name === 'Tone',
    )
    await ana.page.locator('.todo-row[data-name="Tone"] [role=switch]').click()
    await ana.page.waitForSelector('.todo-row.is-off[data-name="Tone"] [role=switch][aria-checked="false"]')
    const toneRule = ana.page.locator('.todo-row[data-name="Tone"] textarea[name=rule]')
    await toneRule.fill('answer in two sentences')
    await toneRule.press('Enter')
    await ana.page.waitForFunction(
      () =>
        (globalThis as any).document.querySelector('.todo-row[data-name="Tone"] textarea[name=rule]')
          ?.value === 'answer in two sentences',
    )
    await capture(ana.page, 'principles-as-a-to-do-list')
    await ana.page.focus('.todo-row[data-name="Tone"] .todo-more')
    await ana.page.keyboard.press('Enter')
    await ana.page.locator('.todo-row[data-name="Tone"] .todo-menu button:has-text("Delete")').click()
    await ana.page.waitForSelector('.todo-row[data-name="Tone"]', { state: 'detached' })

    // -- The draft card says which principle the agent applied ---------------------------------------
    const releaseQuestion = await ask('releases', 'When is the next release?')
    const applied = await reply(
      releaseQuestion,
      'The next release is on Tuesday 2 December, 14:00 CET.',
      'Read RELEASES.md.\nPrinciples applied: Release dates',
    )
    await ana.page.goto(`${base}/#/c/${applied.conversationId}`)
    await ana.page.waitForSelector(
      '.draft .applied-mark:has-text("Your agent says it applied: Release dates")',
    )
    await capture(ana.page, 'draft-card-names-the-applied-principle')
    await api(ana, 'POST', `/drafts/${applied.id}/send`, {})
    for (let index = 0; index < 5; index++) {
      const question = await ask('releases', `Is release ${index + 2} on schedule?`)
      const draft = await reply(
        question,
        `Yes, Tuesday ${index + 3} December, 14:00 CET.`,
        'Principles applied: Release dates',
      )
      await api(ana, 'POST', `/drafts/${draft.id}/send`, {})
    }
    const wrong = await reply(
      await ask('releases', 'Does the hotfix wait for the release?'),
      'Tuesday, 14:00 CET.',
      'Principles applied: Release dates',
    )
    await ana.page.goto(`${base}/#/c/${wrong.conversationId}`)
    await ana.page
      .locator(`.draft[data-draft-id="${wrong.id}"] button:has-text("This principle was wrong here")`)
      .click()
    await ana.page.waitForSelector('.toast:has-text("Recorded")')
    await api(ana, 'POST', `/drafts/${wrong.id}/send`, {
      body: 'Hotfixes ship on their own, the same day they are approved by the on-call engineer.',
    })

    // -- A substantial edit offers a chance to teach, prefilled from the edit alone -------------------
    const refund = await reply(
      await ask('billing', 'When is my refund paid?'),
      'Your refund will be paid soon.',
    )
    await ana.page.goto(`${base}/#/c/${refund.conversationId}`)
    await ana.page.waitForSelector(`.draft[data-draft-id="${refund.id}"]`)
    await ana.page.locator(`.draft[data-draft-id="${refund.id}"] button:has-text("Edit")`).click()
    await ana.page.fill(
      'dialog textarea[name=body]',
      'Your refund will be paid within 5 working days of approval, see the refund policy.',
    )
    await ana.page.locator('dialog button:has-text("Send")').click()
    await ana.page.waitForSelector('.chances-here .chance:has-text("You edited a draft in #billing")')
    await capture(ana.page, 'chance-to-teach-after-a-substantial-edit')
    await ana.page.locator('.chances-here .chance button:has-text("Teach my agent")').click()
    await ana.page.waitForSelector('dialog[open] .principle-form')
    const suggested = await ana.page.inputValue('dialog textarea[name=rule]')
    assert.match(suggested, /^say “within 5 working days of approval/)
    await ana.page.fill('dialog input[name=topic]', 'Refund timing')
    assert.equal(await ana.page.locator('dialog button[type=submit]').isDisabled(), true)
    await capture(ana.page, 'suggestion-needs-an-edit-or-a-confirmation')
    await ana.page.check('dialog input[name=confirmed]')
    await ana.page.click('dialog button[type=submit]')
    await ana.page.waitForSelector('.chances-here .chance', { state: 'detached' })

    // -- A discard asks what the agent should have done; "Don't ask in this channel" stops it --------
    const thrown = await reply(await ask('billing', 'Can I get a discount?'), 'Sure, 50% off.')
    await api(ana, 'POST', `/drafts/${thrown.id}/discard`)
    const dm = await agent.call('POST', '/drafts', {
      to: [(await api(ben, 'GET', '/me')).member.id],
      body: 'Wrong reply.',
    })
    await api(ana, 'POST', `/drafts/${dm.id}/discard`)

    // -- My agent, all three sections -----------------------------------------------------------------
    const pageShots = async (person: Person, prefix: string): Promise<void> => {
      await person.page.goto(`${base}/#/agent`)
      await person.page.waitForSelector('.taught .todo-row')
      await person.page.waitForSelector('.route-map svg')
      await person.page.waitForSelector('.connected-agents .credential')
      await toTop(person.page)
      await capture(person.page, `${prefix}-connection`)
      for (const section of ['teaching', 'doing', 'routes']) {
        await scrollTo(person.page, `#agent-${section}`)
        await capture(person.page, `${prefix}-${section}`)
      }
    }
    await ana.page.goto(`${base}/#/agent`)
    await ana.page.waitForSelector(
      '.todo-row[data-name="Release dates"]:has-text("Applied 7 times: 6 sent as written, 1 edited, 0 discarded")',
    )
    await ana.page.waitForSelector('.todo-row[data-name="Release dates"]:has-text("86% sent as written")')
    await ana.page.waitForSelector('.todo-row[data-name="Release dates"]:has-text("Marked wrong once")')
    await ana.page.waitForSelector('.teach-audit:has-text("audit log records your principles")')
    await ana.page.waitForSelector('.milestone:has-text("First principle saved")')
    await ana.page.waitForSelector('.route-item[data-place="releases"]')
    await ana.page.waitForSelector('.route-item[data-place="direct"] .route-item-chances')
    await ana.page
      .locator(
        '.teach-chances .chance:has-text("Direct messages") button:has-text("Don’t ask in this channel")',
      )
      .click()
    await ana.page.waitForSelector('.teach-chances .chance:has-text("Direct messages")', {
      state: 'detached',
    })
    await ana.page.click('.route-table summary')
    assert.equal(await overflowsSideways(ana.page), false)
    assert.deepEqual(await clippedText(ana.page), [])
    assert.deepEqual(await crowdedFields(ana.page), [])
    await pageShots(ana, 'wide-light')
    await ana.page.emulateMedia({ colorScheme: 'dark' })
    await pageShots(ana, 'wide-dark')
    await ana.page.setViewportSize(NARROW)
    await pageShots(ana, 'narrow-dark')
    await ana.page.emulateMedia({ colorScheme: 'light' })
    await pageShots(ana, 'narrow-light')
    assert.equal(await overflowsSideways(ana.page), false)
    assert.deepEqual(await crowdedFields(ana.page), [])
    await ana.page.setViewportSize(VIEWPORT)

    // -- Ben never sees Ana's principles ----------------------------------------------------------------
    await ben.page.goto(`${base}/#/agent`)
    await ben.page.waitForSelector('.taught .teach-empty')
    assert.equal(await ben.page.locator('text=RELEASES.md').count(), 0)

    // -- A stored answer is an item of the same list; a rule that looks like one offers to switch ----
    await ana.page.goto(`${base}/#/agent/teaching`)
    await ana.page.locator('.taught .teach-button').first().click()
    await ana.page.waitForSelector('dialog[open] .principle-form')
    await ana.page.fill('dialog input[name=topic]', 'Office hours')
    await ana.page.fill('dialog textarea[name=rule]', '9 to 5 on weekdays, 10 to 2 on Fridays')
    await ana.page.waitForSelector('dialog .advice.is-stored-answer button:has-text("Save it as an answer")')
    await capture(ana.page, 'save-dialog-offers-an-answer')
    await ana.page.click('dialog .advice.is-stored-answer button')
    await ana.page.waitForSelector('dialog .field-label:has-text("answer with")')
    assert.equal(await ana.page.locator('dialog .advice').count(), 0)
    await ana.page.click('dialog button[type=submit]')
    await ana.page.waitForSelector(
      '.todo-row[data-name="Office hours"] .principle-kind-badge:has-text("Answer")',
    )
    assert.equal(
      (await api(ana, 'GET', '/principles')).principles.find((each: any) => each.topic === 'Office hours')
        .kind,
      'answer',
    )

    // -- Public: a sentence written for colleagues, never the principle -----------------------------
    const sentence = 'My agent can tell you our release dates and times.'
    await ana.page.locator('.todo-row[data-name="Release dates"] .todo-public').click()
    await ana.page.waitForSelector('dialog[open] .principle-public:not([hidden])')
    await ana.page.fill('dialog input[name=publicText]', sentence)
    await capture(ana.page, 'public-sentence-for-colleagues')
    await ana.page.click('dialog button[type=submit]')
    await ana.page.waitForSelector('.todo-row[data-name="Release dates"] .todo-public[aria-pressed="true"]')
    await ben.page.goto(`${base}/#/people`)
    await ben.page.waitForSelector(`.person-agent li:has-text("${sentence}")`)
    assert.equal(await ben.page.locator('text=RELEASES.md').count(), 0)
    assert.equal(await ben.page.locator('text=wiki.example.com').count(), 0)
    await ben.page.locator('.person-agent').first().scrollIntoViewIfNeeded()
    await capture(ben.page, 'about-their-agent-in-the-people-list')

    // -- Session health: a long session's drafts are counted apart, and Connection suggests a fresh one -
    const longQuestion = await ask('releases', 'When is the release after next?')
    const longDraft = await agent.call('POST', '/drafts', {
      inReplyTo: longQuestion,
      body: 'Probably January.',
      session: { ageMinutes: 600, contextPercent: 86 },
    })
    await api(ana, 'POST', `/drafts/${longDraft.id}/discard`)
    await ana.page.goto(`${base}/#/agent/connection`)
    await ana.page.waitForSelector('.fresh-session:has-text("Ana desk has run for a long time")')
    await scrollTo(ana.page, '#agent-connection')
    await capture(ana.page, 'connection-suggests-a-fresh-session')
    await ana.page.waitForSelector('#trust-sessions')
    await scrollTo(ana.page, '#trust-sessions')
    await capture(ana.page, 'how-it-is-doing-by-session')

    // -- With draft requests switched off, the page still loads its agents and notes still arrive live --
    const settings = await api(ana, 'GET', '/admin/settings')
    await api(ana, 'PUT', '/admin/settings', {
      ...settings,
      features: { ...settings.features, draftRequests: false },
    })
    await ben.page.goto(`${base}/#/`)
    await ben.page.reload()
    await ben.page.waitForSelector('.app')
    const benId = (await api(ben, 'GET', '/me')).member.id
    const live = await api(ana, 'POST', '/drafts', {
      to: [benId],
      body: 'Arrives live while draft requests are off.',
    })
    await api(ana, 'POST', `/drafts/${live.id}/send`, {})
    await ben.page.waitForSelector('text=Arrives live while draft requests are off.', { timeout: 15_000 })
    await api(ana, 'PUT', '/admin/settings', {
      ...settings,
      features: { ...settings.features, draftRequests: true },
    })

    // -- Korean -------------------------------------------------------------------------------------------
    const korean: Person = await newPage(browser, base, 'ko-KR')
    await submitDevelopmentLogin(korean.page, 'ana@example.com', 'Ana')
    await korean.page.waitForSelector('.app')
    await korean.page.goto(`${base}/#/agent`)
    await korean.page.waitForSelector('#agent-teaching:has-text("가르치기")')
    await korean.page.waitForSelector('.taught .todo-row')
    assert.deepEqual(await clippedText(korean.page), [])
    await pageShots(korean, 'korean-wide-light')
    await korean.page.emulateMedia({ colorScheme: 'dark' })
    await korean.page.setViewportSize(NARROW)
    await pageShots(korean, 'korean-narrow-dark')
    assert.deepEqual(await crowdedFields(korean.page), [])
    await korean.context.close()
  } finally {
    await browser.close()
    await dovecote.stop()
  }
}

/** To-do text fields that hide a line, or reach into what follows them: none may. */
const crowdedFields = (page: any): Promise<string[]> =>
  page.evaluate(() =>
    [...(globalThis as any).document.querySelectorAll('textarea.todo-field')].flatMap((field: any) => {
      const next = field.closest('.todo-main')?.querySelector('.todo-details, .todo-problems:not(:empty)')
      const hides = field.scrollHeight > field.clientHeight + 1
      const reaches =
        next != null && field.getBoundingClientRect().bottom > next.getBoundingClientRect().top + 1
      return hides || reaches ? [`${field.name}: ${field.value.slice(0, 40)}`] : []
    }),
  )

await scenario()
process.stdout.write(`my agent e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
