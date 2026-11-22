import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  deskUnavailableReason,
  presenceMarks,
  presenceShown,
  theirAgentUnavailable,
  unavailableOf,
} from '../src/presence.ts'
import { formats, strings } from '../src/strings.ts'

describe('presenceShown', () => {
  it('reads "Person online · Agent not awake" in words where the agent’s status is in words', () => {
    const shown = presenceShown({ humanOnline: true, agentOnline: false }, true)
    expect([shown.person.words, shown.agent.words]).toEqual([strings.humanOnline, strings.agentOffline])
    expect([shown.person.words, shown.agent.words]).toEqual(['Person online', 'Agent not awake'])
  })

  it('keeps narrow rows to the person’s dot, labelled for screen readers, and the agent only when online', () => {
    const away = presenceShown({ humanOnline: false, agentOnline: false }, false)
    expect(away.person).toEqual({
      isOn: false,
      label: strings.humanOffline,
      title: strings.theirPresence.awayHint,
      words: null,
    })
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

describe('what each presence means', () => {
  it('says what a colleague’s state means, never just its own label again', () => {
    const away = presenceShown({ humanOnline: false, agentOnline: false }, true)
    expect(away.agent.title).toBe(strings.agentOfflineHint)
    expect(away.agent.title).not.toBe(away.agent.words)
    expect(presenceShown({ humanOnline: true, agentOnline: true }, true).person.title).toBe(
      strings.theirPresence.onlineHint,
    )
  })

  it('names the person and their own agent on their own Connection', () => {
    const awake = presenceShown({ humanOnline: true, agentOnline: true }, true, 'mine')
    expect([awake.person.words, awake.agent.words]).toEqual(['You: online', 'Your agent: awake'])
    expect([awake.person.title, awake.agent.title]).toEqual([
      strings.selfPresence.onlineHint,
      strings.selfPresence.agentOnlineHint,
    ])
    const asleep = presenceShown({ humanOnline: false, agentOnline: false }, false, 'mine')
    expect([asleep.person.label, asleep.agent.words, asleep.agent.title]).toEqual([
      strings.selfPresence.away,
      strings.selfPresence.agentOffline,
      strings.selfPresence.agentOfflineHint,
    ])
    expect(asleep.person.title).toBe(strings.selfPresence.awayHint)
  })
})

describe('an agent that cannot answer', () => {
  it('reads "can’t answer right now" while its desk runs, with the time when known, and never as awake', () => {
    const now = presenceShown(
      { humanOnline: true, agentOnline: true, agentUnavailable: { until: null } },
      false,
    )
    expect(now.agent).toEqual({
      isOn: false,
      title: strings.agentUnavailableHint,
      words: strings.agentUnavailable,
    })
    const until = new Date(2026, 10, 21, 15, 0).getTime()
    const later = presenceShown({ humanOnline: true, agentOnline: true, agentUnavailable: { until } }, true)
    expect(later.agent.words).toBe(
      strings.agentUnavailableUntil({ time: formats.time.format(new Date(until)) }),
    )
  })

  it('falls back to "not awake" once the desk itself stopped', () => {
    const stopped = presenceShown(
      { humanOnline: true, agentOnline: false, agentUnavailable: { until: null } },
      true,
    )
    expect(stopped.agent.words).toBe(strings.agentOffline)
    expect(
      unavailableOf({ humanOnline: true, agentOnline: false, agentUnavailable: { until: null } }),
    ).toBeNull()
    expect(theirAgentUnavailable(undefined)).toBeNull()
    expect(deskUnavailableReason(null)).toEqual([])
  })
})

describe('presenceMarks', () => {
  it('names whose each mark is: the colleague and the colleague’s agent', () => {
    expect(presenceMarks({ humanOnline: true, agentOnline: true }, 'Kai')).toEqual({
      person: { isOn: true, label: strings.presenceOf.online({ name: 'Kai' }) },
      agent: { state: 'on', label: strings.presenceOf.agentAwake({ name: 'Kai' }) },
      words: 'Online · agent awake',
    })
    expect(presenceMarks({ humanOnline: false, agentOnline: false }, 'Kai')).toEqual({
      person: { isOn: false, label: strings.presenceOf.away({ name: 'Kai' }) },
      agent: { state: 'off', label: strings.presenceOf.agentAsleep({ name: 'Kai' }) },
      words: 'Away · agent not awake',
    })
  })

  it('says when the colleague’s running agent cannot answer, and until when if known', () => {
    const until = presenceMarks(
      { humanOnline: false, agentOnline: true, agentUnavailable: { until: 0 } },
      'Kai',
    ).agent
    expect(until.state).toBe('unavailable')
    expect(until.label).toBe(
      strings.presenceOf.agentUnavailableUntil({ name: 'Kai', time: formats.time.format(new Date(0)) }),
    )
    expect(
      presenceMarks({ humanOnline: false, agentOnline: true, agentUnavailable: { until: null } }, 'Kai')
        .agent,
    ).toEqual({ state: 'unavailable', label: strings.presenceOf.agentUnavailable({ name: 'Kai' }) })
    expect(
      presenceMarks({ humanOnline: false, agentOnline: true, agentUnavailable: { until: null } }, 'Kai')
        .words,
    ).toBe('Away · agent can’t answer now')
  })
})
