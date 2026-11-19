import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SERVER_VERSION } from '../src/version.ts'

describe('the server version', () => {
  it('is the version of the package that is released', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(SERVER_VERSION).toBe(manifest.version)
  })
})
