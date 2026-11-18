import { describe, expect, it } from 'vitest'
import {
  isAcceptableRedirectUri,
  isAllowedRedirectUri,
  isLoopbackHost,
  matchingRedirectUri,
} from '../src/auth/redirect-policy.ts'

const DEFAULT_HOSTS = ['claude.ai', 'claude.com']

describe('the shape of a redirect URI', () => {
  it.each([
    ['https://app.example/cb', true],
    ['http://localhost:7777/cb', true],
    ['http://127.0.0.1/cb', true],
    ['http://[::1]:8000/cb', true],
    ['cursor://anysphere.cursor/oauth', true],
    ['http://example.com/cb', false],
    ['https://user:secret@app.example/cb', false],
    ['https://app.example/cb#fragment', false],
    ['data:text/html,x', false],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['not a url', false],
  ])('judges %s as acceptable: %s', (uri, acceptable) => {
    expect(isAcceptableRedirectUri(uri)).toBe(acceptable)
  })
})

describe('the redirect host allow-list', () => {
  it.each([
    ['https://claude.ai/api/mcp/auth_callback', true],
    ['https://claude.com/api/mcp/auth_callback', true],
    ['http://127.0.0.1:53682/callback', true],
    ['http://localhost:3334/oauth/callback', true],
    ['vscode://publisher.extension/callback', true],
    ['https://client.example/callback', false],
    ['https://evil.claude.ai/callback', false],
    ['https://claude.ai.evil.example/callback', false],
    ['https://claude.ai@evil.example/callback', false],
    ['http://claude.ai/api/mcp/auth_callback', false],
    ['https://claude.ai/api/mcp/auth_callback#x', false],
  ])('judges %s as allowed by default: %s', (uri, allowed) => {
    expect(isAllowedRedirectUri(uri, DEFAULT_HOSTS)).toBe(allowed)
  })

  it('allows another https host only once it is listed', () => {
    expect(isAllowedRedirectUri('https://agent.example/cb', DEFAULT_HOSTS)).toBe(false)
    expect(isAllowedRedirectUri('https://agent.example/cb', [...DEFAULT_HOSTS, 'agent.example'])).toBe(true)
  })

  it('keeps loopback redirects allowed when the list is empty', () => {
    expect(isAllowedRedirectUri('http://127.0.0.1:9/cb', [])).toBe(true)
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback', [])).toBe(false)
  })

  it('knows the loopback host names', () => {
    expect(['localhost', '127.0.0.1', '[::1]', 'example.com'].map(isLoopbackHost)).toEqual([
      true,
      true,
      true,
      false,
    ])
  })
})

describe('matching a requested redirect against the registered ones', () => {
  it('matches a registered URI exactly', () => {
    expect(matchingRedirectUri(['https://claude.ai/cb'], 'https://claude.ai/cb')).toBe('https://claude.ai/cb')
  })

  it('lets a loopback redirect use any port, as native clients pick one when they start', () => {
    expect(matchingRedirectUri(['http://127.0.0.1/callback'], 'http://127.0.0.1:43123/callback')).toBe(
      'http://127.0.0.1:43123/callback',
    )
    expect(matchingRedirectUri(['http://localhost:1/cb?x=1'], 'http://localhost:2/cb?x=1')).toBe(
      'http://localhost:2/cb?x=1',
    )
  })

  it.each([
    ['http://127.0.0.1:43123/other'],
    ['http://localhost:43123/callback'],
    ['http://127.0.0.1:43123/callback?extra=1'],
    ['http://127.0.0.1:43123/callback#x'],
    ['https://127.0.0.1:43123/callback'],
    ['not a url'],
  ])('refuses %s against http://127.0.0.1/callback', (requested) => {
    expect(matchingRedirectUri(['http://127.0.0.1/callback'], requested)).toBeNull()
  })

  it('never relaxes the port of an https redirect', () => {
    expect(matchingRedirectUri(['https://claude.ai/cb'], 'https://claude.ai:8443/cb')).toBeNull()
  })

  it('ignores a malformed registered URI', () => {
    expect(matchingRedirectUri(['nonsense'], 'http://127.0.0.1:1/cb')).toBeNull()
  })
})
