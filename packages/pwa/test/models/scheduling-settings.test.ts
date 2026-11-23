import { DEFAULT_SCHEDULING_DELEGATION, type SchedulingDelegation } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { delegationFrom, schedulingSettingsModel } from '../../src/models/scheduling-settings.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, credential, entry, me } from '../support/fixtures.ts'

const AGENT = 'cred_agent0000000'
const OTHER = 'cred_other0000000'
const agents = [credential(AGENT, { name: 'Desk agent' }), credential(OTHER, { name: 'Laptop agent' })]
const directory = [entry(CY, 'Cy'), entry(BEN, 'Ben'), entry(ANA, 'Ana')]

const ready = (
  delegation: SchedulingDelegation,
  agentInUse: string | null = AGENT,
  timeZone = 'Asia/Seoul',
) => {
  const model = schedulingSettingsModel({
    me: me(),
    view: { delegation, agentInUse: agentInUse as never },
    agents,
    directory,
    timeZone,
  })
  if (model.kind !== 'ready') throw new Error('expected a ready model')
  return model
}

describe('schedulingSettingsModel', () => {
  it('says it is on with no limit, and which agent does it', () => {
    const model = ready(DEFAULT_SCHEDULING_DELEGATION)
    expect(model.summary).toEqual([strings.scheduling.delegation.summary.both])
    expect(model.join.checked).toBe(true)
    expect(model.add.checked).toBe(true)
    expect(model.agentLine).toBe(strings.scheduling.delegation.agentInUse({ name: 'Desk agent' }))
    expect(model.agentChoices.map((choice) => [choice.label, choice.selected])).toEqual([
      [strings.scheduling.delegation.agentAutomatic, true],
      ['Desk agent', false],
      ['Laptop agent', false],
    ])
    expect(model.people).toMatchObject({ limited: false })
    expect(model.people.choices.map((choice) => choice.label)).toEqual(['Ben', 'Cy'])
    expect(model.hours).toMatchObject({ limited: false, from: '09:00', to: '18:00' })
    expect(model.hours.zoneNote).toBe(strings.scheduling.delegation.hoursZone({ timeZone: 'Asia/Seoul' }))
    expect(model.maxMinutes.limited).toBe(false)
    expect(model.maxMinutes.choices.find((choice) => choice.selected)!.value).toBe(60)
  })

  it('says what each combination does, and that limits apply only while something is on', () => {
    const base = DEFAULT_SCHEDULING_DELEGATION
    const scope = { people: [BEN], hours: null, maxMinutes: null }
    expect(ready({ ...base, autoAdd: false }).summary[0]).toBe(strings.scheduling.delegation.summary.joinOnly)
    expect(ready({ ...base, autoJoin: false }).summary[0]).toBe(strings.scheduling.delegation.summary.addOnly)
    expect(ready({ ...base, autoJoin: false, autoAdd: false, scope }).summary).toEqual([
      strings.scheduling.delegation.summary.neither,
    ])
    expect(ready({ ...base, scope }).summary).toEqual([
      strings.scheduling.delegation.summary.both,
      strings.scheduling.delegation.limited,
    ])
  })

  it('shows the limits that are saved, with a length outside the usual choices', () => {
    const model = ready(
      {
        ...DEFAULT_SCHEDULING_DELEGATION,
        agentId: OTHER as never,
        scope: { people: [BEN], hours: { from: 570, to: 60, timeZone: 'Europe/Paris' }, maxMinutes: 50 },
      },
      OTHER,
    )
    expect(model.agentLine).toBe(strings.scheduling.delegation.agentInUse({ name: 'Laptop agent' }))
    expect(model.agentChoices.find((choice) => choice.selected)!.label).toBe('Laptop agent')
    expect(model.people.choices.map((choice) => choice.checked)).toEqual([true, false])
    expect(model.hours).toMatchObject({ limited: true, from: '09:30', to: '01:00' })
    expect(model.hours.zoneNote).toBe(
      strings.scheduling.delegation.hoursSavedZone({ saved: 'Europe/Paris', timeZone: 'Asia/Seoul' }),
    )
    expect(model.maxMinutes.choices.map((choice) => choice.value)).toContain(50)
    expect(model.maxMinutes.choices.find((choice) => choice.selected)!.value).toBe(50)
  })

  it('says when no agent is connected, and keeps a deactivated chosen person', () => {
    const none = schedulingSettingsModel({
      me: me(),
      view: { delegation: DEFAULT_SCHEDULING_DELEGATION, agentInUse: null },
      agents: [],
      directory,
      timeZone: 'UTC',
    })
    expect(none).toMatchObject({ kind: 'ready', agentLine: strings.scheduling.delegation.agentNone })
    const gone = schedulingSettingsModel({
      me: me(),
      view: {
        delegation: {
          ...DEFAULT_SCHEDULING_DELEGATION,
          scope: { people: [BEN], hours: null, maxMinutes: null },
        },
        agentInUse: null,
      },
      agents: [],
      directory: [entry(BEN, 'Ben', { member: { ...entry(BEN, 'Ben').member, status: 'deactivated' } })],
      timeZone: 'UTC',
    })
    expect(gone.kind === 'ready' && gone.people.choices.map((choice) => choice.label)).toEqual(['Ben'])
  })

  it('shows loading and failure', () => {
    const input = { me: me(), agents, directory, timeZone: 'UTC' }
    expect(schedulingSettingsModel({ ...input, view: null })).toEqual({ kind: 'loading' })
    expect(schedulingSettingsModel({ ...input, view: 'failed' })).toEqual({
      kind: 'failed',
      text: strings.loadFailed,
    })
  })
})

