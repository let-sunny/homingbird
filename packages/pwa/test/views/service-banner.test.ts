import { getByRole, getByText, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { serviceBanner } from '../../src/views/service-banner.ts'
import { usingFakeDom } from '../support/dom.ts'

usingFakeDom()

describe('serviceBanner', () => {
  it('renders nothing without a model', () => {
    expect(serviceBanner(null)).toBeNull()
  })

  it('shows the title, the sentence, the command as code and the link to enter a code', () => {
    const shown = serviceBanner({
      title: 'Not connected.',
      body: 'Run this.',
      command: 'homingbird login --server https://hb.example.com',
      link: { href: '#/device', label: 'Enter a code' },
    })!
    expect(shown.getAttribute('role')).toBe('note')
    expect(getByText(shown, 'Not connected.')).toBeTruthy()
    expect(getByText(shown, 'Run this.')).toBeTruthy()
    expect(textOf(shown.querySelector('pre code')!)).toBe('homingbird login --server https://hb.example.com')
    expect(getByRole(shown, 'link', { name: 'Enter a code' }).getAttribute('href')).toBe('#/device')
  })
})
