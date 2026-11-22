import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type FakeDocument,
  fakeDocument,
  fakeEvent,
  installFakeDom,
  isPopoverOpen,
  uninstallFakeDom,
} from '../../src/testing/fake-dom.ts'

let document: FakeDocument
beforeEach(() => {
  document = fakeDocument()
})

describe('installFakeDom', () => {
  afterEach(() => uninstallFakeDom())

  it('stands in for the global document until it is uninstalled', () => {
    const before = (globalThis as { document?: unknown }).document
    const installed = installFakeDom()
    expect((globalThis as { document?: unknown }).document).toBe(installed)
    uninstallFakeDom()
    expect((globalThis as { document?: unknown }).document).toBe(before)
    uninstallFakeDom()
    expect((globalThis as { document?: unknown }).document).toBe(before)
    installFakeDom()
  })
})

describe('the tree', () => {
  it('appends, inserts, replaces and removes children, moving a node out of its old parent', () => {
    const list = document.createElement('ul')
    const [a, b, c] = ['a', 'b', 'c'].map((name) => {
      const item = document.createElement('li')
      item.textContent = name
      return item
    }) as [
      ReturnType<FakeDocument['createElement']>,
      ReturnType<FakeDocument['createElement']>,
      ReturnType<FakeDocument['createElement']>,
    ]
    list.append(a, c)
    list.insertBefore(b, c)
    expect(list.textContent).toBe('abc')
    expect(list.firstChild).toBe(a)
    expect(list.lastChild).toBe(c)
    expect(b.nextSibling).toBe(c)
    expect(b.previousSibling).toBe(a)
    expect(list.insertBefore(b, b)).toBe(b)
    list.insertBefore(c, null)
    expect(list.textContent).toBe('abc')
    const other = document.createElement('ol')
    other.appendChild(a)
    expect(list.textContent).toBe('bc')
    expect(a.parentElement).toBe(other)
    b.replaceWith('x', document.createTextNode('y'))
    expect(list.textContent).toBe('xyc')
    list.removeChild(c)
    expect(list.childNodes).toHaveLength(2)
    list.prepend('first ')
    expect(list.textContent).toBe('first xy')
    list.replaceChildren('only')
    expect(list.textContent).toBe('only')
    a.remove()
    expect(other.childNodes).toEqual([])
    a.remove()
    document.createElement('p').replaceWith('nothing happens')
    expect(document.createTextNode('t').nextSibling).toBeNull()
  })

  it('moves the children of a fragment, leaving it empty', () => {
    const fragment = document.createDocumentFragment()
    fragment.append('one', 'two')
    const host = document.createElement('div')
    host.appendChild(fragment)
    expect(host.textContent).toBe('onetwo')
    expect(fragment.childNodes).toEqual([])
  })

  it('knows what is connected to the document and what contains what', () => {
    const host = document.createElement('div')
    const inner = document.createElement('span')
    host.appendChild(inner)
    expect(inner.isConnected).toBe(false)
    document.body.appendChild(host)
    expect(inner.isConnected).toBe(true)
    expect(document.isConnected).toBe(true)
    expect(host.contains(inner)).toBe(true)
    expect(inner.contains(host)).toBe(false)
    expect(host.contains(null)).toBe(false)
    expect(inner.ownerDocument).toBe(document)
    expect(document.ownerDocument).toBe(document)
    expect(document.documentElement.children.map((child) => child.localName)).toEqual(['head', 'body'])
  })

  it('sets text content, and an empty text leaves no text node', () => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'hello'
    expect(paragraph.childNodes).toHaveLength(1)
    paragraph.textContent = ''
    expect(paragraph.childNodes).toHaveLength(0)
    const text = document.createTextNode('a')
    text.textContent = 'b'
    expect(text.textContent).toBe('b')
  })
})

describe('layout', () => {
  it('scrolls only within what overflows, and has no box until a test gives it one', () => {
    const scroller = document.createElement('div')
    scroller.scrollTop = 40
    expect(scroller.scrollTop).toBe(0)
    Object.assign(scroller, { scrollHeight: 900, clientHeight: 300 })
    scroller.scrollTop = 40
    expect(scroller.scrollTop).toBe(40)
    scroller.scrollTop = 1000
    expect(scroller.scrollTop).toBe(600)
    scroller.scrollTop = -5
    expect(scroller.scrollTop).toBe(0)
    expect(scroller.getBoundingClientRect()).toEqual({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    })
  })
})

