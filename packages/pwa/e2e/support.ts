import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Task as T } from '@homingbird/kernel'
import { loadConfig } from '../../dovecote/src/config.ts'
import { startServer } from '../../dovecote/src/http/node-server.ts'
import { prepareDatabase } from '../../dovecote/src/prepare-database.ts'
import { buildRuntime } from '../../dovecote/src/runtime.ts'
import { openDatabase } from '../../dovecote/src/sql/open.ts'

const here = dirname(fileURLToPath(import.meta.url))

export interface Person {
  readonly name: string
  readonly context: any
  readonly page: any
}

export const VIEWPORT = { width: 1200, height: 800 }

export const newPage = async (
  browser: any,
  base: string,
  locale = 'en-US',
  options: Readonly<Record<string, unknown>> = {},
): Promise<Person> => {
  const { tour = false, ...contextOptions } = options as { tour?: boolean }
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: VIEWPORT,
    colorScheme: 'light',
    locale,
    ...contextOptions,
  })
  if (!tour)
    await context.addInitScript(() => (globalThis as any).localStorage.setItem('homingbird.tour', 'seen'))
  const page = await context.newPage()
  page.on('pageerror', (error: Error) => {
    throw new Error(`page error: ${error.message}`)
  })
  await page.goto(base)
  return { name: '', context, page }
}

export const submitDevelopmentLogin = async (page: any, email: string, name: string): Promise<void> => {
  await page.click('a[href^="/auth/login"]')
  await page.fill('input[name=email]', email)
  await page.fill('input[name=name]', name)
  await page.click('button')
}

export const signInWith =
  (browser: any, base: string) =>
  async (email: string, name: string): Promise<Person> => {
    const person = await newPage(browser, base)
    await submitDevelopmentLogin(person.page, email, name)
    await person.page.waitForSelector('.app')
    return { ...person, name }
  }

export const api = async (person: Person, method: string, path: string, body?: unknown): Promise<any> => {
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

export const sendThroughApi = async (person: Person, draft: object): Promise<void> => {
  const created = await api(person, 'POST', '/drafts', draft)
  await sendDraft(person, created.id)
}

/** Sends a draft the way the web client does: with the text and room the person sees now. */
export const sendDraft = async (person: Person, id: string, body?: string): Promise<any> => {
  const shown = await api(person, 'GET', `/notes/${id}`)
  return api(person, 'POST', `/drafts/${id}/send`, {
    ...(body !== undefined && { body }),
    expected: { body: shown.body, conversationId: shown.conversationId },
  })
}

export const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
})

export const startDeviceFlow = async (base: string, clientName: string, scope: string): Promise<any> =>
  (await fetch(`${base}/oauth/device_authorization`, form({ client_name: clientName, scope }))).json()

