import { strict as assert } from 'node:assert'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freePort, signInWith, startDovecote } from './support.ts'

const screenshots = process.env.HB_E2E_SCREENSHOTS_HINTS ?? join(tmpdir(), 'homingbird-e2e-hints')
const { chromium } = createRequire(import.meta.url)('playwright')

const openHints = (): string[] =>
  [...(globalThis as any).document.querySelectorAll('.hint-tip')]
    .filter((hint: any) => hint.matches(':popover-open'))
    .map((hint: any) => hint.textContent)

/**
 * A new person who rests the mouse on a control of a concept other messengers lack sees its hint, and
 * the hint is gone once the mouse leaves: the My agent tab and the activity bell, in English.
 */
const scenario = async (): Promise<void> => {
  const port = await freePort()
  await rm(screenshots, { recursive: true, force: true })
  await mkdir(screenshots, { recursive: true })
  const dovecote = await startDovecote(port, join(tmpdir(), `homingbird-e2e-hints-${port}.sqlite`))
  const browser = await chromium.launch()
  try {
    const ana = await signInWith(browser, `http://localhost:${port}`)('ana@example.com', 'Ana')
    for (const selector of ['a.tab[href="#/agent"]', '.activity-bell', '.new-message-link']) {
      await ana.page.mouse.move(0, 0)
      await ana.page.hover(selector)
      await ana.page.waitForFunction(
        () => (globalThis as any).document.querySelectorAll('.hint-tip:popover-open').length === 1,
      )
      const [shown] = await ana.page.evaluate(openHints)
      assert.ok(shown.length > 10, `${selector} shows a sentence on hover`)
      await ana.page.screenshot({ path: join(screenshots, `${selector.replace(/\W+/g, '-')}.png`) })
      await ana.page.mouse.move(0, 0)
      await ana.page.waitForFunction(
        () => (globalThis as any).document.querySelectorAll('.hint-tip:popover-open').length === 0,
      )
    }
    await ana.context.close()
  } finally {
    await browser.close()
    await dovecote.stop()
  }
}

await scenario()
process.stdout.write(`hints e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
