import { lifetime } from '@homingbird/ui'
import { getByRole } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { USUAL_LOAD_SECONDS } from '../../src/load-timing.ts'
import { strings } from '../../src/strings.ts'
import { workspaceLine } from '../../src/views/workspace-line.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { setWorkspace } from '../support/resource-load.ts'

usingFakeDom()

describe('workspaceLine', () => {
  it('is silent while the workspace loads as usual, notes slowness, then offers Try again, and goes once it has loaded', () => {
    const { context, called } = testContext()
    const shown = mount(workspaceLine(context, lifetime()))
    expect(shown.querySelector('.load-line')).toBeNull()
    setWorkspace(context.state, 'slow')
    expect(shown.querySelector('.load-line')?.textContent).toBe(
      strings.firstLoad.usually({ count: USUAL_LOAD_SECONDS }),
    )
    expect(shown.querySelector('button')).toBeNull()
    setWorkspace(context.state, 'long')
    expect(shown.querySelector('.load-line')?.textContent).toContain(strings.firstLoad.tooLong)
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(called('startAgain')).toHaveLength(1)
    setWorkspace(context.state, 'loaded')
    expect(shown.querySelector('.load-line')).toBeNull()
  })

  it('says what a refusal was rather than that the server could not be reached', () => {
    const { context } = testContext()
    const shown = mount(workspaceLine(context, lifetime()))
    setWorkspace(context.state, 'failed', { _tag: 'Forbidden', message: 'Not allowed.' })
    expect(shown.querySelector('.load-line')?.textContent).toContain('Not allowed.')
    setWorkspace(context.state, 'failed')
    expect(shown.querySelector('.load-line')?.textContent).toContain(strings.firstLoad.failed)
  })
})