export const connectAgent = async (base: string, owner: Person, name: string) => {
  const started = await startDeviceFlow(base, name, 'notes')
  await api(owner, 'POST', `/device/${started.user_code}`, { approve: true, name })
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

export const holdEventStream = (base: string, token: string): AbortController => {
  const held = new AbortController()
  void fetch(`${base}/api/v1/events/stream`, {
    headers: { authorization: `Bearer ${token}` },
    signal: held.signal,
  })
    .then(async (response) => {
      await response.body?.pipeTo(new WritableStream())
    })
    .catch(() => undefined)
  return held
}

export const startAuthorization = async (base: string, clientName: string): Promise<string> => {
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

export const pendingDraftsAre = (count: number): boolean =>
  (globalThis as any).document.querySelectorAll('.pending .draft').length === count

export const overflowsSideways = (page: any): Promise<boolean> =>
  page.evaluate(() => {
    const root = (globalThis as any).document.documentElement
    return root.scrollWidth > root.clientWidth + 1
  })

/**
 * Visible elements whose right edge passes the viewport: each as its tag and classes, the innermost
 * ones only, so the list names the cause rather than everything around it. Content of a container
 * that scrolls sideways on purpose, a wide table or a code block, does not count; a page or list that
 * scrolls up and down does not excuse anything.
 */
export const pastTheRightEdge = (page: any): Promise<string[]> =>
  page.evaluate((SIDEWAYS_ON_PURPOSE: string) => {
    const { document, innerWidth } = globalThis as any
    const past: any[] = []
    for (const element of document.querySelectorAll('body *')) {
      if (element.closest('[hidden], dialog:not([open]), .visually-hidden, [popover]:not(:popover-open)'))
        continue
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0 || box.right <= innerWidth + 1) continue
      const scroller = element.parentElement?.closest(SIDEWAYS_ON_PURPOSE)
      const scrolledOnPurpose = scroller != null && scroller.getBoundingClientRect().right <= innerWidth + 1
      if (!scrolledOnPurpose) past.push(element)
    }
    return past
      .filter((element: any) => !past.some((other: any) => other !== element && element.contains(other)))
      .map((element: any) => `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`)
  }, SIDEWAYS_SCROLLERS)

/** To-do text fields that hide a line, or reach into what follows them: none may. */
export const crowdedFields = (page: any): Promise<string[]> =>
  page.evaluate(() =>
    [...(globalThis as any).document.querySelectorAll('textarea.todo-field')].flatMap((field: any) => {
      const next = field.closest('.todo-main')?.querySelector('.todo-details, .todo-problems:not(:empty)')
      const hides = field.scrollHeight > field.clientHeight + 1
      const reaches =
        next != null && field.getBoundingClientRect().bottom > next.getBoundingClientRect().top + 1
      return hides || reaches ? [`${field.name}: ${field.value.slice(0, 40)}`] : []
    }),
  )

export const clippedText = (page: any): Promise<string[]> =>
  page.evaluate(() => {
    const { document, getComputedStyle } = globalThis as any
    const clipped: string[] = []
    for (const element of document.querySelectorAll('body *')) {
      if (element.closest('.visually-hidden, [hidden], dialog:not([open])')) continue
      const style = getComputedStyle(element)
      const forAssistiveTechnologyOnly =
        style.clipPath === 'inset(50%)' && element.getBoundingClientRect().width <= 1
      if (forAssistiveTechnologyOnly) continue
      const hidesOverflow = style.overflowX !== 'visible' || style.overflowY !== 'visible'
      if (
        !hidesOverflow ||
        style.textOverflow === 'ellipsis' ||
        element.matches(
          'textarea, input, select, pre, .table-scroll, .thread-scroll, .notes, nav, ul, ol, .sidebar, .stage, .page-body, .page, main, .app, .viewport, #app, aside, section, dialog, .window-body, .connect-body',
        )
      )
        continue
      const hasText = [...element.childNodes].some(
        (node: any) => node.nodeType === 3 && node.textContent.trim() !== '',
      )
      if (!hasText) continue
      if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
        clipped.push(
          `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}: ${element.textContent.trim().slice(0, 40)}`,
        )
    }
    const walker = document.createTreeWalker(document.body, 4)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const words = node.textContent.trim().split(/\s+/)
      if (node.parentElement?.closest('.visually-hidden, [hidden], dialog:not([open]), .note-body, .quote'))
        continue
      if (node.parentElement?.checkVisibility() !== true) continue
      for (const word of words) {
        if (word.length < 2 || !/[\uac00-\ud7a3]/.test(word)) continue
        const start = node.textContent.indexOf(word)
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, start + word.length)
        const lines = new Set(
          [...range.getClientRects()]
            .filter((rect: any) => rect.width > 0)
            .map((rect: any) => Math.round(rect.top)),
        )
        if (lines.size > 1) clipped.push(`word broken across lines: ${word}`)
      }
    }
    return clipped
  })

export const screenshotCounter = (directory: string) => {
  let taken = 0
  const nextPath = async (name: string): Promise<string> =>
    join(directory, `${String(++taken).padStart(2, '0')}-${name}.png`)
  return {
    nextPath,
    capture: async (page: any, name: string): Promise<void> => {
      await page.waitForTimeout(350)
      await page.screenshot({ path: await nextPath(name) })
    },
  }
}

export const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const probe = createServer()
    probe.listen(0, () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    })
  })

export const startDovecote = async (
  port: number,
  databasePath: string,
  channels = '',
  themeDirectory?: string,
  features?: string,
) => {
  const config = loadConfig({
    HB_PUBLIC_URL: `http://localhost:${port}`,
    HB_PORT: String(port),
    HB_DEV_LOGIN: '1',
    HB_ALLOWED_DOMAINS: 'example.com',
    HB_OAUTH_REDIRECT_HOSTS: 'client.example',
    HB_DATABASE_URL: `sqlite:${databasePath}`,
    HB_CHANNELS: channels,
    HB_WEB_DIR: join(here, '..', 'dist'),
    ...(themeDirectory !== undefined && { HB_THEME_DIR: themeDirectory }),
    ...(features !== undefined && { HB_FEATURES: features }),
  })
  if (config._tag === 'Err') throw new Error(config.error.join('; '))
  const database = await T.runPromise(openDatabase(config.value.databaseUrl))
  const { env, background } = buildRuntime({ config: config.value, database, write: () => {} })
  await T.runPromise(prepareDatabase, env)
  const work = T.runFork(background, env)
  const server = await T.runPromise(startServer(env, port))
  let stopped = false
  return {
    stop: async (): Promise<void> => {
      if (stopped) return
      stopped = true
      await T.runPromise(server.close)
      await work.interrupt()
      await T.runPromise(database.close)
    },
  }
}

export interface ContrastProblem {
  readonly what: string
  readonly ratio: number
  readonly needed: number
}

