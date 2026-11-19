import { lifetime } from '@homingbird/ui'
import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { routeMapSection } from '../../src/views/route-map-view.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { taught } from '../support/fixtures.ts'

usingFakeDom()

describe('routeMapSection', () => {
  it('shows nothing until principles load, then invites teaching', () => {
    const { context } = testContext()
    const shown = routeMapSection(context, lifetime())
    expect(shown.childNodes).toHaveLength(0)
    context.state.taught.set(taught({ debateCredits: ['gap_filled'] }))
    expect(getByRole(shown, 'button', { name: strings.teach.add })).toBeTruthy()
    expect(getByRole(shown, 'heading', { name: strings.routes.debateRooms })).toBeTruthy()
  })

  it('draws a point per place with its legend and table', () => {
    const { context } = testContext()
    const shown = routeMapSection(context, lifetime())
    context.state.taught.set(
      taught({
        routes: [
          { place: 'billing', drafted: 4, principles: 2, heldUp: 1, chances: 2 },
          { place: null, drafted: 1, principles: 0, heldUp: 0, chances: 0 },
        ],
      }),
    )
    const drawing = shown.querySelector('svg')!
    expect(drawing.querySelectorAll('line')).toHaveLength(2)
    expect(drawing.querySelectorAll('rect')).toHaveLength(2)
    expect(textOf(drawing)).toContain(strings.routes.you)
    expect(textOf(shown.querySelector('[data-place="billing"]')!)).toContain(
      strings.routes.chances({ count: 2 }),
    )
    expect(getByRole(shown, 'rowheader', { name: strings.trust.directMessages, hidden: true })).toBeTruthy()
  })
})