const typed = {
  autoJoin: true,
  autoAdd: true,
  agentId: null,
  peopleLimited: false,
  people: [],
  hoursLimited: false,
  from: '09:00',
  to: '18:00',
  maxLimited: false,
  maxMinutes: '60',
  brief: '  Mornings are best.  ',
}

describe('delegationFrom', () => {
  it('saves no limit when none is ticked, keeping the agent when its choice was not opened', () => {
    const before = { ...DEFAULT_SCHEDULING_DELEGATION, agentId: AGENT as never }
    expect(delegationFrom(typed, before, 'Asia/Seoul')).toEqual({
      delegation: { ...before, brief: 'Mornings are best.' },
    })
  })

  it('saves the limits that are ticked, in the browser’s time zone', () => {
    const result = delegationFrom(
      {
        ...typed,
        autoAdd: false,
        agentId: '',
        peopleLimited: true,
        people: [BEN, BEN, 'not-an-id'],
        hoursLimited: true,
        from: '22:00',
        to: '06:30',
        maxLimited: true,
        maxMinutes: '90',
      },
      { ...DEFAULT_SCHEDULING_DELEGATION, agentId: AGENT as never },
      'Asia/Seoul',
    )
    expect(result).toEqual({
      delegation: {
        autoJoin: true,
        autoAdd: false,
        agentId: null,
        brief: 'Mornings are best.',
        scope: {
          people: [BEN],
          hours: { from: 1320, to: 390, timeZone: 'Asia/Seoul' },
          maxMinutes: 90,
        },
      },
    })
  })

  it('takes the chosen agent, and a length kept within what the server accepts', () => {
    const chosen = delegationFrom(
      { ...typed, agentId: OTHER, maxLimited: true, maxMinutes: '9999' },
      DEFAULT_SCHEDULING_DELEGATION,
      'UTC',
    )
    expect(chosen).toMatchObject({ delegation: { agentId: OTHER, scope: { maxMinutes: 480 } } })
    const low = delegationFrom(
      { ...typed, maxLimited: true, maxMinutes: '1' },
      DEFAULT_SCHEDULING_DELEGATION,
      'UTC',
    )
    expect(low).toMatchObject({ delegation: { scope: { maxMinutes: 15 } } })
    const odd = delegationFrom(
      { ...typed, maxLimited: true, maxMinutes: 'x' },
      DEFAULT_SCHEDULING_DELEGATION,
      'UTC',
    )
    expect(odd).toMatchObject({ delegation: { scope: { maxMinutes: 60 } } })
    const unknown = delegationFrom({ ...typed, agentId: 'nope' }, DEFAULT_SCHEDULING_DELEGATION, 'UTC')
    expect(unknown).toMatchObject({ delegation: { agentId: null } })
  })

  it('refuses a limit on people with nobody chosen, and hours with a time missing', () => {
    expect(delegationFrom({ ...typed, peopleLimited: true }, DEFAULT_SCHEDULING_DELEGATION, 'UTC')).toEqual({
      problem: strings.scheduling.delegation.problems.noPeople,
    })
    for (const times of [{ from: '' }, { to: '24:00' }])
      expect(
        delegationFrom({ ...typed, hoursLimited: true, ...times }, DEFAULT_SCHEDULING_DELEGATION, 'UTC'),
      ).toEqual({ problem: strings.scheduling.delegation.problems.noHours })
  })
})