describe('attributes', () => {
  it('reflects id, class, the boolean attributes and data attributes', () => {
    const element = document.createElement('DIV')
    expect(element.tagName).toBe('DIV')
    element.id = 'main'
    element.className = 'a b'
    element.classList.add('c', 'a')
    element.classList.remove('b')
    expect(element.classList.toggle('d')).toBe(true)
    expect(element.classList.toggle('d')).toBe(false)
    expect(element.classList.toggle('e', true)).toBe(true)
    expect(element.className).toBe('a c e')
    expect(element.classList.contains('c')).toBe(true)
    element.hidden = true
    expect(element.getAttribute('hidden')).toBe('')
    element.hidden = false
    expect(element.hasAttribute('hidden')).toBe(false)
    element.dataset.noteId = 'n1'
    expect(element.getAttribute('data-note-id')).toBe('n1')
    expect('noteId' in element.dataset).toBe(true)
    expect(Object.keys(element.dataset)).toEqual(['noteId'])
    expect({ ...element.dataset }).toEqual({ noteId: 'n1' })
    delete element.dataset.noteId
    expect(element.dataset.noteId).toBeUndefined()
    expect(Object.getOwnPropertyDescriptor(element.dataset, 'noteId')).toBeUndefined()
    expect(element.dataset[Symbol.iterator as unknown as string]).toBeUndefined()
    expect(element.toggleAttribute('open')).toBe(true)
    expect(element.toggleAttribute('open', false)).toBe(false)
    element.setAttribute('Title', 'x')
    expect(element.attributes).toContainEqual({ name: 'title', value: 'x' })
    element.removeAttribute('title')
    expect(element.getAttribute('title')).toBeNull()
  })

  it('keeps style properties', () => {
    const element = document.createElement('span')
    element.style.setProperty('--share', '0.5')
    expect(element.style.getPropertyValue('--share')).toBe('0.5')
    expect(element.style.removeProperty('--share')).toBe('0.5')
    expect(element.style.removeProperty('--share')).toBe('')
  })

  it('gives form controls their properties', () => {
    const input = document.createElement('input')
    expect(input.type).toBe('text')
    expect(document.createElement('button').type).toBe('submit')
    expect(document.createElement('div').type).toBe('')
    input.setAttribute('value', 'from attribute')
    expect(input.value).toBe('from attribute')
    input.value = 'typed'
    expect(input.value).toBe('typed')
    input.name = 'q'
    input.type = 'search'
    input.maxLength = 10
    input.required = true
    expect([input.name, input.type, input.maxLength, input.required]).toEqual(['q', 'search', 10, true])
    expect(document.createElement('input').maxLength).toBe(-1)
    const box = document.createElement('input')
    box.type = 'checkbox'
    expect(box.value).toBe('on')
    const area = document.createElement('textarea')
    area.textContent = 'default'
    expect(area.value).toBe('default')
    area.value = 'changed'
    expect(area.value).toBe('changed')
    area.rows = 4
    expect(area.rows).toBe(4)
    expect(document.createElement('textarea').rows).toBe(2)
    const button = document.createElement('button')
    button.value = 'b'
    expect(button.getAttribute('value')).toBe('b')
  })

  it('picks the selected option of a select, or the first', () => {
    const select = document.createElement('select')
    expect(select.value).toBe('')
    for (const value of ['a', 'b']) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = value.toUpperCase()
      select.appendChild(option)
    }
    expect(select.value).toBe('a')
    select.value = 'b'
    expect(select.value).toBe('b')
    expect(select.options.map((option) => option.selected)).toEqual([false, true])
    select.value = 'nothing'
    expect(select.value).toBe('')
    const plain = document.createElement('option')
    plain.textContent = 'Text'
    expect(plain.value).toBe('Text')
    plain.setAttribute('selected', '')
    expect(plain.selected).toBe(true)
  })

  it('checks one radio of a group at a time', () => {
    const form = document.createElement('form')
    const radios = ['a', 'b'].map((value) => {
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = 'choice'
      radio.value = value
      form.appendChild(radio)
      return radio
    })
    radios[0]!.checked = true
    radios[1]!.checked = true
    expect(radios.map((radio) => radio.checked)).toEqual([false, true])
    const loose = document.createElement('input')
    loose.type = 'radio'
    loose.checked = true
    expect(loose.checked).toBe(true)
  })
})

