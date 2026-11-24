import { lifetime } from '@homingbird/ui'
import { getByRole } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { USUAL_LOAD_SECONDS } from '../../src/load-timing.ts'
import { strings } from '../../src/strings.ts'
import { workspaceLine } from '../../src/views/workspace-line.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'

usingFakeDom()

describe('workspaceLine', () => {
  it('is silent while the workspace loads as usual, notes slowness, then offers Try again, and goes once it has loaded', () => {
    const { context, called } = testContext()
    const shown = mount(workspaceLine(context, lifetime()))
    expect(shown.querySelector('.load-line')).toBeNull()
    context.state.workspace.set('slow')
    expect(shown.querySelector('.load-line')?.textContent).toBe(
      strings.firstLoad.usually({ count: USUAL_LOAD_SECONDS }),
    )
    expect(shown.querySelector('button')).toBeNull()
    context.state.workspace.set('long')
    expect(shown.querySelector('.load-line')?.textContent).toContain(strings.firstLoad.tooLong)
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(called('startAgain')).toHaveLength(1)
    context.state.workspace.set('loaded')
    expect(shown.querySelector('.load-line')).toBeNull()
  })

  it('says what a refusal was rather than that the server could not be reached', () => {
    const { context } = testContext()
    const shown = mount(workspaceLine(context, lifetime()))
    context.state.workspaceRefusal.set('Not allowed.')
    context.state.workspace.set('failed')
    expect(shown.querySelector('.load-line')?.textContent).toContain('Not allowed.')
    context.state.workspaceRefusal.set('')
    expect(shown.querySelector('.load-line')?.textContent).toContain(strings.firstLoad.failed)
  })
})
