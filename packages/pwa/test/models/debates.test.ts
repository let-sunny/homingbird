import { DEBATE_GRACE_MINUTES, DEFAULT_DEBATE_LIMITS } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { debateListModel, inviteesFor, limitFieldsModel, typedLimits } from '../../src/models/debates.ts'
import { timeShown } from '../../src/models/time.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, entry, summary } from '../support/fixtures.ts'

const awake = { humanOnline: false, agentOnline: true }

describe('debateListModel', () => {
  it('waits for the rooms and says when there are none', () => {
    expect(debateListModel({ debates: [], loaded: false, directory: [], now: 0 })).toEqual({
      kind: 'loading',
    })
    expect(debateListModel({ debates: [], loaded: true, directory: [], now: 0 })).toEqual({
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
    })
    expect(model).toEqual({
      kind: 'rooms',
      rooms: [
        {
          id: 'debate_000000000000',
          className: 'debate-card is-gathering',
          href: '#/debate/debate_000000000000',
          question: 'Ship on Friday?',
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
      const model = debateListModel({ debates: [room], loaded: true, directory, now: 0 })
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

describe('the limit fields', () => {
  it('offers each limit within its bounds and the grace choices, the given ones filled in', () => {
    const model = limitFieldsModel(DEFAULT_DEBATE_LIMITS)
    expect(model.numbers.map((number) => [number.name, number.value])).toEqual([
      ['turnsPerAgent', DEFAULT_DEBATE_LIMITS.turnsPerAgent],
      ['totalTurns', DEFAULT_DEBATE_LIMITS.totalTurns],
      ['minutes', DEFAULT_DEBATE_LIMITS.minutes],
      ['turnCharacters', DEFAULT_DEBATE_LIMITS.turnCharacters],
    ])
    expect(model.numbers[0]).toMatchObject({ label: strings.debates.turnsPerAgent, min: 1, max: 20 })
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
    expect(typedLimits((name) => typed[name])).toEqual({ limits: { ...DEFAULT_DEBATE_LIMITS } })
    const tooMany = { ...typed, turnsPerAgent: '20', totalTurns: '2' }
    expect('problem' in typedLimits((name) => tooMany[name])).toBe(true)
  })
})

describe('inviteesFor', () => {
  it('offers everyone but the person', () => {
    expect(inviteesFor([entry(ANA, 'Ana'), entry(BEN, 'Ben')], ANA)).toEqual([{ value: BEN, label: 'Ben' }])
  })
})
