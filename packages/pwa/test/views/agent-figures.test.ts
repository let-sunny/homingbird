import { signal } from '@homingbird/ui'
import { getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { figuresModel, labelsTableModel } from '../../src/models/agent-figures.ts'
import { strings } from '../../src/strings.ts'
import { periodChoice, renderFigures, renderLabelsTable } from '../../src/views/agent-figures.ts'
import { usingFakeDom } from '../support/dom.ts'
import { figures, report } from '../support/fixtures.ts'

usingFakeDom()

const host = (child: ReturnType<typeof renderFigures>) => {
  const element = document.createElement('div')
  const append = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(append)
    else if (value !== null && value !== false && value !== undefined) element.append(value as Node)
  }
  append(child)
  return element
}

describe('renderFigures', () => {
  it('shows loading and a failure', () => {
    expect(textOf(host(renderFigures(figuresModel(null, 7))))).toBe(strings.loading)
    expect(getByRole(host(renderFigures(figuresModel('failed', 7))), 'alert').textContent).toBe(
      strings.trust.loadFailed,
    )
  })

  it('shows the verdict, the numbers, skips, labels, trend and what is measured', () => {
    const current = figures({
      sentAsWritten: 9,
      sentAfterEdits: 1,
      verdict: 'usually_as_written',
      quickApprovalsFrequent: true,
      skipped: 1,
      skipReasons: [{ reason: 'Out of scope', count: 1 }],
      byClient: [{ label: 'Desk', written: 1, sentAsWritten: 1, sentAfterEdits: 0, discarded: 0 }],
    } as never)
    const shown = host(
      renderFigures(
        figuresModel(
          report({
            periods: [{ days: 7, current, previous: figures({ sentAsWritten: 1, discarded: 1 }) }],
            weeks: [
              { start: 1, decided: 4, sentAsWritten: 3 },
              { start: 2, decided: 0, sentAsWritten: 0 },
            ],
          }),
          7,
        ),
      ),
    )
    expect(getByRole(shown, 'heading', { name: strings.trust.verdict.usually_as_written })).toBeTruthy()
    expect(getByRole(shown, 'note').textContent).toContain(strings.trust.nudge)
    expect(getByRole(shown, 'table', { name: strings.trust.caption({ days: 7 }) })).toBeTruthy()
    expect(textOf(shown)).toContain(strings.trust.skipReason({ reason: 'Out of scope', count: 1 }))
    expect(getByRole(shown, 'heading', { name: strings.trust.byClientTitle })).toBeTruthy()
    expect(shown.querySelectorAll('.trend-week')).toHaveLength(2)
    expect(shown.querySelector('.trend-week.is-empty')).not.toBeNull()
    expect(textOf(shown)).toContain(strings.trust.measuredPrivacy)
  })

  it('says no reason was given for skips, and shows a quiet week without its parts', () => {
    const shown = host(
      renderFigures(
        figuresModel(
          report({ periods: [{ days: 7, current: figures({ skipped: 2 }), previous: figures() }] }),
          7,
        ),
      ),
    )
    expect(textOf(shown)).toContain(strings.trust.noSkipReasons)
    expect(queryByRole(shown, 'note')).toBeNull()
  })
})

describe('periodChoice', () => {
  it('sets the period chosen', () => {
    const days = signal(7)
    const shown = periodChoice('period', days)
    getByRole(shown, 'radio', { name: strings.trust.lastDays({ days: 30 }) }).click()
    expect(days.get()).toBe(30)
  })
})

describe('renderLabelsTable', () => {
  it('shows nothing without rows, and a row per label with its full name as a title', () => {
    expect(renderLabelsTable(null)).toBeNull()
    const shown = renderLabelsTable(
      labelsTableModel(
        'labels',
        'By client',
        [{ label: 'Desk', written: 1, sentAsWritten: 1, sentAfterEdits: 0, discarded: 0 }],
        '?',
      ),
    )!
    expect(getByRole(shown, 'rowheader', { name: 'Desk' }).getAttribute('title')).toBe('Desk')
  })
})
