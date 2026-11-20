import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { renderYourWeek } from '../../src/views/your-week.ts'
import { usingFakeDom } from '../support/dom.ts'

usingFakeDom()

describe('renderYourWeek', () => {
  it('draws a headed block with each figure beside its label', () => {
    const shown = renderYourWeek({
      title: 'Your week',
      intro: 'Intro',
      rows: [{ label: 'Notes you sent', value: '12 (before: 3)' }],
      footnote: 'Footnote',
    })!
    expect(getByRole(shown, 'heading', { name: 'Your week' })).toBeTruthy()
    expect(shown.querySelector('dt')?.textContent).toBe('Notes you sent')
    expect(shown.querySelector('dd')?.textContent).toBe('12 (before: 3)')
    expect(textOf(shown)).toContain('Footnote')
  })

  it('draws nothing without a week', () => {
    expect(renderYourWeek(null)).toBeNull()
  })
})
