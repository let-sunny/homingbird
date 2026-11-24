import { join } from 'node:path'
import { type Fetch, httpApi } from '@homingbird/client'
import { Task as T, makeTestClock } from '@homingbird/kernel'
import type { Api } from '@homingbird/protocol'
import { allByRole, getByRole, textOf } from '@homingbird/ui/testing'
import { build } from 'esbuild'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app.ts'
import { startInspector } from '../../src/inspector/start.ts'
import { createState } from '../../src/state.ts'
import { useLanguage } from '../../src/strings.ts'
import { invalidate } from '../../src/tasks/resources.ts'
import { settle } from '../support/app.ts'
import { fakePage } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { me } from '../support/fixtures.ts'
import { timelineText } from '../support/timeline.ts'

usingFakeDom()

const SECRET = 'SECRET'

/** A page whose server puts the secret wherever a server can: body, error, header, status text and name. */
const inspectedPage = (answer: (url: string) => Response) => {
  const clock = makeTestClock(0)
  const state = createState('')
  const page = fakePage()
  const makeApi = (fetch: Fetch): Api =>
    httpApi({ serverUrl: `http://${SECRET}.example`, fetch, token: () => SECRET, sendsCookies: true })
  const inspector = startInspector({
    clock,
    state,
    makeApi,
    fetch: (url) => Promise.resolve(answer(url)),
  })
  const app = createApp(
    { clock, api: inspector.api, state, page: page.page, random: { id: () => SECRET, seed: () => 7 } },
    T.unit,
  )
  const asked: string[] = []
  const show = (): HTMLElement => {
    inspector.show(
      app,
      { addToBody: (element) => void document.body.append(element) },
      {
        canAsk: (path) => path === 'debates',
        again: (path) => void asked.push(`again ${path}`),
        invalidate: (path) => void asked.push(`invalidate ${path}`),
        turnOff: () => void asked.push('off'),
      },
    )
    const host = document.querySelector<HTMLElement>('.inspector-host')!
    host.querySelector('details')!.setAttribute('open', '')
    return host
  }
  return { app, state, page, inspector, show, asked, clock }
}

const refusing = (): Response =>
  new Response(JSON.stringify({ error: { code: 'Forbidden', message: SECRET } }), {
    status: 403,
    statusText: SECRET,
    headers: { 'x-secret': SECRET, 'content-type': `text/${SECRET}` },
  })

describe('what the inspector records', () => {
  afterEach(() => vi.restoreAllMocks())

  it('never holds what a person or a server wrote, wherever it was put', async () => {
    const written = (['log', 'info', 'warn', 'error', 'debug', 'trace', 'table'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {}),
    )
    const answers = [
      refusing,
      () => new Response(`<html>${SECRET}</html>`, { status: 502, statusText: SECRET }),
      () => new Response(JSON.stringify({ [SECRET]: SECRET, conversations: [{ id: SECRET }] })),
      () => new Response(JSON.stringify({ error: { code: SECRET, message: SECRET } }), { status: 400 }),
      (): Response => {
        throw Object.assign(new Error(SECRET), { name: SECRET, _tag: SECRET })
      },
    ]
    for (const answer of answers) {
      const { app, state, page, inspector, show } = inspectedPage(answer)
      const panel = show()
      state.session.set({ ...me(), member: { ...me().member, name: SECRET, email: SECRET } })
      state.threads.set(new Map([[SECRET as never, { notes: [{ body: SECRET } as never], hasMore: false }]]))
      state.composerTexts.set(new Map([[SECRET as never, SECRET]]))
      Object.assign(state, { [SECRET]: createState('').debates })
      app.launch(invalidate('conversations', 'debates', 'directory'))
      state.conversations.update(() => [{ id: SECRET, title: SECRET } as never])
      app.launch(
        app.api['drafts.send']({
          params: { id: SECRET },
          query: { [SECRET]: SECRET },
          body: { body: SECRET },
        } as never) as never,
      )
      await T.run(app.api['notes.get']({ params: { id: SECRET } } as never) as T.Task<unknown>)
      void (app.api as unknown as Record<string, unknown>)[SECRET]
      await settle()
      getByRole(panel, 'button', { name: 'Export' }).click()
      const { timeline } = inspector.recording.snapshot()
      expect(timeline.some((entry) => entry.kind === 'request')).toBe(true)
      expect(timeline.some((entry) => entry.kind === 'move')).toBe(true)
      const all = [
        JSON.stringify(inspector.recording.snapshot()),
        timelineText(inspector.recording),
        JSON.stringify(page.downloads),
        textOf(panel),
      ]
      for (const text of all) expect(text).not.toMatch(new RegExp(SECRET, 'i'))
      expect([...page.local, ...page.session]).toEqual([])
    }
    for (const one of written) expect(one).not.toHaveBeenCalled()
  })

  it('is empty once the session ended, and stays so while what ran ends', async () => {
    const { app, state, inspector } = inspectedPage(refusing)
    state.session.set(me())
    app.launch(invalidate('conversations'))
    await settle()
    app.launch(invalidate('conversations', 'debates'))
    expect(inspector.recording.snapshot().timeline.length).toBeGreaterThan(2)
    app.endSession()
    expect(inspector.recording.snapshot().timeline).toEqual([])
    await settle()
    const { timeline, resources } = inspector.recording.snapshot()
    expect(timeline).toEqual([])
    for (const row of resources)
      expect(row).toMatchObject({
        items: 0,
        askedAt: null,
        answeredAt: null,
        lastError: null,
        running: false,
      })
  })
})

describe('the panel on the page', () => {
  it('brings its own stylesheet, and stays open and in the language of who signs in', () => {
    const { state, show } = inspectedPage(refusing)
    const host = show()
    expect(document.querySelector('link')!.getAttribute('href')).toBe('/inspector.css')
    host.querySelector('details')!.setAttribute('open', '')
    useLanguage('ko')
    state.session.set(me())
    expect(host.getAttribute('aria-label')).toBe('불러오기')
    expect(host.querySelector('details')!.hasAttribute('open')).toBe(true)
    useLanguage('en')
  })

  it('offers to ask only for the lists that can be asked for', () => {
    const { show, asked } = inspectedPage(refusing)
    const host = show()
    getByRole(host, 'button', { name: 'Again: debates' }).click()
    getByRole(host, 'button', { name: 'Invalidate: debates' }).click()
    getByRole(host, 'button', { name: 'Turn off' }).click()
    expect(asked).toEqual(['again debates', 'invalidate debates', 'off'])
    const disabled = allByRole(host, 'button').filter((button) => button.hasAttribute('disabled'))
    expect(disabled.length).toBeGreaterThan(5)
  })
})

describe('the bundle of a release', () => {
  const bundled = async (withInspector: boolean): Promise<string> => {
    const built = await build({
      entryPoints: [join(import.meta.dirname, '..', '..', 'src', 'main.ts')],
      bundle: true,
      format: 'esm',
      outdir: 'out',
      write: false,
      minify: true,
      splitting: withInspector,
      define: { WITH_INSPECTOR: String(withInspector) },
    })
    return built.outputFiles.map((file) => file.text).join('\n')
  }

  it('has nothing of the inspector, which only a development build has', async () => {
    const parts = ['hb-inspector', 'hbInspect', '/inspector.css', 'homingbird-loads.json', 'On its way']
    const held = async (withInspector: boolean): Promise<string[]> => {
      const text = await bundled(withInspector)
      return parts.filter((part) => text.includes(part))
    }
    expect(await held(false)).toEqual([])
    expect(await held(true)).toEqual(parts)
  })
})