describe('queries', () => {
  it('finds elements by selector, by id and as the closest ancestor', () => {
    const host = document.createElement('section')
    host.className = 'page'
    const item = document.createElement('li')
    item.id = 'one'
    host.appendChild(document.createElement('ul')).appendChild(item)
    document.body.appendChild(host)
    expect(document.getElementById('one')).toBe(item)
    expect(document.getElementById('none')).toBeNull()
    expect(document.querySelector('.page li')).toBe(item)
    expect(document.querySelector('.missing')).toBeNull()
    expect(document.querySelectorAll('ul, li')).toHaveLength(2)
    expect(host.querySelector('#one')).toBe(item)
    expect(host.querySelector('#two')).toBeNull()
    expect(host.querySelectorAll('li')).toEqual([item])
    expect(item.closest('.page')).toBe(host)
    expect(item.closest('.nowhere')).toBeNull()
    expect(item.matches('li#one')).toBe(true)
  })
})

describe('events', () => {
  it('bubbles from the target up, once listeners run once, and a stop ends the path', () => {
    const outer = document.createElement('div')
    const inner = document.createElement('button')
    outer.appendChild(inner)
    const seen: string[] = []
    const once = vi.fn()
    outer.addEventListener('click', (event) => seen.push(`outer:${event.currentTarget === outer}`))
    inner.addEventListener('click', (event) => seen.push(`inner:${event.target === inner}`))
    inner.addEventListener('click', once, { once: true })
    inner.click()
    inner.click()
    expect(seen).toEqual(['inner:true', 'outer:true', 'inner:true', 'outer:true'])
    expect(once).toHaveBeenCalledTimes(1)
    const stopper = (event: ReturnType<typeof fakeEvent>) => event.stopPropagation()
    inner.addEventListener('click', stopper)
    inner.addEventListener('click', stopper)
    inner.click()
    expect(seen).toHaveLength(5)
    inner.removeEventListener('click', stopper)
    inner.removeEventListener('keydown', stopper)
    inner.click()
    expect(seen).toHaveLength(7)
  })

  it('runs capturing listeners from the top down before the target, and a stop there ends the path', () => {
    const outer = document.createElement('div')
    const inner = document.createElement('button')
    outer.appendChild(inner)
    const seen: string[] = []
    const stopper = (event: ReturnType<typeof fakeEvent>) => event.stopPropagation()
    outer.addEventListener('click', () => seen.push('outer bubbling'))
    outer.addEventListener('click', () => seen.push('outer capturing'), { capture: true })
    inner.addEventListener('click', () => seen.push('inner'))
    inner.click()
    expect(seen).toEqual(['outer capturing', 'inner', 'outer bubbling'])
    outer.addEventListener('click', stopper, true)
    inner.click()
    expect(seen).toHaveLength(4)
    outer.removeEventListener('click', stopper)
    inner.click()
    expect(seen).toHaveLength(5)
    outer.removeEventListener('click', stopper, { capture: true })
    inner.click()
    expect(seen).toHaveLength(8)
  })

  it('does not bubble events that do not bubble, and reports a prevented default', () => {
    const outer = document.createElement('div')
    const inner = document.createElement('span')
    outer.appendChild(inner)
    const listener = vi.fn()
    outer.addEventListener('toggle', listener)
    inner.dispatchEvent(fakeEvent('toggle'))
    expect(listener).not.toHaveBeenCalled()
    inner.addEventListener('keydown', (event) => event.preventDefault())
    const event = fakeEvent('keydown', { key: 'Enter', shiftKey: true })
    expect(inner.dispatchEvent(event)).toBe(false)
    expect([event.defaultPrevented, event.key, event.shiftKey, event.target]).toEqual([
      true,
      'Enter',
      true,
      inner,
    ])
    const shortcut = fakeEvent('keydown', { key: 'Enter', ctrlKey: true, metaKey: true })
    expect([shortcut.ctrlKey, shortcut.metaKey, event.ctrlKey, event.metaKey]).toEqual([
      true,
      true,
      false,
      false,
    ])
  })

  it('carries where a pointer pressed, and bubbles a context menu request', () => {
    const outer = document.createElement('div')
    const inner = document.createElement('span')
    outer.appendChild(inner)
    const heard: Array<[string, number, number]> = []
    outer.addEventListener('contextmenu', (event) => heard.push([event.type, event.clientX, event.clientY]))
    inner.dispatchEvent(fakeEvent('contextmenu', { clientX: 12, clientY: 34 }))
    expect(heard).toEqual([['contextmenu', 12, 34]])
    expect([fakeEvent('pointermove').clientX, fakeEvent('pointercancel').bubbles]).toEqual([0, true])
  })

  it('submits the form of a submit button, but not of a plain or disabled one', () => {
    const form = document.createElement('form')
    const submit = document.createElement('button')
    const plain = document.createElement('button')
    plain.type = 'button'
    form.append(submit, plain)
    const submitted = vi.fn()
    form.addEventListener('submit', submitted)
    plain.click()
    expect(submitted).not.toHaveBeenCalled()
    submit.click()
    expect(submitted).toHaveBeenCalledTimes(1)
    submit.disabled = true
    submit.click()
    expect(submitted).toHaveBeenCalledTimes(1)
  })

  it('toggles a checkbox on click and dispatches change, unless the click is prevented', () => {
    const box = document.createElement('input')
    box.type = 'checkbox'
    const changes = vi.fn()
    box.addEventListener('change', changes)
    box.click()
    expect(box.checked).toBe(true)
    expect(changes).toHaveBeenCalledTimes(1)
    const preventing = (event: ReturnType<typeof fakeEvent>) => event.preventDefault()
    box.addEventListener('click', preventing)
    box.click()
    expect(box.checked).toBe(true)
    box.removeEventListener('click', preventing)
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.addEventListener('change', changes)
    radio.click()
    radio.click()
    expect(changes).toHaveBeenCalledTimes(2)
    document.createElement('p').dispatchEvent(fakeEvent('click'))
  })

  it('opens and closes details from their summary', () => {
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    details.appendChild(summary)
    const toggles: string[] = []
    details.addEventListener('toggle', (event) => toggles.push(event.newState))
    summary.click()
    expect(details.open).toBe(true)
    details.open = true
    summary.click()
    expect(toggles).toEqual(['open', 'closed'])
    const dialog = document.createElement('dialog')
    dialog.open = true
    dialog.open = false
    expect(dialog.open).toBe(false)
  })

  it('gives the focus to the field marked autofocus when a dialog opens as a modal', () => {
    const dialog = document.createElement('dialog')
    const field = document.createElement('textarea')
    field.setAttribute('autofocus', '')
    dialog.append(document.createElement('button'), field)
    document.body.append(dialog)
    dialog.showModal()
    expect(document.activeElement).toBe(field)
  })

  it('moves focus, and a changed control dispatches change as it loses it', () => {
    document.body.append(document.createElement('input'), document.createElement('input'))
    const [first, second] = document.querySelectorAll('input') as [
      ReturnType<FakeDocument['createElement']>,
      ReturnType<FakeDocument['createElement']>,
    ]
    const changed = vi.fn()
    first.addEventListener('change', changed)
    first.focus()
    first.focus()
    expect(document.activeElement).toBe(first)
    first.value = 'new'
    second.focus()
    expect(changed).toHaveBeenCalledTimes(1)
    second.blur()
    second.blur()
    expect(document.activeElement).toBe(document.body)
    const span = document.createElement('span')
    document.body.appendChild(span)
    span.focus()
    span.blur()
    second.focus()
    second.remove()
    expect(document.activeElement).toBe(document.body)
  })
})

