import { fakeEvent } from '@homingbird/ui/testing'
import { describe, expect, it, vi } from 'vitest'
import { browserDocument } from '../src/page-document.ts'
import { mount, usingFakeDom } from './support/dom.ts'

usingFakeDom()

describe('the page’s document', () => {
  it('finds what is on the page by id and selector, the focus, the body and the root', () => {
    const page = browserDocument(() => document)
    const button = mount(Object.assign(document.createElement('button'), { id: 'go', className: 'go' }))
    expect([page.byId('go'), page.find('.go'), page.byId('nowhere')]).toEqual([button, button, null])
    button.focus()
    expect(page.focused()).toBe(button)
    const callout = document.createElement('div')
    page.addToBody(callout)
    expect(callout.parentElement).toBe(document.body)
    expect(page.root()).toBe(document.documentElement)
  })

  it('listens to document-wide events until told to stop', () => {
    const page = browserDocument(() => document)
    const heard = vi.fn()
    const stop = page.listen('keydown', heard)
    document.dispatchEvent(fakeEvent('keydown') as unknown as Event)
    stop()
    document.dispatchEvent(fakeEvent('keydown') as unknown as Event)
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('runs a change in a view transition where there are any, and says so', async () => {
    const plain = browserDocument(() => document)
    expect(plain.inTransition(() => {})).toBe(false)
    const changes: string[] = []
    const transitions = Object.assign(Object.create(document), {
      startViewTransition(this: unknown, change: () => void) {
        changes.push(this === transitions ? 'on the document' : 'elsewhere')
        change()
        return { ready: Promise.reject(new Error('skipped')) }
      },
    })
    expect(browserDocument(() => transitions).inTransition(() => changes.push('changed'))).toBe(true)
    expect(changes).toEqual(['on the document', 'changed'])
    await Promise.resolve()
  })
})
