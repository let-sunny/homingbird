import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ADAPTER_VERSION } from '../src/version.ts'

describe('ADAPTER_VERSION', () => {
  it('is the version the package is published as', () => {
    const published = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(ADAPTER_VERSION).toBe(published.version)
  })
})