describe('popovers and dialogs', () => {
  it('opens a popover from its button and tells listeners about the change', () => {
    const button = document.createElement('button')
    button.setAttribute('popovertarget', 'menu')
    button.type = 'button'
    const menu = document.createElement('div')
    menu.id = 'menu'
    menu.setAttribute('popover', 'auto')
    document.body.append(button, menu)
    const states: string[] = []
    menu.addEventListener('toggle', (event) => states.push(event.newState))
    button.click()
    expect(isPopoverOpen(menu)).toBe(true)
    expect(menu.matches(':popover-open')).toBe(true)
    menu.showPopover()
    menu.hidePopover()
    expect(menu.togglePopover()).toBe(true)
    expect(states).toEqual(['open', 'closed', 'open'])
    expect(isPopoverOpen(document.createElement('div'))).toBe(false)
  })

  it('runs invoker commands on a dialog and dispatches close', () => {
    const dialog = document.createElement('dialog')
    dialog.id = 'dialog'
    const open = document.createElement('button')
    open.type = 'button'
    open.setAttribute('commandfor', 'dialog')
    open.setAttribute('command', 'show-modal')
    const shut = document.createElement('button')
    shut.type = 'button'
    shut.setAttribute('commandfor', 'dialog')
    shut.setAttribute('command', 'close')
    document.body.append(open, shut, dialog)
    const closed = vi.fn()
    dialog.addEventListener('close', closed)
    open.click()
    expect(dialog.open).toBe(true)
    open.click()
    shut.click()
    expect(dialog.open).toBe(false)
    expect(closed).toHaveBeenCalledTimes(1)
    dialog.close()
    expect(closed).toHaveBeenCalledTimes(1)
    dialog.show()
    expect(dialog.open).toBe(true)
  })

  it('runs popover commands on a popover', () => {
    const menu = document.createElement('div')
    menu.id = 'menu'
    document.body.appendChild(menu)
    const run = (command: string): void => {
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('commandfor', 'menu')
      button.setAttribute('command', command)
      document.body.appendChild(button)
      button.click()
    }
    run('show-popover')
    expect(isPopoverOpen(menu)).toBe(true)
    run('hide-popover')
    expect(isPopoverOpen(menu)).toBe(false)
    run('toggle-popover')
    expect(isPopoverOpen(menu)).toBe(true)
    run('unknown')
    expect(isPopoverOpen(menu)).toBe(true)
  })
})

