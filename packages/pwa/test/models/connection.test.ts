import type { AsRead } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  claudeCodeCommands,
  connectionModel,
  firstStepsModel,
  helpedChannels,
} from '../../src/models/connection.ts'
import { formats, strings } from '../../src/strings.ts'
import { ANA, channel, credential, entry } from '../support/fixtures.ts'

describe('connectionModel', () => {
  it('waits for the credentials, then marks the current one, the revoked ones and when each was used', () => {
    const base = { viewerId: ANA, directory: [], channels: [], joinCodes: false }
    expect(connectionModel({ ...base, credentials: null }).credentials).toBeNull()
    const model = connectionModel({
      ...base,
      credentials: [
        credential('cred_web', { kind: 'human', current: true, lastUsedAt: 5, client: 'Web' }),
        credential('cred_old', { revokedAt: 3 }),
      ],
    })
    expect(model.credentials!.noAgents).toBe(true)
    const [web, old] = model.credentials!.rows
    expect(web!.marks.map((mark) => mark.style)).toEqual(['is-current', 'is-you'])
    expect(web!.facts).toEqual([
      { term: strings.credentialLastUsed, value: formats.full.format(new Date(5)) },
      { term: strings.credentialExpires, value: formats.full.format(new Date(2)) },
    ])
    expect(web!.revokeTitle).toBe(strings.revokeCurrentTitle)
    expect(web!.revokeBody).toBe(strings.revokeCurrentBody({ name: 'cred_web' }))
    expect(old!.revoked).toBe(true)
    expect(old!.marks.map((mark) => mark.text)).toEqual([strings.credentialRevoked])
    expect(old!.facts[0]!.value).toBe(strings.credentialNeverUsed)
    expect(old!.revokeBody).toBe(strings.revokeBody({ name: 'cred_old' }))
    expect(web!.client).toBe(strings.clients.web)
    expect(connectionModel({ ...base, credentials: [credential('cred_agent')] }).credentials!.noAgents).toBe(
      false,
    )
  })

  it('shows whether the person’s desk is awake', () => {
    const presence = { humanOnline: true, agentOnline: true }
    expect(
      connectionModel({
        viewerId: ANA,
        directory: [entry(ANA, 'Ana', { presence })],
        channels: [],
        credentials: null,
        joinCodes: false,
      }).presence,
    ).toEqual(presence)
    expect(
      connectionModel({ viewerId: ANA, directory: [], channels: [], credentials: null, joinCodes: false })
        .presence,
    ).toBeNull()
  })

  it('tells the person why their running desk cannot answer, and when it tries again', () => {
    const shown = (agentUnavailable: NonNullable<AsRead.Presence['agentUnavailable']>) =>
      connectionModel({
        viewerId: ANA,
        directory: [
          entry(ANA, 'Ana', { presence: { humanOnline: true, agentOnline: true, agentUnavailable } }),
        ],
        channels: [],
        credentials: null,
        joinCodes: false,
      }).unavailable
    const until = new Date(2026, 10, 21, 15, 0).getTime()
    expect(shown({ until, kind: 'usage_limit' })).toEqual([
      strings.deskUnavailableReason.usage_limit,
      strings.deskTriesAgainAt({ time: formats.time.format(new Date(until)) }),
    ])
    expect(shown({ until: null, kind: 'signed_out' })).toEqual([strings.deskUnavailableReason.signed_out])
    expect(shown({ until: null })).toEqual([strings.deskUnavailableReason.unknown])
    expect(
      connectionModel({ viewerId: ANA, directory: [], channels: [], credentials: null, joinCodes: false })
        .unavailable,
    ).toEqual([])
  })
})

describe('the desk recommendation', () => {
  const recommendation = (
    agentOnline: boolean,
    joinCodes: boolean,
    credentials: ReadonlyArray<AsRead.Credential> | null = [credential('cred_agent')],
  ) =>
    connectionModel({
      viewerId: ANA,
      directory: [entry(ANA, 'Ana', { presence: { humanOnline: true, agentOnline } })],
      channels: [],
      credentials,
      joinCodes,
    }).recommendation

  it('is gone once the desk is awake', () => {
    expect(recommendation(true, true)).toBeNull()
  })

  it('is left to the first steps while no agent is connected, or while the list loads', () => {
    expect(recommendation(false, true, [])).toBeNull()
    expect(recommendation(false, true, [credential('cred_old', { revokedAt: 3 })])).toBeNull()
    expect(recommendation(false, true, null)).toBeNull()
  })

  it('says drafts are approved in their direct message or channel, and points to Run on a server only when it is offered', () => {
    expect(recommendation(false, true)).toEqual({ title: strings.deskTitle, body: strings.deskBodyWithJoin })
    expect(recommendation(false, false)).toEqual({ title: strings.deskTitle, body: strings.deskBody })
    expect(strings.deskBody).not.toContain('Run on a server')
    expect(strings.deskBody).toContain('in its direct message or channel')
  })
})

describe('helpedChannels', () => {
  it('names the channels the agent answers in, or those the directory knows', () => {
    const directory = [entry(ANA, 'Ana', { channels: ['ops'] })]
    expect(
      helpedChannels({ viewerId: ANA, directory, channels: [channel('billing', { answering: true })] }),
    ).toEqual(['billing'])
    expect(helpedChannels({ viewerId: ANA, directory, channels: [channel('billing')] })).toEqual(['ops'])
    expect(helpedChannels({ viewerId: ANA, directory: [], channels: [] })).toEqual([])
  })
})

describe('firstStepsModel', () => {
  it('lists how to connect a first agent until one is connected, and waits for the list', () => {
    expect(
      firstStepsModel({ credentials: null, origin: 'https://hb.example.com', joinCodes: true }),
    ).toBeNull()
    const steps = firstStepsModel({ credentials: [], origin: 'https://hb.example.com', joinCodes: true })!
    expect(steps.title).toBe(strings.firstSteps.title)
    expect(steps.steps.map((step) => step.text)).toEqual([
      strings.firstSteps.plugin,
      strings.firstSteps.commandLine,
      strings.firstSteps.run,
    ])
    expect(steps.folded).toBe(false)
    expect(steps.steps[0]!.command).toBe(claudeCodeCommands('https://hb.example.com'))
    expect(steps.steps[0]!.command.split('\n')).toEqual([
      '/plugin install homingbird --marketplace let-sunny/homingbird',
      '/homingbird https://hb.example.com',
    ])
    expect(steps.steps[1]!.command).toContain('homingbird login --server https://hb.example.com')
    expect(steps.joinHint).toBe(strings.firstSteps.joinHint)
    expect(steps.guide.href).toMatch(/^https:\/\/.*guide\.md#connect-an-agent$/)
    expect(
      firstStepsModel({ credentials: [], origin: 'https://hb.example.com', joinCodes: false })!.joinHint,
    ).toBeNull()
  })

  it('counts a revoked agent as none, and folds into connecting another agent once one is connected', () => {
    const revoked = [credential('cred_old', { revokedAt: 3 }), credential('cred_web', { kind: 'human' })]
    expect(firstStepsModel({ credentials: revoked, origin: 'x', joinCodes: false })!.folded).toBe(false)
    const another = firstStepsModel({
      credentials: [credential('cred_agent')],
      origin: 'x',
      joinCodes: false,
    })!
    expect(another.folded).toBe(true)
    expect(another.title).toBe(strings.firstSteps.anotherTitle)
    expect(another.steps).toHaveLength(3)
  })
})
