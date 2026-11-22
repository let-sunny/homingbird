import { strict as assert } from 'node:assert'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Person,
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
const screenshots = process.env.HB_E2E_SCREENSHOTS_THREAD ?? join(here, 'screenshots-thread')
const { chromium } = createRequire(import.meta.url)('playwright')
const NARROW = { width: 390, height: 844 }
const OPEN = '.author-details:popover-open'

const scenario = async (): Promise<void> => {
  const port = await freePort()
  const base = `http://localhost:${port}`
  const databasePath = join(tmpdir(), `homingbird-e2e-thread-${port}.sqlite`)
  await rm(screenshots, { recursive: true, force: true })
  await rm(databasePath, { force: true })
  await mkdir(screenshots, { recursive: true })
  const dovecote = await startDovecote(port, databasePath)
  const browser = await chromium.launch()
  const { capture } = screenshotCounter(screenshots)
  const signIn = signInWith(browser, base)

  try {
    // Ana's page has only just loaded when the notes arrive, so the thread opens while live events and
    // its first load overlap: every note must still be there.
    const ana = await signIn('ana@example.com', 'Ana')
    const ben = await signIn('ben@example.com', 'Ben')
    const benDesk = await connectAgent(base, ben, 'Ben desk')
    const to = [(await api(ana, 'GET', '/me')).member.id]
    const agentDraft = (body: string, labels: object = {}) =>
      benDesk.call('POST', '/drafts', { to, body, client: 'Claude Code 2.1.327', ...labels })
    const send = (person: Person, id: string, body?: string) => sendDraft(person, id, body)

    const first = await agentDraft('The export finished at 02:10.', { model: 'claude-opus-5-5' })
    await send(ben, first.id)
    const second = await agentDraft('All 1,204 invoices are in the archive.', { model: 'claude-opus-5-5' })
    await send(ben, second.id)
    const edited = await agentDraft('I can look at the refunds tomorrow.')
    await send(ben, edited.id, 'I can look at the refunds on Monday.')
    const byHand = await api(ben, 'POST', '/drafts', { to, body: 'Ping me if anything looks off.' })
    await send(ben, byHand.id)
    for (const body of ['Thanks, that helps.', 'I will tell the finance team.']) {
      const own = await api(ana, 'POST', '/drafts', { to: [(await api(ben, 'GET', '/me')).member.id], body })
      await send(ana, own.id)
    }
    const unsent = await agentDraft('UNSENT draft 5c1d', { model: 'hidden-model-5c1d' })
    const conversation = first.conversationId

    // -- The thread reads like chat: one character per run, a mark for how it was written --------------
    await ana.page.goto(`${base}/#/c/${conversation}`)
    await ana.page.waitForSelector('.note.is-theirs.is-person')
    await ana.page.waitForSelector('.note.is-mine.follows-run')
    assert.equal(await ana.page.locator('.note').count(), 6)
    assert.equal(await ana.page.locator('text=UNSENT draft 5c1d').count(), 0)
    assert.equal(await ana.page.locator(`[data-note-id="${unsent.id}"]`).count(), 0)
    assert.equal(await ana.page.locator('.note .origin').count(), 0)
    assert.equal(await ana.page.locator('.note.is-theirs .author-button').count(), 3)
    assert.equal(await ana.page.locator('.note.is-mine .author-button').count(), 1)
    assert.equal(await ana.page.locator('.note.follows-run').count(), 2)
    assert.equal(await ana.page.locator(`[data-note-id="${second.id}"] .author-button`).count(), 0)
    assert.equal(await ana.page.locator('.author-button.is-agent .author-mark').count(), 1)
    assert.equal(await ana.page.locator('.author-button.is-edited .author-mark').count(), 1)
    assert.equal(await ana.page.locator('.author-button.is-person .author-mark').count(), 0)
    const markShapes = await ana.page.evaluate(() =>
      ['is-agent', 'is-edited'].map(
        (kind) =>
          (globalThis as any).getComputedStyle(
            (globalThis as any).document.querySelector(`.author-button.${kind} .author-mark`),
          ).borderRadius,
      ),
    )
    assert.notEqual(markShapes[0], markShapes[1])

    // Time and state show once per run, on its last note; every note still names author and time.
    assert.equal(await ana.page.locator(`[data-note-id="${first.id}"] .note-meta`).count(), 0)
    assert.equal(await ana.page.locator(`[data-note-id="${second.id}"] .note-meta`).count(), 1)
    assert.ok(await ana.page.locator(`[data-note-id="${first.id}"] .bubble`).getAttribute('title'))
    assert.equal(await ana.page.locator('.note.is-mine .state-mark').count(), 1)
    await ana.page.waitForSelector(
      '.note.is-mine .state-mark[data-state="delivered"][aria-label="Delivered"]',
    )
    const spokenIn = (id: string) =>
      ana.page.locator(`[data-note-id="${id}"] .note-column > .visually-hidden`).allInnerTexts()
    const leading = await spokenIn(first.id)
    assert.equal(leading.length, 1)
    assert.match(leading[0] ?? '', /^Sent /)
    assert.equal(
      await ana.page.locator(`[data-note-id="${first.id}"] .author-button`).getAttribute('aria-label'),
      'Who wrote this note: Written by Ben’s agent',
    )
    const following = await spokenIn(second.id)
    assert.equal(following[0], 'Written by Ben’s agent')
    assert.match(following[1] ?? '', /^Sent /)
    assert.equal(
      await ana.page.locator(`[data-note-id="${edited.id}"] .author-button`).getAttribute('aria-label'),
      'Who wrote this note: Written by Ben’s agent, edited by Ben',
    )
    assert.equal(
      await ana.page.locator(`[data-note-id="${byHand.id}"] .author-button`).getAttribute('aria-label'),
      'Who wrote this note: Written by Ben',
    )
    await capture(ana.page, 'grouped-thread-wide-light')

    // -- Hover: opens after a pause, stays while the pointer is on the details, closes after leaving ----
    const agentButton = ana.page.locator(`[data-note-id="${first.id}"] .author-button`)
    await agentButton.hover()
    await ana.page.waitForSelector(OPEN)
    const details = ana.page.locator(OPEN)
    assert.deepEqual(await details.locator('p').allInnerTexts(), [
      'Written by Ben’s agent',
      'Model: claude-opus-5-5',
      'Written with: Claude Code 2.1.327',
      'Connection: Ben desk',
      'The agent reported its model and program.',
      (await details.locator('.author-sent').innerText()) as string,
    ])
    await capture(ana.page, 'author-details-on-hover')
    await details.hover()
    await ana.page.waitForTimeout(700)
    assert.equal(await ana.page.locator(OPEN).count(), 1)
    await ana.page.mouse.move(5, 790)
    await ana.page.waitForSelector(OPEN, { state: 'detached' })

    // A click after the hover opened them keeps the details open, and leaving no longer closes them.
    await agentButton.hover()
    await ana.page.waitForSelector(OPEN)
    await agentButton.click()
    await ana.page.mouse.move(5, 790)
    await ana.page.waitForTimeout(700)
    assert.equal(await ana.page.locator(OPEN).count(), 1)
    await ana.page.keyboard.press('Escape')
    await ana.page.waitForSelector(OPEN, { state: 'detached' })

    // -- Keyboard: focus and Enter open, Escape closes ------------------------------------------------------
    const editedButton = ana.page.locator(`[data-note-id="${edited.id}"] .author-button`)
    await editedButton.focus()
    await ana.page.keyboard.press('Enter')
    await ana.page.waitForSelector(`${OPEN}:has-text("edited by Ben")`)
    await ana.page.waitForSelector(`${OPEN}:has-text("Model: not stated")`)
    await ana.page.keyboard.press('Escape')
    await ana.page.waitForSelector(OPEN, { state: 'detached' })
    const personButton = ana.page.locator(`[data-note-id="${byHand.id}"] .author-button`)
    await personButton.focus()
    await ana.page.keyboard.press('Enter')
    await ana.page.waitForSelector(`${OPEN}:has-text("Written by Ben")`)
    assert.equal(await ana.page.locator(`${OPEN}:has-text("Model")`).count(), 0)
    await ana.page.keyboard.press('Escape')

    // The toolbar with Reply and ⋯ waits for hover or focus.
    const actions = ana.page.locator(`[data-note-id="${byHand.id}"] .note-toolbar`)
    await ana.page.locator('.thread-scroll').focus()
    await ana.page.mouse.move(5, 790)
    assert.equal(
      await actions.evaluate((element: any) => (globalThis as any).getComputedStyle(element).opacity),
      '0',
    )
    await ana.page.locator(`[data-note-id="${byHand.id}"] .bubble`).hover()
    await ana.page.waitForFunction(
      (id: string) =>
        (globalThis as any).getComputedStyle(
          (globalThis as any).document.querySelector(`[data-note-id="${id}"] .note-toolbar`),
        ).opacity === '1',
      byHand.id,
    )

    // -- Dark and narrow ----------------------------------------------------------------------------------------
    await ana.page.emulateMedia({ colorScheme: 'dark' })
    await ana.page.mouse.move(5, 790)
    await capture(ana.page, 'grouped-thread-wide-dark')
    await ana.page.setViewportSize(NARROW)
    assert.equal(await overflowsSideways(ana.page), false)
    await capture(ana.page, 'grouped-thread-narrow-dark')
    await ana.page.emulateMedia({ colorScheme: 'light' })
    await capture(ana.page, 'grouped-thread-narrow-light')

    // -- Touch: no toolbar over the text; a tap marks the note, a long press opens its menu as a sheet ---------
    const phone: Person = await newPage(browser, base, 'en-US', {
      viewport: NARROW,
      hasTouch: true,
      isMobile: true,
    })
    await submitDevelopmentLogin(phone.page, 'ana@example.com', 'Ana')
    await phone.page.waitForSelector('.app')
    await phone.page.goto(`${base}/#/c/${conversation}`)
    await phone.page.waitForSelector('.note.is-theirs.is-person')
    const tapActions = phone.page.locator(`[data-note-id="${second.id}"] .note-toolbar`)
    const display = () =>
      tapActions.evaluate((element: any) => (globalThis as any).getComputedStyle(element).display)
    await phone.page.locator(`[data-note-id="${second.id}"] .note-body`).tap()
    await phone.page.waitForSelector(`[data-note-id="${second.id}"].is-active`)
    assert.equal(await display(), 'none')
    const body = await phone.page.locator(`[data-note-id="${second.id}"] .note-body`).boundingBox()
    const touch = await phone.context.newCDPSession(phone.page)
    const point = { x: body!.x + 10, y: body!.y + 5 }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    await phone.page.waitForSelector(`[data-note-id="${second.id}"] .note-menu:popover-open`)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const sheet = await phone.page
      .locator(`[data-note-id="${second.id}"] .note-menu`)
      .evaluate((menu: any) => menu.getBoundingClientRect().toJSON())
    assert.deepEqual([sheet.left, Math.round(sheet.bottom)], [0, NARROW.height])
    await capture(phone.page, 'note-menu-sheet-on-long-press-narrow')
    await phone.page.getByRole('menuitem', { name: 'Reply', exact: true }).tap()
    await phone.page.waitForSelector('.reply-chip')
    await phone.page.locator(`[data-note-id="${byHand.id}"] .note-body`).tap()
    await phone.page.waitForSelector(`[data-note-id="${byHand.id}"].is-active`)
    assert.equal(await phone.page.locator('.note.is-active').count(), 1)
    await phone.page.locator(`[data-note-id="${first.id}"] .author-button`).tap()
    await phone.page.waitForSelector(`${OPEN}:has-text("Model: claude-opus-5-5")`)
    assert.equal(await overflowsSideways(phone.page), false)
    await capture(phone.page, 'author-details-on-tap-narrow')
    await phone.page.locator('.thread-head h1').tap()
    await phone.page.waitForSelector(OPEN, { state: 'detached' })
    await phone.context.close()

    // -- Korean -------------------------------------------------------------------------------------------------
    const korean: Person = await newPage(browser, base, 'ko-KR')
    await submitDevelopmentLogin(korean.page, 'ana@example.com', 'Ana')
    await korean.page.waitForSelector('.app')
    await korean.page.goto(`${base}/#/c/${conversation}`)
    await korean.page.waitForSelector('.note.is-theirs.is-person')
    assert.deepEqual(await clippedText(korean.page), [])
    await korean.page.locator(`[data-note-id="${first.id}"] .author-button`).focus()
    await korean.page.keyboard.press('Enter')
    await korean.page.waitForSelector(`${OPEN}:has-text("Ben 님의 에이전트가 작성")`)
    await korean.page.waitForSelector(`${OPEN}:has-text("모델과 프로그램은 에이전트가 알려 준 정보예요.")`)
    await capture(korean.page, 'korean-wide-light')
    await korean.page.keyboard.press('Escape')
    await korean.page.locator('.thread-scroll').focus()
    await korean.page.emulateMedia({ colorScheme: 'dark' })
    await korean.page.setViewportSize(NARROW)
    assert.equal(await overflowsSideways(korean.page), false)
    await capture(korean.page, 'korean-narrow-dark')
    await korean.context.close()

    // -- An administrator turns note details off: only the authorship line remains, and draft requests go ------
    const settings = await api(ana, 'GET', '/admin/settings')
    await api(ana, 'PUT', '/admin/settings', {
      ...settings,
      features: { ...settings.features, noteDetails: false, draftRequests: false },
    })
    await ana.page.setViewportSize({ width: 1200, height: 800 })
    await ana.page.reload()
    await ana.page.waitForSelector('.note.is-theirs.is-person')
    await ana.page.locator(`[data-note-id="${first.id}"] .author-button`).focus()
    await ana.page.keyboard.press('Enter')
    await ana.page.waitForSelector(OPEN)
    assert.deepEqual(await ana.page.locator(`${OPEN} p`).allInnerTexts(), ['Written by Ben’s agent'])
    assert.equal(await ana.page.locator('.author-button.is-agent .author-mark').count(), 1)
    await capture(ana.page, 'note-details-turned-off')
    assert.equal(
      await ana.page.locator('.ask-reply').count(),
      await ana.page.locator('.ask-reply:disabled').count(),
    )
    assert.equal(await ana.page.locator('.ask-agent-toggle').count(), 0)
    assert.equal(
      await ana.page.locator('.composer .agent-ask, details:has-text("Let my agent write it")').count(),
      0,
    )
    assert.equal(await ana.page.locator('.note-reply').count(), await ana.page.locator('.note').count())
    await ana.page.keyboard.press('Escape')
    await api(ana, 'PUT', '/admin/settings', {
      ...settings,
      features: { ...settings.features, noteDetails: true, draftRequests: true },
    })
  } finally {
    await browser.close()
    await dovecote.stop()
  }
}

await scenario()
process.stdout.write(`thread e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
