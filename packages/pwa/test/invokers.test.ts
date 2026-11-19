import { fakeDocument, isPopoverOpen } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { supportInvokerCommands } from '../src/invokers.ts'

const invoker = (document: ReturnType<typeof fakeDocument>, command: string, target: string) => {
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('commandfor', target)
  button.setAttribute('command', command)
  document.body.append(button)
  return button
}

describe('supportInvokerCommands', () => {
  it('runs dialog and popover commands where the browser does not', () => {
    const document = fakeDocument({ invokers: false })
    const dialog = document.createElement('dialog')
    dialog.id = 'dialog'
    const menu = document.createElement('div')
    menu.id = 'menu'
    document.body.append(dialog, menu)
    supportInvokerCommands(document as unknown as Document)
    invoker(document, 'show-modal', 'dialog').click()
    expect(dialog.open).toBe(true)
    invoker(document, 'close', 'dialog').click()
    expect(dialog.open).toBe(false)
    invoker(document, 'show-popover', 'menu').click()
    expect(isPopoverOpen(menu)).toBe(true)
    invoker(document, 'hide-popover', 'menu').click()
    expect(isPopoverOpen(menu)).toBe(false)
    invoker(document, 'toggle-popover', 'menu').click()
    expect(isPopoverOpen(menu)).toBe(true)
    invoker(document, 'show-modal', 'dialog').click()
    invoker(document, 'show-modal', 'dialog').click()
    invoker(document, 'close', 'menu').click()
    invoker(document, 'unknown', 'menu').click()
    invoker(document, 'toggle-popover', 'missing').click()
    invoker(document, 'close', 'dialog').removeAttribute('command')
    document.querySelectorAll('button').at(-1)!.click()
    document.body.click()
    expect(isPopoverOpen(menu)).toBe(true)
    expect(dialog.open).toBe(true)
  })

  it('leaves invokers to a browser that runs them', () => {
    const document = fakeDocument()
    const listened: string[] = []
    const root = {
      createElement: () => ({ commandForElement: null }),
      addEventListener: (type: string) => listened.push(type),
    }
    supportInvokerCommands(root as unknown as Document)
    expect(listened).toEqual([])
    expect(document).toBeTruthy()
  })
})
