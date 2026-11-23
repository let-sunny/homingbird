import { strict as assert } from 'node:assert'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freePort, overflowsSideways, screenshotCounter, signInWith, startDovecote } from './support.ts'

const screenshots = process.env.HB_E2E_SCREENSHOTS_FLOCK_FORM ?? join(tmpdir(), 'homingbird-e2e-flock-form')
const { chromium } = createRequire(import.meta.url)('playwright')

/**
 * The form to open a flock shows the form of the kind chosen and no other: choosing "Schedule a meeting"
 * hides the debate form, with its own button to open, and choosing a debate brings it back.
 */
const scenario = async (): Promise<void> => {
  const port = await freePort()
  const base = `http://localhost:${port}`
  await rm(screenshots, { recursive: true, force: true })
  await mkdir(screenshots, { recursive: true })
  const dovecote = await startDovecote(port, join(tmpdir(), `homingbird-e2e-flock-form-${port}.sqlite`))
  const browser = await chromium.launch()
  const { capture } = screenshotCounter(screenshots)
  try {
    const ana = await signInWith(browser, base)('ana@example.com', 'Ana')
    await ana.page.goto(`${base}/#/debates`)
    await ana.page.click('button.new-flock-button')
    await ana.page.waitForSelector('dialog[open] .create-debate')
    const visible = async (selector: string): Promise<number> =>
      ana.page
        .locator(`dialog[open] ${selector}`)
        .evaluateAll(
          (elements: Array<{ getBoundingClientRect(): { width: number; height: number } }>) =>
            elements.filter((one) => one.getBoundingClientRect().height > 0).length,
        )
    const forms = async (): Promise<[number, number]> => [
      await visible('.create-debate'),
      await visible('.scheduling-form'),
    ]
    assert.deepEqual(await forms(), [1, 0], 'a debate is the first kind')
    assert.equal(await visible('button[type="submit"]'), 1, 'one button to open the debate')
    await capture(ana.page, 'debate-chosen')

    await ana.page.check('dialog[open] input[name="roomType"][value="scheduling"]')
    assert.deepEqual(await forms(), [0, 1], 'only the meeting form shows once a meeting is chosen')
    assert.equal(await visible('button[type="submit"]'), 1, 'one button to open the meeting')
    await capture(ana.page, 'meeting-chosen')

    await ana.page.check('dialog[open] input[name="roomType"][value="debate"]')
    assert.deepEqual(await forms(), [1, 0], 'only the debate form shows again')
    assert.equal(await overflowsSideways(ana.page), false, 'the form scrolls sideways')
  } finally {
    await browser.close()
    await dovecote.stop()
  }
}

await scenario()
process.stdout.write(`flock form e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