describe('a browser without invoker commands', () => {
  it('leaves a command button to the page', () => {
    const plain = fakeDocument({ invokers: false })
    const dialog = plain.createElement('dialog')
    dialog.id = 'dialog'
    const button = plain.createElement('button')
    button.type = 'button'
    button.setAttribute('commandfor', 'dialog')
    button.setAttribute('command', 'show-modal')
    plain.body.append(button, dialog)
    button.click()
    expect(dialog.open).toBe(false)
  })
})

describe('a browser without popovers', () => {
  it('gives elements no popover methods, and a popover button does nothing', () => {
    const plain = fakeDocument({ popovers: false })
    const menu = plain.createElement('div')
    expect('showPopover' in menu).toBe(false)
    const button = plain.createElement('button')
    button.type = 'button'
    button.setAttribute('popovertarget', 'nothing')
    plain.body.append(button, menu)
    button.click()
  })
})

describe('the rest of the element', () => {
  it('is visible only while connected and not hidden, and answers the calls views make', () => {
    const host = document.createElement('div')
    const inner = document.createElement('span')
    host.appendChild(inner)
    expect(inner.checkVisibility()).toBe(false)
    document.body.appendChild(host)
    expect(inner.checkVisibility()).toBe(true)
    host.hidden = true
    expect(inner.checkVisibility()).toBe(false)
    expect(inner.reportValidity()).toBe(true)
    expect(inner.getContext('2d')).toBeNull()
    inner.scrollIntoView()
    inner.scrollTo({ top: 0 })
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    expect([svg.tagName, svg.namespaceURI]).toEqual(['svg', 'http://www.w3.org/2000/svg'])
    document.visibilityState = 'hidden'
    expect(document.visibilityState).toBe('hidden')
  })
})
