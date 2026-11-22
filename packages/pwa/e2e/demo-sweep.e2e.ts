import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { mkdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  KEY_CONTROLS,
  VIEWPORT,
  clippedText,
  contrastProblems,
  crowdedFields,
  freePort,
  overflowsSideways,
  pastTheRightEdge,
} from './support.ts'

const { chromium } = createRequire(import.meta.url)('playwright')

/**
 * Every screen the demo reaches, found by following its links from the start page, at three widths,
 * light and dark, in English and Korean: none may scroll sideways, reach past the right edge, clip
 * its text, fail a contrast check or raise an error. It needs no server, only `pnpm build:demo`.
 */
const scenario = async (): Promise<void> => {
  const port = await freePort()
  const site = await servedSite(port)
  const browser = await chromium.launch()
  const problems: string[] = []
  await rm(SCREENSHOTS, { recursive: true, force: true })
  await mkdir(SCREENSHOTS, { recursive: true })
  try {
    const routes = await reachableRoutes(browser, port)
    assert.ok(routes.length >= 25, `the demo reaches only ${routes.length} routes: ${routes.join(' ')}`)
    for (const language of LANGUAGES)
      for (const theme of THEMES)
        for (const width of WIDTHS) {
          const context = await browser.newContext({
            viewport: width.viewport,
            timezoneId: 'UTC',
            locale: language,
          })
          await context.addInitScript(() =>
            (globalThis as any).localStorage.setItem('homingbird.tour', 'seen'),
          )
          const page = await context.newPage()
          const errors: string[] = []
          page.on('pageerror', (error: Error) => errors.push(error.message))
          page.on('console', (message: any) => message.type() === 'error' && errors.push(message.text()))
          for (const route of routes) {
            const label = `${language}-${theme}-${width.name}-${nameOf(route)}`
            await page.goto(demoUrl(port, language, theme, route))
            await page.waitForSelector('.app')
            await settled(page)
            const found = await problemsOn(page, width.name)
            if (await page.locator('.notice.is-error, [role=alert].is-error').count())
              found.push('shows an error notice')
            found.push(...errors.splice(0).map((error) => `error: ${error}`))
            problems.push(...found.map((problem) => `${label}: ${problem}`))
            if (width.photographed)
              await page.screenshot({ path: join(SCREENSHOTS, `${label}.png`), fullPage: true })
          }
          await context.close()
        }
  } finally {
    await browser.close()
    site.close()
  }
  console.log(`Screenshots: ${SCREENSHOTS}`)
  assert.deepEqual(problems, [], `the demo sweep found ${problems.length} problems:\n${problems.join('\n')}`)
}

const problemsOn = async (page: any, width: string): Promise<string[]> => {
  const found: string[] = []
  for (const problem of await contrastProblems(page, CONTROLS))
    found.push(`${problem.what} contrast ${problem.ratio}:1, needs ${problem.needed}:1`)
  if (width === 'wide') return found
  if (await overflowsSideways(page)) found.push('scrolls sideways')
  const past = await pastTheRightEdge(page)
  if (past.length > 0) found.push(`reaches past the right edge: ${past.join(', ')}`)
  for (const field of await crowdedFields(page)) found.push(`crowds ${field}`)
  for (const text of await clippedText(page)) found.push(`clips ${text}`)
  return found
}

/** The start page's links, followed breadth first, and the sections and searches no link names. */
const reachableRoutes = async (browser: any, port: number): Promise<string[]> => {
  const context = await browser.newContext({ viewport: VIEWPORT, timezoneId: 'UTC' })
  await context.addInitScript(() => (globalThis as any).localStorage.setItem('homingbird.tour', 'seen'))
  const page = await context.newPage()
  const seen = new Set<string>(EXTRA_ROUTES)
  const queue = ['#/', ...EXTRA_ROUTES]
  seen.add('#/')
  while (queue.length > 0 && seen.size < MAX_ROUTES) {
    const route = queue.shift()!
    await page.goto(demoUrl(port, 'en', 'light', route))
    await page.waitForSelector('.app')
    await settled(page)
    const links: string[] = await page.$$eval('a[href^="#/"]', (anchors: any[]) =>
      anchors.map((anchor) => anchor.getAttribute('href')),
    )
    for (const link of links)
      if (!seen.has(link) && !SKIPPED.some((skipped) => link.startsWith(skipped))) {
        seen.add(link)
        queue.push(link)
      }
  }
  await context.close()
  return [...seen]
}

const demoUrl = (port: number, language: string, theme: string, route: string): string =>
  `http://localhost:${port}/demo/?at=${FIXED_TIME}&lang=${language}&theme=${theme}${route}`

const nameOf = (route: string): string =>
  route
    .replace(/^#\/?/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '') || 'home'

/** `site-dist` served as Pages serves it, with the demo under `/demo/`. */
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

const settled = async (page: any): Promise<void> => {
  await page.waitForFunction(() => {
    const { document } = globalThis as any
    const transitioning = document
      .getAnimations()
      .some(
        (animation: any) =>
          animation.playState === 'running' &&
          animation.timeline === document.timeline &&
          animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY,
      )
    return document.querySelector('.loading') === null && document.fonts.status === 'loaded' && !transitioning
  })
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        (globalThis as any).requestAnimationFrame(() =>
          (globalThis as any).requestAnimationFrame(() => resolve(undefined)),
        ),
      ),
  )
}

/** A principle's fields are edited in place: they show no edge until hovered or focused, on purpose. */
const CONTROLS = KEY_CONTROLS.map((check) => ({
  ...check,
  selector: check.selector
    .split(',')
    .map((part) => `${part.trim()}:not(.todo-field)`)
    .join(', '),
}))
const SITE = fileURLToPath(new URL('../../../site-dist', import.meta.url))
const SCREENSHOTS = process.env.HB_E2E_SCREENSHOTS_DEMO ?? join(tmpdir(), 'homingbird-demo-sweep')
const FIXED_TIME = '2026-11-21T09:00:00Z'
const LANGUAGES = ['en', 'ko'] as const
const THEMES = ['light', 'dark'] as const
const WIDTHS = [
  { name: 'wide', viewport: VIEWPORT, photographed: true },
  { name: 'narrow', viewport: { width: 390, height: 780 }, photographed: true },
  { name: 'smallest', viewport: { width: 320, height: 640 }, photographed: false },
] as const
const EXTRA_ROUTES = [
  '#/agent/teaching',
  '#/agent/doing',
  '#/channel/billing/agent',
  '#/channel/billing/agent/teach',
  '#/search?q=refund',
  '#/admin/settings',
  '#/admin/members',
  '#/admin/groups',
  '#/admin/channels',
  '#/admin/insights',
]
/** Signing out leaves the demo, and a device or consent page needs a code the demo does not make. */
const SKIPPED = ['#/signed-out']
const MAX_ROUTES = 80
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
