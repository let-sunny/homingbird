import { describe, expect, it } from 'vitest'
import { PRINCIPLE_SOURCE_MAX, PrincipleSource } from '../src/principle-source.ts'

describe('PrincipleSource', () => {
  it('is a web address of bounded length', () => {
    expect(PrincipleSource.decode('https://wiki.example/a')._tag).toBe('Ok')
    expect(PrincipleSource.decode('http://wiki.example')._tag).toBe('Ok')
    expect(PrincipleSource.decode('javascript:alert(1)')._tag).toBe('Err')
    expect(PrincipleSource.decode('https://wiki example/a')._tag).toBe('Err')
    expect(PrincipleSource.decode(`https://wiki.example/${'a'.repeat(PRINCIPLE_SOURCE_MAX)}`)._tag).toBe(
      'Err',
    )
  })
})
