import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SECURITY_HEADERS } from '../src/http/static-routes.ts'
import { type TestServer, startTestServer } from './harness.ts'

let server: TestServer | undefined
const directories: string[] = []

afterEach(async () => {
  await server?.close()
  server = undefined
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const folder = (files: Readonly<Record<string, string>>): string => {
  const root = mkdtempSync(join(tmpdir(), 'dovecote-static-'))
  directories.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

const body = (response: { raw: { body: unknown } }): string =>
  Buffer.from(response.raw.body as Uint8Array).toString('utf8')

describe('the static files', () => {
  it('serve the web client, fall back to its page for client routes, and never leave its folder', async () => {
    const web = folder({ 'index.html': '<main>app</main>', 'app.js': 'start()' })
    folder({ 'secret.txt': 'nope' })
    server = await startTestServer({ HB_WEB_DIR: web })
    const script = await server.request('GET', '/app.js')
    expect([script.status, body(script)]).toEqual([200, 'start()'])
    expect(body(await server.request('GET', '/c/conv_1'))).toBe('<main>app</main>')
    expect(body(await server.request('GET', '/..%2f..%2fetc%2fpasswd'))).toBe('<main>app</main>')
    expect((await server.request('POST', '/app.js')).status).toBe(405)
  })

  it('make the browser ask again for the web client’s own files, and answer 304 while they are unchanged', async () => {
    const web = folder({
      'index.html': '<main>app</main>',
      'app.js': 'start()',
      'app.css': 'main{}',
      'font.woff2': 'f',
    })
    server = await startTestServer({ HB_WEB_DIR: web })
    for (const path of ['/', '/app.js', '/app.css'])
      expect((await server.request('GET', path)).headers['cache-control']).toBe('no-cache')
    expect((await server.request('GET', '/font.woff2')).headers['cache-control']).toBe('public, max-age=3600')
    const first = await server.request('GET', '/app.js')
    const etag = first.headers.etag!
    const again = await server.request('GET', '/app.js', { headers: { 'if-none-match': etag } })
    expect([again.status, body(again)]).toEqual([304, ''])
    writeFileSync(join(web, 'app.js'), 'startNextRelease()')
    const changed = await server.request('GET', '/app.js', { headers: { 'if-none-match': etag } })
    expect([changed.status, body(changed)]).toEqual([200, 'startNextRelease()'])
    expect(changed.headers.etag).not.toBe(etag)
    const weak = await server.request('GET', '/app.js', {
      headers: { 'if-none-match': `"other", W/${changed.headers.etag!}` },
    })
    expect(weak.status).toBe(304)
    expect((await server.request('GET', '/app.js', { headers: { 'if-none-match': '*' } })).status).toBe(304)
    const theme = await server.request('GET', '/theme.css')
    expect(
      (await server.request('GET', '/theme.css', { headers: { 'if-none-match': theme.headers.etag! } }))
        .status,
    ).toBe(304)
    const page = await server.request('GET', '/c/conv_1', {
      headers: { 'if-none-match': (await server.request('GET', '/')).headers.etag! },
    })
    expect(page.status).toBe(304)
  })

  it('say the web client is missing when the server has none', async () => {
    server = await startTestServer()
    const missing = await server.request('GET', '/')
    expect([missing.status, missing.raw.body]).toEqual([
      404,
      'The web client is not installed on this server.',
    ])
  })

  it('serve an organization’s theme and branding, and defaults when it has none', async () => {
    server = await startTestServer()
    expect(body(await server.request('GET', '/theme.css'))).toContain('no organization theme')
    expect((await server.request('GET', '/branding.json')).json).toEqual({ name: 'Homingbird', logo: null })
    await server.close()
    const theme = folder({
      'theme.css': ':root { --accent: teal }',
      'branding.json': '{"name":"Acme"}',
      'logo.svg': '<svg/>',
      'notes.txt': 'private',
    })
    server = await startTestServer({ HB_THEME_DIR: theme })
    expect(body(await server.request('GET', '/theme.css'))).toBe(':root { --accent: teal }')
    expect((await server.request('GET', '/branding.json')).json).toEqual({ name: 'Acme', logo: null })
    expect((await server.request('GET', '/theme/logo.svg')).status).toBe(200)
    expect((await server.request('GET', '/theme/notes.txt')).status).toBe(404)
  })

  it('reads branding that does not parse as no branding', async () => {
    server = await startTestServer({ HB_THEME_DIR: folder({ 'branding.json': '{not json' }) })
    expect((await server.request('GET', '/branding.json')).json).toEqual({ name: 'Homingbird', logo: null })
  })

  it('send a content policy that allows only the page’s own scripts and no framing', () => {
    expect(SECURITY_HEADERS['content-security-policy']).toContain("script-src 'self'")
    expect(SECURITY_HEADERS['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(SECURITY_HEADERS['x-content-type-options']).toBe('nosniff')
  })
})
