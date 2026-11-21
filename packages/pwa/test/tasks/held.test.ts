import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { heldWordsFor } from '../../src/held-decisions.ts'
import type { HeldDecision } from '../../src/state.ts'
import { strings } from '../../src/strings.ts'
import {
  commitHeld,
  forgetSettled,
  holdDecision,
  keepDraftEdit,
  reportUnsettled,
  undoHeld,
} from '../../src/tasks/held.ts'
import { keptUnsettled } from '../../src/unsettled-decisions.ts'
import { fail, testApp } from '../support/app.ts'
import { ANA, ROOM, draft, me } from '../support/fixtures.ts'

const decision = (
  id: string,
  run: HeldDecision['run'],
  fields: Partial<Omit<HeldDecision, 'phase'>> = {},
): Omit<HeldDecision, 'phase'> => ({
  noteId: id as never,
  conversationId: ROOM,
  kind: 'send',
  review: false,
  settles: 1,
  words: heldWordsFor('Ben').send,
  run,
  ...fields,
})

const signedInApp = (handlers: Parameters<typeof testApp>[0] = {}) => {
  const app = testApp(handlers)
  app.state.session.set(me())
  return app
}

describe('a held decision', () => {
  it('runs nothing while held, then once when carried out, and says so until it is let go', async () => {
    const { run, state } = signedInApp()
    const runs: string[] = []
    await run(
      holdDecision(
        decision(
          'n1',
          T.sync(() => void runs.push('n1')),
        ),
      ),
    )
    expect([runs, state.held.get().map((one) => one.phase)]).toEqual([[], ['waiting']])
    await run(commitHeld)
    await run(commitHeld)
    expect([runs, state.held.get().map((one) => one.phase)]).toEqual([['n1'], ['done']])
    await run(forgetSettled)
    expect(state.held.get()).toEqual([])
  })

  it('stays in place as on its way while the server is asked, and comes back when refused', async () => {
    const { run, state } = signedInApp()
    const phases: string[] = []
    const asked = T.sync(() => void phases.push(state.held.get()[0]!.phase))
    await run(holdDecision(decision('n1', asked)))
    await run(commitHeld)
    expect(phases).toEqual(['committing'])
    await run(holdDecision(decision('n2', T.fail({ _tag: 'Conflict' } as never))))
    const refused = await run(commitHeld)
    expect(refused._tag).toBe('Err')
    expect(state.held.get().map((one) => one.noteId)).toEqual([])
  })

  it('runs nothing once undone', async () => {
    const { run, state } = signedInApp()
    const runs: string[] = []
    await run(
      holdDecision(
        decision(
          'n1',
          T.sync(() => void runs.push('n1')),
        ),
      ),
    )
    await run(undoHeld)
    await run(undoHeld)
    await run(commitHeld)
    expect([runs, state.held.get()]).toEqual([[], []])
  })

  it('carries out the one held before when another is held, and keeps one decision per draft', async () => {
    const { run, state } = signedInApp()
    const runs: string[] = []
    const held = (id: string) =>
      decision(
        id,
        T.sync(() => void runs.push(id)),
      )
    await run(holdDecision(held('n1')))
    await run(holdDecision(held('n2')))
    expect([runs, state.held.get().map((one) => [one.noteId, one.phase])]).toEqual([
      ['n1'],
      [
        ['n1', 'done'],
        ['n2', 'waiting'],
      ],
    ])
    await run(holdDecision(held('n2')))
    expect(state.held.get().map((one) => [one.noteId, one.phase])).toEqual([['n2', 'waiting']])
  })

  it('is kept in this browser until the server answers or it is undone', async () => {
    const { run, page } = signedInApp()
    const kept = () => keptUnsettled(page.page.storage, ANA).map((one) => one.noteId)
    await run(holdDecision(decision('n1', T.unit)))
    expect(kept()).toEqual(['n1'])
    await run(commitHeld)
    expect(kept()).toEqual([])
    await run(holdDecision(decision('n2', T.unit)))
    await run(undoHeld)
    expect(kept()).toEqual([])
  })

  it('keeps nothing in the browser for nobody signed in', async () => {
    const { run, page, state } = testApp()
    await run(holdDecision(decision('n1', T.unit)))
    await run(commitHeld)
    await run(holdDecision(decision('n2', T.unit)))
    await run(undoHeld)
    expect(page.local.size).toBe(0)
    expect(state.held.get()).toEqual([])
  })

  it('lets a card’s kept edit go once the decision on it is carried out', async () => {
    const { run, state } = signedInApp()
    await run(keepDraftEdit('n1' as never, 'agent text', 'my text'))
    await run(holdDecision(decision('n1', T.unit)))
    expect(state.draftEdits.get().get('n1' as never)).toBe('my text')
    await run(commitHeld)
    expect(state.draftEdits.get().size).toBe(0)
  })
})

describe('a decision the page never saw carried out', () => {
  it('says on the next load that a draft still waiting was not sent, and forgets it', async () => {
    const { run, state, page } = signedInApp({
      'notes.get': ({ params }) => draft(params.id, { status: params.id === 'n1' ? 'sent' : 'draft' }),
    })
    await run(holdDecision(decision('n1', T.unit)))
    await run(holdDecision(decision('n2', T.unit, { words: heldWordsFor('Cy').send })))
    await run(reportUnsettled)
    expect(state.notice.get()).toEqual({ kind: 'error', text: heldWordsFor('Cy').send.notDone })
    expect(keptUnsettled(page.page.storage, ANA)).toEqual([])
  })

  it('tells of an answer only while it still waits for review, and of nothing the server cannot find', async () => {
    const { run, state } = signedInApp({ 'notes.get': () => fail({ _tag: 'NotFound' } as never) })
    await run(holdDecision(decision('gone', T.unit)))
    await run(
      holdDecision(
        decision('a1', T.unit, { review: true, kind: 'discard', words: heldWordsFor('x').discard }),
      ),
    )
    await run(reportUnsettled)
    expect(state.notice.get()).toBeNull()
    await run(
      holdDecision(
        decision('a1', T.unit, { review: true, kind: 'discard', words: heldWordsFor('x').discard }),
      ),
    )
    state.reviews.set([{ note: draft('a1') } as never])
    await run(reportUnsettled)
    expect(state.notice.get()).toEqual({ kind: 'error', text: strings.heldNotDiscarded })
  })

  it('does nothing for nobody signed in', async () => {
    const { run, state } = testApp()
    await run(reportUnsettled)
    expect(state.notice.get()).toBeNull()
  })
})

describe('a kept edit', () => {
  it('is kept per card, and let go once it is the text again or empty', async () => {
    const { run, state } = testApp()
    await run(keepDraftEdit('n1' as never, 'agent text', 'my text'))
    const kept = state.draftEdits.get()
    await run(keepDraftEdit('n1' as never, 'agent text', 'my text'))
    expect(state.draftEdits.get()).toBe(kept)
    await run(keepDraftEdit('n2' as never, 'agent text', 'other'))
    expect([...state.draftEdits.get()]).toEqual([
      ['n1', 'my text'],
      ['n2', 'other'],
    ])
    await run(keepDraftEdit('n1' as never, 'agent text', 'agent text'))
    await run(keepDraftEdit('n2' as never, 'agent text', '  '))
    expect(state.draftEdits.get().size).toBe(0)
  })
})
