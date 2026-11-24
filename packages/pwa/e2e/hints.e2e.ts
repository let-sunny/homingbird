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

const hoverEach = async (page: any): Promise<void> => {
  for (const selector of ['a.tab[href="#/agent"]', '.activity-bell', '.new-message-link']) {
    await page.mouse.move(0, 0)
    await page.hover(selector)
    await page.waitForFunction(
      () => (globalThis as any).document.querySelectorAll('.hint-tip:popover-open').length === 1,
    )
    const [shown] = await page.evaluate(openHints)
    assert.ok(shown.length > 10, `${selector} shows a sentence on hover`)
    await page.screenshot({ path: join(screenshots, `${selector.replace(/\W+/g, '-')}.png`) })
    await page.mouse.move(0, 0)
    await page.waitForFunction(
      () => (globalThis as any).document.querySelectorAll('.hint-tip:popover-open').length === 0,
    )
  }
}

/**
 * A person who rests the mouse on a control of a concept other messengers lack sees its hint, and
 * the hint is gone once the mouse leaves: the My agent tab, the activity bell and the new message link,
 * for a new profile, and again for one 20 days old that has already clicked a tab.
 */
const scenario = async (): Promise<void> => {
  const port = await freePort()
  await rm(screenshots, { recursive: true, force: true })
  await mkdir(screenshots, { recursive: true })
  const dovecote = await startDovecote(port, join(tmpdir(), `homingbird-e2e-hints-${port}.sqlite`))
  const browser = await chromium.launch()
  try {
    const ana = await signInWith(browser, `http://localhost:${port}`)('ana@example.com', 'Ana')
    await hoverEach(ana.page)
    await ana.page.evaluate(() => {
      const storage = (globalThis as any).localStorage
      for (const key of Object.keys(storage))
        if (key.startsWith('homingbird.hints.'))
          storage.setItem(
            key,
            JSON.stringify({ since: Date.now() - 20 * 86_400_000, used: [], dismissed: [] }),
          )
    })
    await ana.page.reload()
    await ana.page.waitForSelector('.app')
    await ana.page.click('a.tab[href="#/agent"]')
    await hoverEach(ana.page)
    await ana.context.close()
  } finally {
    await browser.close()
    await dovecote.stop()
  }
}

await scenario()
process.stdout.write(`hints e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
