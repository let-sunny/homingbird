import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { commitHeld, holdDecision, undoHeld } from '../../src/tasks/held.ts'
import { testApp } from '../support/app.ts'

describe('a held decision', () => {
  it('runs nothing while held, and once when carried out', async () => {
    const { run, state } = testApp()
    const runs: string[] = []
    await run(holdDecision({ noteId: 'n1' as never, text: 'Sent', run: T.sync(() => void runs.push('n1')) }))
    expect(runs).toEqual([])
    await run(commitHeld)
    await run(commitHeld)
    expect([runs, state.held.get()]).toEqual([['n1'], null])
  })

  it('runs nothing once undone', async () => {
    const { run, state } = testApp()
    const runs: string[] = []
    await run(holdDecision({ noteId: 'n1' as never, text: 'Sent', run: T.sync(() => void runs.push('n1')) }))
    await run(undoHeld)
    await run(commitHeld)
    expect([runs, state.held.get()]).toEqual([[], null])
  })

  it('carries out the one held before when another is held', async () => {
    const { run, state } = testApp()
    const runs: string[] = []
    const held = (id: string) => ({ noteId: id as never, text: id, run: T.sync(() => void runs.push(id)) })
    await run(holdDecision(held('n1')))
    await run(holdDecision(held('n2')))
    expect([runs, state.held.get()?.noteId]).toEqual([['n1'], 'n2'])
  })
})
