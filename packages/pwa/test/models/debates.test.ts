import { DEBATE_GRACE_MINUTES, DEFAULT_DEBATE_LIMITS } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { debateListModel, limitFieldsModel, typedLimits } from '../../src/models/debates.ts'
import { timeShown } from '../../src/models/time.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, entry, summary } from '../support/fixtures.ts'

const awake = { humanOnline: false, agentOnline: true }

describe('debateListModel', () => {
  it('waits for the rooms and says when there are none', () => {
    expect(
      debateListModel({ debates: [], loaded: false, directory: [], now: 0, schedulingOn: false }),
    ).toEqual({
      kind: 'loading',
    })
    expect(
      debateListModel({ debates: [], loaded: true, directory: [], now: 0, schedulingOn: false }),
    ).toEqual({
      kind: 'empty',
      text: strings.debates.empty,
    })
  })

  it('shows each room with its stage, privacy, counts and when it opened', () => {
    const model = debateListModel({
      debates: [summary({ visibility: 'private', participantIds: [ANA], turnCount: 0 })],
      loaded: true,
      directory: [],
      now: 10,
      schedulingOn: false,
    })
    expect(model).toEqual({
      kind: 'rooms',
      rooms: [
        {
          id: 'debate_000000000000',
          className: 'debate-card is-gathering',
          href: '#/debate/debate_000000000000',
          question: 'Ship on Friday?',
          kind: null,
          stage: strings.debates.stage.gathering,
          isPrivate: true,
          counts: [
            strings.debates.agentCount({ count: 1 }),
            strings.debates.turnProgress({ count: 0, total: 4 }),
          ],
          time: timeShown(1, 10),
        },
      ],
    })
  })

  it('says agents are debating only while an agent taking part is awake to take a turn', () => {
    const room = summary({ participantIds: [ANA, BEN], turnCount: 3 })
    const stageWith = (directory: ReturnType<typeof entry>[]) => {
      const model = debateListModel({ debates: [room], loaded: true, directory, now: 0, schedulingOn: false })
      return model.kind === 'rooms' ? [model.rooms[0]!.stage, model.rooms[0]!.className] : []
    }
    expect(stageWith([entry(BEN, 'Ben', { presence: awake })])).toEqual([
      strings.debates.stage.debating,
      'debate-card is-debating',
    ])
    expect(stageWith([entry(ANA, 'Ana'), entry(BEN, 'Ben'), entry(CY, 'Cy', { presence: awake })])).toEqual([
      strings.debates.stage['waiting-for-agent'],
      'debate-card is-waiting-for-agent',
    ])
    expect(stageWith([])).toEqual([
      strings.debates.stage['waiting-for-agent'],
      'debate-card is-waiting-for-agent',
    ])
  })
})

describe('debateListModel with scheduling rooms', () => {
  const meeting = summary({ type: 'scheduling', status: 'open', participantIds: [ANA, BEN], turnCount: 1 })
  const listed = (status: 'open' | 'closed' | 'ended' | 'unknown', schedulingOn = true) => {
    const model = debateListModel({
      debates: [{ ...meeting, status }],
      loaded: true,
      directory: [],
      now: 0,
      schedulingOn,
    })
    return model.kind === 'rooms' ? model.rooms[0]! : model
  }

  it('shows a scheduling room as one, in its own stages and without turn counts', () => {
    expect(listed('open')).toMatchObject({
      className: 'debate-card is-collecting',
      kind: strings.scheduling.kind,
      stage: strings.scheduling.stage.collecting,
      counts: [],
    })
    expect(
      (['closed', 'ended', 'unknown'] as const).map((status) => (listed(status) as { stage: string }).stage),
    ).toEqual([
      strings.scheduling.stage.settled,
      strings.scheduling.stage.ended,
      strings.scheduling.stage.unknown,
    ])
  })

  it('says a scheduling room that settled with no common time found none', () => {
    const none = debateListModel({
      debates: [{ ...meeting, status: 'closed', outcome: 'no_slot' }],
      loaded: true,
      directory: [],
      now: 0,
      schedulingOn: true,
    })
    expect(none.kind === 'rooms' && none.rooms[0]).toMatchObject({
      className: 'debate-card is-no_slot',
      stage: strings.scheduling.stage.no_slot,
    })
  })

  it('leaves scheduling rooms out while the feature is off', () => {
    expect(listed('open', false)).toEqual({ kind: 'empty', text: strings.debates.empty })
  })
})

describe('the limit fields', () => {
  it('offers each limit within its bounds and the grace choices, the given ones filled in', () => {
    const model = limitFieldsModel(DEFAULT_DEBATE_LIMITS)
    expect(model.numbers.map((number) => [number.name, number.value, number.required])).toEqual([
      ['turnsPerAgent', DEFAULT_DEBATE_LIMITS.turnsPerAgent, true],
      ['totalTurns', null, false],
      ['minutes', DEFAULT_DEBATE_LIMITS.minutes, true],
      ['turnCharacters', DEFAULT_DEBATE_LIMITS.turnCharacters, true],
    ])
    expect(model.numbers[0]).toMatchObject({ label: strings.debates.turnsPerAgent, min: 1, max: 4 })
    expect(model.hints).toEqual([strings.debates.totalTurnsHint, strings.debates.minutesHint])
    const room = { ...DEFAULT_DEBATE_LIMITS, totalTurns: 9 }
    expect(limitFieldsModel({ ...room, totalFollowsAgents: true }).numbers[1]!.value).toBeNull()
    expect(limitFieldsModel({ ...room, totalFollowsAgents: false }).numbers[1]!.value).toBe(9)
    expect(model.grace.map((choice) => choice.value)).toEqual([...DEBATE_GRACE_MINUTES])
    expect(model.grace.filter((choice) => choice.selected)).toHaveLength(1)
  })

  it('reads what was typed into limits, or the reason they cannot be used', () => {
    const typed = {
      turnsPerAgent: '3',
      totalTurns: '9',
      minutes: '60',
      turnCharacters: '1200',
      graceMinutes: '',
    }
    expect(typedLimits((name) => typed[name])).toEqual({
      limits: { ...DEFAULT_DEBATE_LIMITS, totalTurns: 9 },
    })
    expect(typedLimits((name) => ({ ...typed, totalTurns: '' })[name])).toEqual({
      limits: { ...DEFAULT_DEBATE_LIMITS },
    })
    const tooMany = { ...typed, turnsPerAgent: '4', totalTurns: '2' }
    expect('problem' in typedLimits((name) => tooMany[name])).toBe(true)
  })
})
