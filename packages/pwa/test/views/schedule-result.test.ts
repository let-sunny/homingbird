import { textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { renderScheduleResult } from '../../src/views/schedule-result.ts'
import { mount, usingFakeDom } from '../support/dom.ts'

usingFakeDom()

const shown = (outcome: 'slot' | 'no_slot') => {
  const host = mount(document.createElement('div'))
  host.append(
    ...(renderScheduleResult({
      kind: 'schedule',
      outcome,
      heading: 'Meeting time',
      lines: ['Friday at ten', 'Ben did not answer.'],
    }) as Node[]),
  )
  return host
}

describe('renderScheduleResult', () => {
  it('shows the heading and the time first, then each line', () => {
    const host = shown('slot')
    expect(textOf(host)).toContain('Meeting time')
    expect(host.querySelector('.schedule-time')?.textContent).toBe('Friday at ten')
    expect(host.querySelectorAll('.schedule-line')).toHaveLength(1)
  })

  it('shows every line of a result with no time as a plain line', () => {
    const host = shown('no_slot')
    expect(host.querySelector('.schedule-time')).toBeNull()
    expect(host.querySelectorAll('.schedule-line')).toHaveLength(2)
  })
})