export const contrastProblems = (
  page: any,
  checks: ReadonlyArray<{ readonly selector: string; readonly kind: 'text' | 'large-text' | 'boundary' }>,
): Promise<ContrastProblem[]> =>
  withNames(page).then(() =>
    page.evaluate((wanted: typeof checks) => {
      const { document, getComputedStyle } = globalThis as any
      const parse = (value: string): number[] | null => {
        const numbers = value.match(/[\d.]+/g)?.map(Number)
        if (numbers === undefined || numbers.length < 3) return null
        if (value.startsWith('color(srgb'))
          return [numbers[0]! * 255, numbers[1]! * 255, numbers[2]! * 255, numbers[3] ?? 1]
        return [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3] ?? 1]
      }
      const over = (top: number[], bottom: number[]): number[] => {
        const alpha = top[3]!
        return [0, 1, 2].map((i) => top[i]! * alpha + bottom[i]! * (1 - alpha)).concat(1)
      }
      const backgroundOf = (element: any): number[] => {
        const layers: number[][] = []
        for (let current = element; current !== null; current = current.parentElement) {
          const color = parse(getComputedStyle(current).backgroundColor)
          if (color !== null && color[3]! > 0) {
            layers.push(color)
            if (color[3] === 1) break
          }
        }
        return layers.reverse().reduce((below, layer) => over(layer, below), [255, 255, 255, 1])
      }
      const luminance = (rgb: number[]): number => {
        const [r, g, b] = rgb.slice(0, 3).map((channel) => {
          const c = channel / 255
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
      }
      const ratio = (a: number[], b: number[]): number => {
        const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
        return (light! + 0.05) / (dark! + 0.05)
      }
      const problems: Array<{ what: string; ratio: number; needed: number }> = []
      for (const check of wanted)
        for (const element of document.querySelectorAll(check.selector)) {
          if (!element.checkVisibility()) continue
          const style = getComputedStyle(element)
          const behind = backgroundOf(element.parentElement ?? element)
          const own = backgroundOf(element)
          const measured =
            check.kind === 'boundary'
              ? ratio(over(parse(style.borderTopColor) ?? [0, 0, 0, 0], own), behind)
              : ratio(over(parse(style.color)!, own), own)
          const needed = check.kind === 'text' ? 4.5 : 3
          if (measured + 0.01 < needed)
            problems.push({
              what: `${check.selector} “${String(element.textContent).trim().slice(0, 30)}”`,
              ratio: Math.round(measured * 100) / 100,
              needed,
            })
        }
      return problems
    }, checks),
  )

export const KEY_CONTROLS: ReadonlyArray<{
  readonly selector: string
  readonly kind: 'text' | 'large-text' | 'boundary'
}> = [
  {
    selector: 'body p, body small, .field-label, .note-body, .channel-meta span, .thread-profile',
    kind: 'text',
  },
  {
    selector: 'button, .button, .tab, .switch-label, .switch-state, .kind, .origin, .relation',
    kind: 'text',
  },
  { selector: '.agent-light, .human-state, .channel-chip, .private-mark, .archived-mark', kind: 'text' },
  { selector: 'h1, h2, .sidebar-title', kind: 'large-text' },
  {
    selector: 'button:not(.link):not(.icon):not(.switch), .button, input, select, textarea',
    kind: 'boundary',
  },
  { selector: '.switch-track, .switch-thumb', kind: 'boundary' },
]

export const themeColorsOutside = (page: any, allowed: ReadonlyArray<string>): Promise<string[]> =>
  withNames(page).then(() =>
    page.evaluate((palette: ReadonlyArray<string>) => {
      const { document, getComputedStyle } = globalThis as any
      const probe = document.createElement('span')
      document.body.append(probe)
      const normal = (color: string): string => {
        probe.style.color = ''
        probe.style.color = color
        return getComputedStyle(probe).color
      }
      const allowedSet = new Set([...palette.map(normal), 'rgba(0, 0, 0, 0)'])
      const found = new Set<string>()
      for (const element of document.querySelectorAll('body *')) {
        if (element === probe || element.closest('canvas, .pip, img, .character-ground, .visually-hidden'))
          continue
        if (!element.checkVisibility()) continue
        const style = getComputedStyle(element)
        const colors = [style.color, style.backgroundColor, style.borderTopColor, style.borderBottomColor]
        if (style.boxShadow !== 'none') found.add(`${element.className}: box-shadow ${style.boxShadow}`)
        if (!/^none(, none)*$/.test(style.backgroundImage))
          found.add(`${element.className}: background ${style.backgroundImage}`)
        if (style.borderTopLeftRadius !== '0px')
          found.add(`${element.className}: radius ${style.borderTopLeftRadius}`)
        for (const color of colors)
          if (!allowedSet.has(color))
            found.add(`${element.tagName.toLowerCase()}.${element.className}: ${color}`)
      }
      probe.remove()
      return [...found]
    }, allowed),
  )

const SIDEWAYS_SCROLLERS = '.table-scroll, pre, .titlebar .tabs'

const withNames = (page: any): Promise<unknown> =>
  page.evaluate('globalThis.__name = globalThis.__name || ((target) => target)')
