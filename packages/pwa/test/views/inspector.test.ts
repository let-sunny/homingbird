import { makeTestClock } from '@homingbird/kernel'
import { lifetime } from '@homingbird/ui'
import { allByRole, fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import type { CodeName } from '../../src/inspector/code-name.ts'
import { createRecording } from '../../src/inspector/recording.ts'
import { inspectorWords } from '../../src/inspector/words.ts'
import { inspectorPanel } from '../../src/views/inspector.ts'
import { fakePage } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'

usingFakeDom()

const words = inspectorWords('en')

const setUp = () => {
  const clock = makeTestClock(0)
  const page = fakePage()
  const recording = createRecording(clock)
  const asked: string[] = []
  const watch = recording.watch('debates' as CodeName, () => ({
    inside: { running: true, resting: false, queued: false, patches: 0, attempts: 1, items: 2 },
    load: { loaded: true, step: 'failed', error: null },
  }))
  const life = lifetime()
  const panel = mount(
    inspectorPanel(life, {
      recording,
      words,
      locale: 'en',
      page: page.page,
      clock,
      canAsk: () => true,
      again: (path) => void asked.push(`again ${path}`),
      invalidate: (path) => void asked.push(`invalidate ${path}`),
      turnOff: () => void asked.push('off'),
    }),
  )
  const toggle = (open: boolean): void => {
    panel.toggleAttribute('open', open)
    fire.event(panel, 'toggle')
  }
  const lines = (): string[] => allByRole(panel, 'listitem').map((line) => textOf(line))
  return { clock, page, recording, asked, watch, life, panel, toggle, lines }
}

describe('inspectorPanel', () => {
  it('says how many requests run while closed, and draws nothing more', () => {
    const { panel, watch, page, lines } = setUp()
    watch.moved('opened')
    page.runFrames()
    expect(textOf(panel.querySelector('summary')!)).toBe('Loads, 1 running')
    expect(lines()).toEqual([])
  })

  it('shows the lists and the timeline once opened, and follows both by the frame', () => {
    const { panel, watch, page, toggle, lines } = setUp()
    toggle(true)
    expect(lines()).toEqual([words.nothing])
    const row = allByRole(panel, 'row')[1]!
    expect(row.classList.contains('is-failed')).toBe(true)
    expect(textOf(row)).toContain('Failed')
    const again = getByRole(panel, 'button', { name: 'Again: debates' })
    watch.moved('asked')
    watch.moved('answered')
    expect(lines()).toHaveLength(1)
    page.runFrames()
    expect(lines()).toHaveLength(2)
    expect(getByRole(panel, 'button', { name: 'Again: debates' })).toBe(again)
  })

  it('counts the ages on each second while open, and stops when closed or replaced', async () => {
    const { panel, watch, clock, toggle, life } = setUp()
    watch.moved('answered')
    toggle(true)
    await clock.advance(3000)
    expect(textOf(panel)).toContain('3 sec ago')
    toggle(false)
    await clock.advance(0)
    expect(clock.pending()).toBe(0)
    toggle(true)
    life.end()
    await clock.advance(0)
    expect(clock.pending()).toBe(0)
  })

  it('narrows the timeline by kind, by name and to failures', () => {
    const { panel, watch, recording, toggle, lines } = setUp()
    watch.moved('failed', { _tag: 'Forbidden' })
    recording.asked('notes.list' as CodeName)('ok', 200)
    toggle(true)
    fire.select(getByRole(panel, 'combobox', { name: words.kindFilter }), 'request')
    expect(lines()).toHaveLength(1)
    fire.select(getByRole(panel, 'combobox', { name: words.kindFilter }), 'all')
    fire.type(getByRole(panel, 'searchbox', { name: words.nameFilter }), 'deb')
    expect(lines()).toHaveLength(1)
    fire.type(getByRole(panel, 'searchbox', { name: words.nameFilter }), '')
    const failures = getByRole(panel, 'checkbox', { name: words.failuresOnly }) as HTMLInputElement
    failures.checked = true
    fire.event(failures, 'change')
    expect(lines()).toHaveLength(1)
    expect(panel.querySelector('li.is-failed')).not.toBeNull()
  })

  it('asks, exports, clears and turns off by its buttons', () => {
    const { panel, watch, page, recording, asked, toggle } = setUp()
    watch.moved('opened')
    toggle(true)
    for (const name of ['Again: debates', 'Invalidate: debates', words.exportIt, words.clear, words.turnOff])
      getByRole(panel, 'button', { name }).click()
    expect(asked).toEqual(['again debates', 'invalidate debates', 'off'])
    expect(page.downloads).toHaveLength(1)
    expect(JSON.parse(page.downloads[0]!.text).timeline).toHaveLength(1)
    expect(recording.snapshot().timeline).toEqual([])
  })
})
