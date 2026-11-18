import { describe, expect, it } from 'vitest'
import { clientAddressOf } from '../src/http/forwarded-address.ts'

describe('the client address', () => {
  it('uses the socket address and ignores the header when no proxy is trusted', () => {
    expect(clientAddressOf('203.0.113.7', '198.51.100.1', 0)).toBe('198.51.100.1')
  })

  it('takes the entry the one trusted proxy appended, not one the client forged', () => {
    expect(clientAddressOf('6.6.6.6, 203.0.113.7', '10.0.0.1', 1)).toBe('203.0.113.7')
    expect(clientAddressOf('203.0.113.7', '10.0.0.1', 1)).toBe('203.0.113.7')
  })

  it('counts several trusted hops from the right', () => {
    expect(clientAddressOf('6.6.6.6, 203.0.113.7, 10.0.0.2', '10.0.0.1', 2)).toBe('203.0.113.7')
    expect(clientAddressOf('1.1.1.1,6.6.6.6 ,203.0.113.7,35.191.0.1,10.0.0.2', '10.0.0.1', 3)).toBe(
      '203.0.113.7',
    )
  })

  it('takes the leftmost entry when the header has fewer entries than trusted proxies', () => {
    expect(clientAddressOf('203.0.113.7', '10.0.0.1', 2)).toBe('203.0.113.7')
  })

  it('falls back to the socket address when the header is missing or empty', () => {
    expect(clientAddressOf(undefined, '10.0.0.1', 1)).toBe('10.0.0.1')
    expect(clientAddressOf(' , ', '10.0.0.1', 1)).toBe('10.0.0.1')
    expect(clientAddressOf(undefined, undefined, 1)).toBe('unknown')
    expect(clientAddressOf('203.0.113.7', undefined, 0)).toBe('unknown')
  })

  it('keeps IPv6 entries whole', () => {
    expect(clientAddressOf('2001:db8::bad, 2001:db8::7', '::ffff:10.0.0.1', 1)).toBe('2001:db8::7')
    expect(clientAddressOf('2001:db8::7, fd00::2', '::1', 2)).toBe('2001:db8::7')
  })
})
