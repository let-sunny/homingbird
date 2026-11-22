import { getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { fire } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { browserDocument } from '../../src/page-document.ts'
import { strings } from '../../src/strings.ts'
import { createTour } from '../../src/views/tour.ts'
import { fakePage } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'

usingFakeDom()

const target = (id: string, inHeader = false) => {
  const element = document.createElement('button')
  element.dataset.tour = id
  if (inHeader) {
    const header = document.createElement('header')
    header.className = 'titlebar'
    header.append(element)
    mount(header)
  } else mount(element)
  return element
}

describe('createTour', () => {
  it('starts on home for a first visit only, and steps through the controls', () => {
    const fake = fakePage()
    fake.state.anchors = true
    const tour = createTour(
      fake.page,
      browserDocument(() => document),
    )
    const notes = target('notes')
    const bell = target('activity', true)
    target('connect', true)
    tour.startOnFirstVisit('device', false)
    expect(document.getElementById('tour')).toBeNull()
    tour.startOnFirstVisit('home', false)
    const callout = document.getElementById('tour')!
    expect(textOf(callout)).toContain(strings.tour.notesTitle)
    expect(notes.classList.contains('tour-target')).toBe(true)
    expect(callout.classList.contains('is-anchored')).toBe(true)
    tour.startOnFirstVisit('home', false)
    getByRole(callout, 'button', { name: strings.tour.next }).click()
    expect(textOf(callout)).toContain(strings.tour.approvalTitle)
    expect(bell.classList.contains('tour-target')).toBe(true)
    expect(callout.classList.contains('is-in-header')).toBe(true)
    expect(notes.classList.contains('tour-target')).toBe(false)
    getByRole(callout, 'button', { name: strings.tour.back }).click()
    expect(textOf(callout)).toContain(strings.tour.notesTitle)
    const waiting = target('approval')
    getByRole(callout, 'button', { name: strings.tour.next }).click()
    expect(waiting.classList.contains('tour-target')).toBe(true)
    expect(bell.classList.contains('tour-target')).toBe(false)
    for (let step = 2; step < 6; step++) getByRole(callout, 'button', { name: strings.tour.next }).click()
    getByRole(callout, 'link', { name: strings.tour.connectAction }).click()
    expect(document.getElementById('tour')).toBeNull()
    expect(fake.local.get('homingbird.tour')).toBe('seen')
    tour.startOnFirstVisit('home', false)
    expect(document.getElementById('tour')).toBeNull()
  })

  it('names the place it cannot point at, finishes on the last step, and closes on Escape', () => {
    const fake = fakePage()
    const scrolled: unknown[] = []
    const currentTab = { scrollIntoView: (options: unknown) => void scrolled.push(options) }
    const page = browserDocument(() => document)
    const tour = createTour(fake.page, {
      ...page,
      find: (selector: string) =>
        selector === '.tabs .tab[aria-current="page"]' ? (currentTab as never) : page.find(selector),
    })
    tour.start()
    const callout = document.getElementById('tour')!
    expect(textOf(callout)).toContain(strings.tour.lookFor({ place: strings.conversations }))
    for (let step = 0; step < 5; step++) getByRole(callout, 'button', { name: strings.tour.next }).click()
    getByRole(callout, 'button', { name: strings.tour.done }).click()
    expect(document.getElementById('tour')).toBeNull()
    tour.start()
    fire.key(document.body, 'a')
    fire.key(document.body, 'Escape')
    expect(document.getElementById('tour')).toBeNull()
    expect(scrolled).toEqual([
      { block: 'nearest', inline: 'nearest' },
      { block: 'nearest', inline: 'nearest' },
    ])
  })

  it('moves to a control that appears when the window changes size, and starts again from the profile', () => {
    const fake = fakePage()
    const tour = createTour(
      fake.page,
      browserDocument(() => document),
    )
    tour.start()
    fake.emit('resize')
    const notes = target('notes')
    fake.emit('resize')
    expect(notes.classList.contains('tour-target')).toBe(true)
    tour.start()
    expect(document.querySelectorAll('#tour')).toHaveLength(1)
    getByRole(document.getElementById('tour')!, 'button', { name: strings.tour.skip }).click()
    expect(queryByRole(document.body, 'dialog')).toBeNull()
    expect(fake.listening('resize')).toBe(0)
  })

  it('places the callout for a tab in the phone’s bottom bar beside the tab, not under the header', () => {
    const fake = fakePage()
    fake.state.anchors = true
    const tour = createTour(
      fake.page,
      browserDocument(() => document),
    )
    const channels = target('channels', true)
    const box = (top: number, height: number) => ({
      top,
      left: 0,
      right: 64,
      bottom: top + height,
      width: 64,
      height,
    })
    ;(channels.closest('.titlebar') as HTMLElement).getBoundingClientRect = () => box(0, 56) as DOMRect
    channels.getBoundingClientRect = () => box(760, 52) as DOMRect
    tour.start()
    const callout = document.getElementById('tour')!
    getByRole(callout, 'button', { name: strings.tour.next }).click()
    getByRole(callout, 'button', { name: strings.tour.next }).click()
    expect(channels.classList.contains('tour-target')).toBe(true)
    expect(callout.classList.contains('is-in-header')).toBe(false)
    channels.getBoundingClientRect = () => box(8, 40) as DOMRect
    getByRole(callout, 'button', { name: strings.tour.back }).click()
    getByRole(callout, 'button', { name: strings.tour.next }).click()
    expect(callout.classList.contains('is-in-header')).toBe(true)
  })
})
