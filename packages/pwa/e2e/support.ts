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
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: VIEWPORT,
    colorScheme: 'light',
    locale,
    ...options,
  })
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
  await api(person, 'POST', `/drafts/${created.id}/send`, {})
}

export const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
})

export const startDeviceFlow = async (base: string, clientName: string, scope: string): Promise<any> =>
  (await fetch(`${base}/oauth/device_authorization`, form({ client_name: clientName, scope }))).json()

export const connectAgent = async (base: string, owner: Person, name: string, approveButton: boolean) => {
  const started = await startDeviceFlow(base, name, approveButton ? 'notes approve' : 'notes')
  await api(owner, 'POST', `/device/${started.user_code}`, {
    approve: true,
    name,
    allowApproval: approveButton,
  })
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

export const clippedText = (page: any): Promise<string[]> =>
  page.evaluate(() => {
    const { document, getComputedStyle } = globalThis as any
    const clipped: string[] = []
    for (const element of document.querySelectorAll('body *')) {
      if (element.closest('.visually-hidden, [hidden], dialog:not([open])')) continue
      const style = getComputedStyle(element)
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

export const startDovecote = async (port: number, databasePath: string, approveButton: 'on' | 'off') => {
  const config = loadConfig({
    HB_PUBLIC_URL: `http://localhost:${port}`,
    HB_PORT: String(port),
    HB_DEV_LOGIN: '1',
    HB_ALLOWED_DOMAINS: 'example.com',
    HB_OAUTH_REDIRECT_HOSTS: 'client.example',
    HB_DATABASE_URL: `sqlite:${databasePath}`,
    HB_APPROVE_BUTTON: approveButton,
    HB_WEB_DIR: join(here, '..', 'dist'),
  })
  if (config._tag === 'Err') throw new Error(config.error.join('; '))
  const database = await openDatabase(config.value.databaseUrl)
  const { env, background } = buildRuntime({ config: config.value, database, log: () => {} })
  await T.runPromise(prepareDatabase, env)
  const work = T.runFork(background, env)
  const server = await startServer(env, port)
  let stopped = false
  return {
    stop: async (): Promise<void> => {
      if (stopped) return
      stopped = true
      await server.close()
      await work.interrupt()
      await database.close()
    },
  }
}
