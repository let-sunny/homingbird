import { describe, expect, it } from 'vitest'
import { wakeBody, wakeHostOf, wakeTargetProblem } from '../src/wake/wake-target.ts'

const ROUTINE = 'https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire'
const HOSTS = ['api.anthropic.com']
const AUTHORIZATION = { name: 'Authorization', value: 'Bearer token' }

const problemOf = (url: string, headers = [AUTHORIZATION], hosts = HOSTS) =>
  wakeTargetProblem({ url, headers }, hosts)

describe('a wake address', () => {
  it('accepts an https address on an allowed host with the routine headers', () => {
    expect(problemOf(ROUTINE, [AUTHORIZATION, { name: 'anthropic-version', value: '2023-06-01' }])).toBeNull()
    expect(problemOf(`${ROUTINE}?source=homingbird`)).toBeNull()
  })

  it('refuses anything but https on the default port', () => {
    expect(problemOf('http://api.anthropic.com/fire')).toMatch(/https address/)
    expect(problemOf('not a url')).toMatch(/https address/)
    expect(problemOf('https://api.anthropic.com:8443/fire')).toMatch(/default https port/)
  })

  it('refuses a user name, a password or a fragment', () => {
    expect(problemOf('https://me@api.anthropic.com/fire')).toMatch(/user name or password/)
    expect(problemOf('https://me:pw@api.anthropic.com/fire')).toMatch(/user name or password/)
    expect(problemOf('https://:pw@api.anthropic.com/fire')).toMatch(/user name or password/)
    expect(problemOf(`${ROUTINE}#top`)).toMatch(/fragment/)
    expect(problemOf(`${ROUTINE}#`)).toMatch(/fragment/)
  })

  it('refuses a host the operator did not allow exactly, a subdomain or an address', () => {
    for (const url of [
      'https://evil.example/fire',
      'https://eu.api.anthropic.com/fire',
      'https://api.anthropic.com.evil.example/fire',
      'https://127.0.0.1/fire',
      'https://localhost/fire',
    ])
      expect([url, problemOf(url)]).toEqual([url, expect.stringMatching(/must be on api\.anthropic\.com/)])
    expect(problemOf('https://localhost/fire', [AUTHORIZATION], ['localhost'])).toMatch(
      /must be on localhost/,
    )
    expect(problemOf(ROUTINE, [AUTHORIZATION], [])).toMatch(
      /allows no wake addresses; its operator sets HB_WAKE_HOSTS/,
    )
  })

  it('refuses a header the server sets, and a header named twice', () => {
    expect(problemOf(ROUTINE, [{ name: 'Content-Type', value: 'text/plain' }])).toBe(
      'The header Content-Type is set by the server and cannot be changed.',
    )
    expect(problemOf(ROUTINE, [{ name: 'Host', value: 'evil.example' }])).toMatch(/Host is set by the server/)
    expect(problemOf(ROUTINE, [AUTHORIZATION, { name: 'authorization', value: 'Bearer other' }])).toBe(
      'Name each header once.',
    )
  })

  it('keeps the host to show, and tells the service nothing but where work waits', () => {
    expect(wakeHostOf({ url: ROUTINE, headers: [] })).toBe('api.anthropic.com')
    expect(JSON.parse(wakeBody('https://hb.example.com'))).toEqual({
      text: 'Homingbird: work is waiting at https://hb.example.com.',
    })
  })
})
