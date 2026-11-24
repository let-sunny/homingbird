import { strict as assert } from 'node:assert'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type Person,
  api,
  freePort,
  newPage,
  overflowsSideways,
  signInWith,
  startDovecote,
  submitDevelopmentLogin,
} from './support.ts'

const screenshots = process.env.HB_E2E_SCREENSHOTS_NEW_MESSAGE ?? join(tmpdir(), 'homingbird-e2e-new-message')
const { chromium } = createRequire(import.meta.url)('playwright')

const WIDE = { width: 1280, height: 800 }
const PHONE = { width: 375, height: 812 }

/**
 * From the list to a note sent to two people with the keyboard alone, wide and on a phone: New note
 * in the head of DN, a name typed and Enter, twice, then the note and Enter. A key pressed while an input method
 * composes adds nobody, and a screen left before sending leaves no room behind.
 */
const scenario = async (): Promise<void> => {
  const port = await freePort()
  const base = `http://localhost:${port}`
  await rm(screenshots, { recursive: true, force: true })
  await mkdir(screenshots, { recursive: true })
  const dovecote = await startDovecote(port, join(tmpdir(), `homingbird-e2e-new-message-${port}.sqlite`))
  const browser = await chromium.launch()
  const signIn = signInWith(browser, base)
  try {
    const ben = await signIn('ben@example.com', 'Ben')
    const cy = await signIn('cy@example.com', 'Cy')
    await signIn('ana@example.com', 'Ana')

    for (const [name, viewport] of [
      ['wide', WIDE],
      ['phone', PHONE],
    ] as const) {
      const ana: Person = await newPage(browser, base, 'en-US', { viewport })
      await submitDevelopmentLogin(ana.page, 'ana@example.com', 'Ana')
      await ana.page.waitForSelector('.app .sidebar')
      await ana.page.waitForSelector('.sidebar-list-head .new-message-link[aria-label="New note"]')
      await ana.page.waitForSelector('.sidebar .section-actions .new-channel-link[aria-label="New channel"]')
      assert.equal(
        await ana.page.locator('.sidebar-list-head .new-channel-link').count(),
        0,
        `${name}: DN starts no channel`,
      )

      // -- New note, with the keyboard alone ------------------------------------------------------
      await tabTo(ana.page, '.new-message-link')
      assert.equal(
        await focusedClass(ana.page),
        'section-add new-message-link',
        `${name}: New note has the focus`,
      )
      await ana.page.waitForTimeout(400)
      await ana.page.screenshot({ path: join(screenshots, `${name}-1-list.png`) })
      await ana.page.keyboard.press('Enter')
      await ana.page.waitForFunction(() => (globalThis as any).location.hash === '#/new')
      await ana.page.waitForFunction(
        () => (globalThis as any).document.activeElement?.id === 'new-to-field',
        undefined,
        { timeout: 5000 },
      )

      // -- Two people chosen by typing; composing a word adds nobody ----------------------------------
      await ana.page.keyboard.type('Be')
      await ana.page.waitForSelector('.people-picker-option.is-active:has-text("Ben")')
      await ana.page.keyboard.press('Enter')
      await ana.page.waitForSelector('.people-picker-chip:has-text("Ben")')
      await ana.page.keyboard.type('cy@')
      await ana.page.evaluate(() => {
        const field = (globalThis as any).document.activeElement
        field.dispatchEvent(
          new (globalThis as any).KeyboardEvent('keydown', {
            key: 'Enter',
            isComposing: true,
            bubbles: true,
            cancelable: true,
          }),
        )
      })
      assert.equal(await ana.page.locator('.people-picker-chip').count(), 1, `${name}: composing adds nobody`)
      await ana.page.keyboard.press('Enter')
      await ana.page.waitForSelector('.people-picker-chip:has-text("Cy")')
      await ana.page.waitForSelector('.new-message-readers:has-text("Ben and Cy will read this note")')
      await ana.page.waitForTimeout(400)
      await ana.page.screenshot({ path: join(screenshots, `${name}-2-two-chosen.png`) })
      if (name === 'phone')
        assert.equal(await overflowsSideways(ana.page), false, 'phone: nothing scrolls sideways')

      // -- Leaving before sending makes nothing -------------------------------------------------------
      if (name === 'wide') {
        await ana.page.goto(`${base}/#/`)
        await ana.page.waitForSelector('.no-conversations')
        const { conversations } = await api(ana, 'GET', '/conversations')
        assert.equal(conversations.length, 0, 'a screen left before sending leaves no room')
        await ana.context.close()
        continue
      }

      // -- The note, sent with Enter, opens the group it started --------------------------------------
      await ana.page.keyboard.press('Tab')
      assert.equal(await focusedName(ana.page), 'body', 'Tab moves from To to the note')
      const send = await ana.page.locator('.new-message button.send').boundingBox()
      assert.ok(send !== null && send.y + send.height <= viewport.height, 'phone: Send is on the screen')
      await ana.page.keyboard.type('Can you two check the release notes?')
      await ana.page.keyboard.press('Enter')
      await ana.page.waitForFunction(() => (globalThis as any).location.hash.startsWith('#/c/'))
      await ana.page.waitForSelector('.note:has-text("Can you two check the release notes?")')
      await ana.page.waitForTimeout(400)
      await ana.page.screenshot({ path: join(screenshots, `${name}-3-sent.png`) })
      const { conversations } = await api(ana, 'GET', '/conversations')
      assert.equal(conversations.length, 1, 'the send made one group')
      assert.equal(conversations[0].participantIds.length, 3, 'the group holds Ana, Ben and Cy')
      for (const reader of [ben, cy]) {
        const theirs = await api(reader, 'GET', '/conversations')
        assert.equal(theirs.conversations.length, 1, `${reader.name} sees the group once its note is sent`)
      }
      await ana.context.close()
    }
  } finally {
    await browser.close()
    await dovecote.stop()
  }
}

/** Presses Tab until the element matching `selector` has the focus. */
const tabTo = async (page: any, selector: string): Promise<void> => {
  for (let presses = 0; presses < 60; presses++) {
    if (
      await page.evaluate(
        (wanted: string) => (globalThis as any).document.activeElement?.matches(wanted),
        selector,
      )
    )
      return
    await page.keyboard.press('Tab')
  }
  throw new Error(`Tab never reached ${selector}`)
}

const focusedClass = (page: any): Promise<string> =>
  page.evaluate(() => (globalThis as any).document.activeElement?.className ?? '')

const focusedName = (page: any): Promise<string> =>
  page.evaluate(() => (globalThis as any).document.activeElement?.getAttribute('name') ?? '')

await scenario()
process.stdout.write(`new-message e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
