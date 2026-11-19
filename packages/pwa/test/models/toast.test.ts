import { describe, expect, it } from 'vitest'
import { toastModel } from '../../src/models/toast.ts'
import { strings } from '../../src/strings.ts'

describe('toastModel', () => {
  it('shows nothing without a notice', () => {
    expect(toastModel(null)).toBeNull()
  })

  it('reads an error out at once, and an information as a status, with its link', () => {
    expect(toastModel({ kind: 'error', text: 'No.' })).toEqual({
      className: 'toast is-error',
      role: 'alert',
      text: 'No.',
      link: null,
      close: strings.close,
    })
    expect(
      toastModel({ kind: 'info', text: 'Moved.', link: { href: '#/c/x', label: 'Open' } }),
    ).toMatchObject({
      role: 'status',
      link: { href: '#/c/x', label: 'Open' },
    })
  })
})
