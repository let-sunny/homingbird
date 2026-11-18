import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { presenceShown } from '../src/presence.ts'
import { strings } from '../src/strings.ts'

describe('presenceShown', () => {
  it('reads "Person online · Agent not awake" in words where the agent’s status is in words', () => {
    const shown = presenceShown({ humanOnline: true, agentOnline: false }, true)
    expect([shown.person.words, shown.agent.words]).toEqual([strings.humanOnline, strings.agentOffline])
    expect([shown.person.words, shown.agent.words]).toEqual(['Person online', 'Agent not awake'])
  })

  it('keeps narrow rows to the person’s dot, labelled for screen readers, and the agent only when online', () => {
    const away = presenceShown({ humanOnline: false, agentOnline: false }, false)
    expect(away.person).toEqual({ isOn: false, label: strings.humanOffline, words: null })
    expect(away.agent.words).toBeNull()
    expect(presenceShown({ humanOnline: false, agentOnline: true }, false).agent.words).toBe(
      strings.agentOnline,
    )
  })

  it('never shows a state by colour alone: in words, both states always carry words', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (humanOnline, agentOnline) => {
        const shown = presenceShown({ humanOnline, agentOnline }, true)
        expect(shown.person.words).toBe(humanOnline ? strings.humanOnline : strings.humanOffline)
        expect(shown.agent.words).toBe(agentOnline ? strings.agentOnline : strings.agentOffline)
        expect(shown.person.label).toBe(shown.person.words)
      }),
    )
  })
})
