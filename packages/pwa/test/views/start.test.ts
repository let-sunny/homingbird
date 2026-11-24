import { getByRole } from '@homingbird/ui/testing'
import { describe, expect, it, vi } from 'vitest'
import { startModel } from '../../src/models/start.ts'
import { strings } from '../../src/strings.ts'
import { startView } from '../../src/views/start.ts'
import { usingFakeDom } from '../support/dom.ts'

usingFakeDom()

describe('startView', () => {
  it('shows a quiet status while loading', () => {
    const shown = startView(startModel('slow', 'Homingbird'), () => {})
    expect(getByRole(shown, 'status').textContent).toBe(strings.firstLoad.slow)
    expect(shown.querySelector('button')).toBeNull()
  })

  it('says the server could not be reached and offers one primary button that tries again', () => {
    const retry = vi.fn()
    const shown = startView(startModel('failed', 'Acme'), retry)
    expect(getByRole(shown, 'status').textContent).toBe(strings.firstLoad.failed)
    expect(shown.textContent).toContain('Acme')
    const buttons = shown.querySelectorAll('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.className).toBe('primary')
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
