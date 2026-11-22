import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { timeShown } from '../../src/models/time.ts'
import { strings } from '../../src/strings.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { renderDraftsBehind } from '../../src/views/drafts-behind.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'

usingFakeDom()

describe('renderDraftsBehind', () => {
  it('folds each count into its rows, and teaches from one with its channel chosen', () => {
    const { context } = testContext()
    mount(dialogHost())
    const shown = mount(
      renderDraftsBehind(context, {
        title: 'Behind',
        intro: 'Each one.',
        groups: [
          {
            outcome: 'edited',
            title: 'Edited, then sent: 1',
            rows: [
              {
                key: 'edited:note_a',
                place: '#billing',
                time: timeShown(0, 0),
                href: '#/c/conv_a?note=note_a',
                open: strings.teach.openConversation,
                teach: strings.teach.add,
                seed: { topic: '', place: 'billing' },
              },
            ],
          },
        ],
      })!,
    )
    expect(textOf(shown.querySelector('summary')!)).toBe('Edited, then sent: 1')
    shown.querySelector('details')!.setAttribute('open', '')
    expect(getByRole(shown, 'link', { name: strings.teach.openConversation }).getAttribute('href')).toBe(
      '#/c/conv_a?note=note_a',
    )
    getByRole(shown, 'button', { name: strings.teach.add }).click()
    expect(document.querySelector<HTMLSelectElement>('dialog select[name="place"]')?.value).toBe('billing')
    expect(renderDraftsBehind(context, null)).toBeNull()
  })
})
