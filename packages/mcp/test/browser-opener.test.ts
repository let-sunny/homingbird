import { Task as T } from '@homingbird/kernel'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { browserOpener, isWithin, openerCommand } from '../src/browser-opener.ts'

const SERVER = 'https://hb.example.com'

const opening = (platform = 'linux', launch?: (argv: ReadonlyArray<string>) => Promise<void>) => {
  const launched: string[][] = []
  const open = browserOpener(launch ?? (async (argv) => void launched.push([...argv])), platform, SERVER)
  return { launched, open: (url: string) => T.runPromise(open(url)) }
}

describe('openerCommand', () => {
  it('uses the opener of each platform, with the address as one argument', () => {
    expect(openerCommand('darwin', `${SERVER}/#/c/1`)).toEqual(['open', `${SERVER}/#/c/1`])
    expect(openerCommand('linux', `${SERVER}/`)).toEqual(['xdg-open', `${SERVER}/`])
    expect(openerCommand('win32', `${SERVER}/`)).toEqual(['rundll32', 'url.dll,FileProtocolHandler', `${SERVER}/`])
  })
})

describe('isWithin', () => {
  it.each([
    [`${SERVER}/`, true],
    [`${SERVER}/#/device/ABCD-EFGH`, true],
    ['https://hb.example.com:443/x', true],
    ['http://hb.example.com/', false],
    ['https://evil.example.com/', false],
    ['https://hb.example.com.evil.example/', false],
    ['https://hb.example.com@evil.example/', false],
    ['javascript:alert(1)', false],
    ['file:///etc/passwd', false],
    ['not a url', false],
    ['', false],
  ])('%s → %s', (url, expected) => {
    expect(isWithin(SERVER, url)).toBe(expected)
  })

  it('refuses everything when the server address itself is not a URL', () => {
    expect(isWithin('nonsense', `${SERVER}/`)).toBe(false)
    expect(isWithin('file:///x', 'file:///x')).toBe(false)
  })
})

describe('browserOpener', () => {
  it('launches the opener for an address on the configured server and says it opened', async () => {
    const { open, launched } = opening('darwin')
    expect(await open(`${SERVER}/#/c/conv_1`)).toBe(true)
    expect(launched).toEqual([['open', `${SERVER}/#/c/conv_1`]])
  })

  it('launches nothing for any other origin', async () => {
    const { open, launched } = opening()
    expect(await open('https://evil.example.com/')).toBe(false)
    expect(await open('javascript:alert(1)')).toBe(false)
    expect(launched).toEqual([])
  })

  it('says it did not open when the opener cannot be started', async () => {
    const { open } = opening('linux', async () => {
      throw new Error('ENOENT')
    })
    expect(await open(`${SERVER}/`)).toBe(false)
  })

  it('never launches anything but the opener with one address on the server, whatever it is asked to open', async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.string(), fc.webUrl(), fc.constant(`${SERVER}/#/c/x; rm -rf ~`)), async (url) => {
        const { open, launched } = opening()
        await open(url)
        for (const argv of launched) {
          expect(argv).toHaveLength(2)
          expect(argv[0]).toBe('xdg-open')
          expect(new URL(argv[1]!).origin).toBe(SERVER)
        }
      }),
    )
  })
})
