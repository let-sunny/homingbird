import { describe, expect, it } from 'vitest'
import { DEFAULT_CLIENT_METADATA_HOSTS, DEFAULT_REDIRECT_HOSTS } from '../src/auth/default-oauth-hosts.ts'
import { isAllowedRedirectUri } from '../src/auth/redirect-policy.ts'

describe('the OAuth hosts allowed by default', () => {
  it('are bare host names, so a deployment can list its own the same way', () => {
    for (const host of [...DEFAULT_REDIRECT_HOSTS, ...DEFAULT_CLIENT_METADATA_HOSTS])
      expect(host).toMatch(/^[a-z0-9.-]+$/)
  })

  it('let a connector on those hosts come back over https only', () => {
    for (const host of DEFAULT_REDIRECT_HOSTS) {
      expect(isAllowedRedirectUri(`https://${host}/api/mcp/auth_callback`, DEFAULT_REDIRECT_HOSTS)).toBe(true)
      expect(isAllowedRedirectUri(`http://${host}/api/mcp/auth_callback`, DEFAULT_REDIRECT_HOSTS)).toBe(false)
    }
    expect(isAllowedRedirectUri('https://evil.example/callback', DEFAULT_REDIRECT_HOSTS)).toBe(false)
  })
})
