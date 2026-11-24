import { getByRole } from '@homingbird/ui/testing'
import { describe, expect, it, vi } from 'vitest'
import { startModel } from '../../src/models/start.ts'
import { strings } from '../../src/strings.ts'
import { startView } from '../../src/views/start.ts'
import { usingFakeDom } from '../support/dom.ts'

usingFakeDom()

const model = (start: Parameters<typeof startModel>[0]['start'], retrying = false) =>
  startModel({ start, retrying, brandingName: 'Acme', refusal: 'Not allowed.' })

describe('startView', () => {
  it('shows a quiet status while loading, without a button', () => {
    const shown = startView(model('loading', true), () => {})
    expect(getByRole(shown, 'status').textContent).toBe(strings.firstLoad.retrying)
    expect(shown.querySelector('button')).toBeNull()
  })

  it('says the server could not be reached and offers one primary button that tries again', () => {
    const retry = vi.fn()
    const shown = startView(model('failed'), retry)
    expect(getByRole(shown, 'status').textContent).toBe(strings.firstLoad.failed)
    expect(shown.textContent).toContain('Acme')
    const buttons = shown.querySelectorAll('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.className).toBe('primary')
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('says it takes too long, with the same button, while the load goes on', () => {
    const shown = startView(model('long'), () => {})
    expect(getByRole(shown, 'status').textContent).toBe(strings.firstLoad.tooLong)
    expect(getByRole(shown, 'button', { name: strings.tryAgain })).toBeTruthy()
  })
})
