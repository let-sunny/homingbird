import { describe, expect, it } from 'vitest'
import { acceptSuggestion, dismissSuggestion, loadSuggestions } from '../../src/tasks/debate-suggestions.ts'
import { testApp } from '../support/app.ts'
import { everything, serverInfo, suggestion } from '../support/fixtures.ts'

describe('the debate suggestion tasks', () => {
  it('load the suggestions, and ask for none while the feature is off', async () => {
    const { run, state, routes } = testApp({
      'debateSuggestions.list': () => ({ suggestions: [suggestion()] }),
    })
    state.serverInfo.set(serverInfo({ debateSuggestions: false }))
    await run(loadSuggestions)
    expect(routes()).toEqual([])
    state.serverInfo.set(everything())
    await run(loadSuggestions)
    expect(state.suggestions.get()).toEqual([suggestion()])
  })

  it('open the flock with the person’s changes, then list the flocks and drop the card', async () => {
    const { run, state, sent } = testApp({
      'debateSuggestions.accept': () => ({ id: 'debate_000000000000' }),
      'debates.list': () => ({ debates: [] }),
    })
    state.suggestions.set([suggestion()])
    const room = await run(
      acceptSuggestion(suggestion().id, { question: 'Ship?', memberIds: suggestion().memberIds }),
    )
    expect(room).toMatchObject({ _tag: 'Ok', value: { id: 'debate_000000000000' } })
    expect(state.suggestions.get()).toEqual([])
    expect(sent.map((one) => one.route)).toEqual(['debateSuggestions.accept', 'debates.list'])
    expect(sent[0]!.request).toEqual({
      params: { id: suggestion().id },
      body: { question: 'Ship?', memberIds: suggestion().memberIds },
    })
  })

  it('answer alone by dropping the card and nothing else', async () => {
    const { run, state, sent } = testApp({ 'debateSuggestions.dismiss': () => ({}) })
    state.suggestions.set([suggestion(), suggestion({ id: 'sugg_111111111111' as never })])
    await run(dismissSuggestion(suggestion().id))
    expect(state.suggestions.get().map((one) => one.id)).toEqual(['sugg_111111111111'])
    expect(sent.map((one) => one.route)).toEqual(['debateSuggestions.dismiss'])
  })
})
