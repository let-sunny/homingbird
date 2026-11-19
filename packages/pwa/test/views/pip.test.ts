import { describe, expect, it } from 'vitest'
import { pip } from '../../src/views/pip.ts'
import { usingFakeDom } from '../support/dom.ts'

usingFakeDom()

describe('pip', () => {
  it('is decoration unless it is labelled', () => {
    const plain = pip('waving')
    expect([plain.className, plain.getAttribute('role'), plain.getAttribute('aria-hidden')]).toEqual([
      'pip is-waving pip-x2',
      'presentation',
      'true',
    ])
    const named = pip('failed', 4, 'Failed')
    expect([
      named.getAttribute('role'),
      named.getAttribute('aria-label'),
      named.hasAttribute('aria-hidden'),
    ]).toEqual(['img', 'Failed', false])
  })
})
