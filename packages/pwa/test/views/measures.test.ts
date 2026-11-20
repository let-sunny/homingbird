import { allByRole, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { measuresView, renderMeasures } from '../../src/views/measures.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { everything } from '../support/fixtures.ts'

usingFakeDom()

describe('measuresView', () => {
  it('shows a headed list for each audience, from what the server offers', () => {
    const { context } = testContext()
    context.state.serverInfo.set(everything())
    const shown = measuresView(context)
    expect(getByRole(shown, 'heading', { name: strings.measures.pageTitle })).toBeTruthy()
    expect(getByRole(shown, 'heading', { name: strings.measures.youTitle })).toBeTruthy()
    expect(getByRole(shown, 'heading', { name: strings.measures.managersTitle })).toBeTruthy()
    expect(getByRole(shown, 'heading', { name: strings.measures.administratorsTitle })).toBeTruthy()
    expect(allByRole(shown, 'listitem')).toHaveLength(
      Object.keys(strings.measures.you).length +
        Object.keys(strings.measures.managers).length +
        Object.keys(strings.measures.administrators).length,
    )
  })

  it('says when nothing is measured', () => {
    const shown = renderMeasures({ title: 'T', intro: 'I', sections: [], nothing: 'Nothing' })
    expect(textOf(shown)).toContain('Nothing')
    expect(allByRole(shown, 'list')).toHaveLength(0)
  })
})
