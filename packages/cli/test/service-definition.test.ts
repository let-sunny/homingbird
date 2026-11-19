import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  escapeXml,
  logPathFor,
  requirePrintable,
  runnerArguments,
  serviceLockPath,
  serviceSlug,
  serviceStopPath,
  valuesOf,
} from '../src/service-definition.ts'
import { SPEC, SPLIT_SPEC, unescapeXml } from './service-fixtures.ts'

describe('what every service runs', () => {
  it('is homingbird run in service mode, for one server, with the agent as given', () => {
    expect(runnerArguments(SPEC)).toEqual(['run', '--service', '--server', SPEC.server, '--agent', 'claude'])
    expect(runnerArguments(SPLIT_SPEC)).toEqual([
      ...runnerArguments({ ...SPLIT_SPEC, split: false }),
      '--split',
      '--reader',
      SPLIT_SPEC.reader,
      '--require-toolless-reader',
    ])
    expect(runnerArguments({ ...SPLIT_SPEC, split: false }).slice(-2)).toEqual(['--timeout', '120'])
    expect(runnerArguments({ ...SPEC, split: true })).toEqual([...runnerArguments(SPEC), '--split'])
    expect(runnerArguments({ ...SPEC, requireToollessReader: true })).toEqual(runnerArguments(SPEC))
    expect(runnerArguments(SPEC, { logFile: 'C:\\log.txt', workdir: 'C:\\w' }).slice(-4)).toEqual([
      '--log',
      'C:\\log.txt',
      '--workdir',
      'C:\\w',
    ])
    expect(serviceLockPath('/c', SPEC.server)).toBe('/c/desks/service-https-hb-example-com.lock')
    expect(serviceStopPath('/c', SPEC.server)).toBe('/c/desks/service-https-hb-example-com.stop')
  })

  it('names each server with letters, digits and dashes only', () => {
    expect(serviceSlug('https://hb.example.com/')).toBe('https-hb-example-com')
    expect(serviceSlug('http://LOCALHOST:8080/a/b')).toBe('http-localhost-8080-a-b')
    expect(serviceSlug('http://hb.example.com')).not.toBe(serviceSlug('https://hb.example.com'))
    expect(serviceSlug('')).toBe('server')
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        expect(serviceSlug(url)).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/)
      }),
    )
    expect(logPathFor('/c', 'https://hb.example.com')).toBe('/c/logs/runner-https-hb-example-com.log')
  })

  it('cuts a long address before trimming its dashes, so the name never ends in one', () => {
    const slug = serviceSlug('https://aaaaaaaaa.aaaaaaaaaaaa.aa/%F0%90%80%80aaaaaaa%F0%90%80%80')
    expect(slug).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/)
  })

  it('keeps two long addresses that share their first sixty characters apart', () => {
    const shared = `https://hb.example.com/${'a'.repeat(60)}`
    const first = serviceSlug(`${shared}/one`)
    const second = serviceSlug(`${shared}/two`)
    expect(first).not.toBe(second)
    for (const slug of [first, second]) expect(slug.length).toBeLessThanOrEqual(60)
    expect(serviceSlug(`${shared}/one`)).toBe(first)
  })

  it('refuses any value with a control character, and keeps every other spec as it is', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.constantFrom(...(['agent', 'server', 'workdir'] as const)),
        (text, field) => {
          const spec = { ...SPEC, [field]: text }
          const checked = requirePrintable(spec)
          expect(checked._tag === 'Ok').toBe(!/\p{Cc}/u.test(text))
          if (checked._tag === 'Ok') expect(checked.value).toBe(spec)
        },
      ),
    )
    expect(valuesOf(SPLIT_SPEC)).toContain(SPLIT_SPEC.reader)
    expect(valuesOf({ ...SPEC, path: null })).not.toContain(SPEC.path)
  })

  it('escapes XML so that it reads back unchanged', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(unescapeXml(escapeXml(text))).toBe(text)
      }),
    )
    expect(escapeXml(`<a href="x">'&'</a>`)).not.toMatch(/[<>"']/)
  })
})
