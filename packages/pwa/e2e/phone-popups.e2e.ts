import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freePort } from './support.ts'

const { chromium } = createRequire(import.meta.url)('playwright')

/**
 * The popups a phone opens, at 375 pixels: each stays inside the screen and keeps clear of the control it
 * explains, of the tab bar and of the primary action. It needs no server, only `pnpm build:demo`.
 */
const scenario = async (): Promise<void> => {
  const port = await freePort()
  const site = await servedSite(port)
  const browser = await chromium.launch()
  const problems: string[] = []
  try {
    for (const language of ['en', 'ko'])
      for (const theme of ['light', 'dark']) {
        const label = `${language}-${theme}`
        problems.push(...(await tourProblems(browser, port, language, theme, label)))
        for (const popup of POPUPS)
          problems.push(...(await popupProblems(browser, port, language, theme, popup, label)))
      }
  } finally {
    await browser.close()
    site.close()
  }
  assert.deepEqual(problems, [], `popups misbehave on a phone:\n${problems.join('\n')}`)
}

const tourProblems = async (
  browser: any,
  port: number,
  language: string,
  theme: string,
  label: string,
): Promise<string[]> => {
  const page = await phonePage(browser, port, language, theme, false)
  const problems: string[] = []
  for (let step = 0; step < 6; step++) {
    await page.waitForSelector('.tour:popover-open')
    await page.waitForTimeout(300)
    const found = await page.evaluate(measureTour)
    problems.push(...found.map((problem: string) => `${label} tour step ${step + 1}: ${problem}`))
    await page.locator('.tour-next').click({ timeout: 2000 })
  }
  assert.equal(await page.locator('.tour').count(), 0, `${label}: the tour does not end`)
  await page.context().close()
  return problems
}

const popupProblems = async (
  browser: any,
  port: number,
  language: string,
  theme: string,
  popup: Popup,
  label: string,
): Promise<string[]> => {
  const page = await phonePage(browser, port, language, theme, true, popup.route)
  const invoker = page.locator(popup.invoker).first()
  await invoker.click({ timeout: 2000 })
  await page.waitForSelector(popup.shown, { timeout: 2000 })
  await page.waitForTimeout(400)
  const found: string[] = await page.evaluate(measurePopup, popup)
  await page.keyboard.press('Escape')
  await page.context().close()
  return found.map((problem) => `${label} ${popup.name}: ${problem}`)
}

const phonePage = async (
  browser: any,
  port: number,
  language: string,
  theme: string,
  tourSeen: boolean,
  route = '#/',
): Promise<any> => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    timezoneId: 'UTC',
    locale: language,
    colorScheme: theme,
  })
  if (tourSeen)
    await context.addInitScript(() => (globalThis as any).localStorage.setItem('homingbird.tour', 'seen'))
  const page = await context.newPage()
  await page.goto(
    `http://localhost:${port}/demo/?at=2026-11-21T09:00:00Z&lang=${language}&theme=${theme}${route}`,
  )
  await page.waitForSelector('.app')
  await page.waitForTimeout(700)
  return page
}

interface Popup {
  readonly name: string
  readonly route: string
  readonly invoker: string
  readonly shown: string
  readonly primary: string | null
  /** Whether the popup floats beside its invoker, so must not cover it; a sheet may. */
  readonly clearOfInvoker: boolean
}

const POPUPS: ReadonlyArray<Popup> = [
  {
    name: 'account menu',
    route: '#/',
    invoker: '.user-button',
    shown: '.menu:popover-open',
    primary: null,
    clearOfInvoker: true,
  },
  {
    name: 'activity panel',
    route: '#/',
    invoker: '.activity-bell',
    shown: '.activity-panel:popover-open',
    primary: null,
    clearOfInvoker: false,
  },
  {
    name: 'new channel dialog',
    route: '#/',
    invoker: '.new-channel-link',
    shown: 'dialog[open]',
    primary: '.dialog-actions .primary, button.primary',
    clearOfInvoker: false,
  },
  {
    name: 'profile card',
    route: '#/people',
    invoker: '.person-face-button',
    shown: '#profile-card:popover-open',
    primary: '.primary',
    clearOfInvoker: false,
  },
]

/** Runs in the page. */
const measureTour = (): string[] => {
  const { document, innerWidth, innerHeight } = globalThis as any
  const tour = document.querySelector('.tour')
  const box = tour.getBoundingClientRect()
  const problems: string[] = []
  if (box.left < 0 || box.right > innerWidth || box.top < 0 || box.bottom > innerHeight)
    problems.push(`leaves the screen (${[box.left, box.top, box.right, box.bottom].map(Math.round)})`)
  const bar = document.querySelector('.tabs-host')?.getBoundingClientRect()
  if (bar && box.bottom > bar.top + 0.5) problems.push('covers the tab bar')
  const target = document.querySelector('.tour-target')?.getBoundingClientRect()
  const small = target && target.height < innerHeight * 0.4
  if (
    small &&
    target.left < box.right &&
    box.left < target.right &&
    target.top < box.bottom &&
    box.top < target.bottom
  )
    problems.push('covers the control it explains')
  const next = tour.querySelector('.tour-next').getBoundingClientRect()
  const hit = document.elementFromPoint(next.left + next.width / 2, next.top + next.height / 2)
  if (!tour.contains(hit)) problems.push('Next cannot be tapped')
  return problems
}

/** Runs in the page. */
const measurePopup = (popup: Popup): string[] => {
  const { document, innerWidth, innerHeight } = globalThis as any
  const shown = document.querySelector(popup.shown)
  const box = shown.getBoundingClientRect()
  const problems: string[] = []
  if (box.left < -0.5 || box.right > innerWidth + 0.5 || box.top < -0.5 || box.bottom > innerHeight + 0.5)
    problems.push(`leaves the screen (${[box.left, box.top, box.right, box.bottom].map(Math.round)})`)
  if (popup.primary !== null) {
    const primary = shown.querySelector(popup.primary)
    if (primary !== null) {
      const at = primary.getBoundingClientRect()
      const hit = document.elementFromPoint(
        at.left + at.width / 2,
        Math.min(at.top + at.height / 2, innerHeight - 1),
      )
      if (!primary.contains(hit)) problems.push('its primary action is covered or out of reach')
    }
  }
  const invoker = document.querySelector(popup.invoker)?.getBoundingClientRect()
  if (
    popup.clearOfInvoker &&
    invoker &&
    invoker.left < box.right &&
    box.left < invoker.right &&
    invoker.top < box.bottom &&
    box.top < invoker.bottom
  )
    problems.push('covers the control that opened it')
  if (
    !shown.matches('dialog') &&
    shown.querySelector('button, a') === null &&
    !shown.matches('[popover=auto]')
  )
    problems.push('cannot be dismissed')
  return problems
}

const servedSite = async (port: number): Promise<{ close: () => void }> => {
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname))
    const file = join(SITE, path.endsWith('/') ? `${path}index.html` : path)
    if (!file.startsWith(SITE)) return response.writeHead(403).end()
    readFile(file).then(
      (body) =>
        response
          .writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
          .end(body),
      () => response.writeHead(404).end(),
    )
  })
  await new Promise<void>((resolve) => server.listen(port, resolve))
  return { close: () => server.close() }
}

const SITE = fileURLToPath(new URL('../../../site-dist', import.meta.url))
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
}

await scenario()
