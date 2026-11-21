import { afterEach, describe, expect, it } from 'vitest'
import { clientLabel } from '../src/client-labels.ts'
import { useLanguage } from '../src/strings.ts'

describe('clientLabel', () => {
  afterEach(() => useLanguage('en'))

  it('names the programs Homingbird reports in the person’s language', () => {
    useLanguage('ko')
    expect(clientLabel('Web')).toBe('웹 클라이언트')
    expect(clientLabel('Homingbird CLI')).toBe('Homingbird 명령줄 도구')
  })

  it('reads the web client and the command line in English by default', () => {
    expect(clientLabel('Web')).toBe('Web client')
    expect(clientLabel('Homingbird CLI')).toBe('Homingbird CLI')
  })

  it('keeps any other program’s label as it reported it', () => {
    expect(clientLabel('Example notes app')).toBe('Example notes app')
  })
})
