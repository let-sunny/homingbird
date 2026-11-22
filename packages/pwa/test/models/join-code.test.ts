import { describe, expect, it } from 'vitest'
import { isJoinedAgentAwake, joinCodeModel, joinCommand, localExpiry } from '../../src/models/join-code.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, channel, entry } from '../support/fixtures.ts'

const NOW = 1_000_000
const code = {
  id: 'join_1',
  code: 'hbj_secret',
  serverUrl: 'https://hb.example.com',
  expiresAt: NOW + 600_000,
}
const made = { kind: 'made' as const, code, expiresAt: code.expiresAt, copied: 'not yet' as const }

describe('joinCodeModel', () => {
  it('offers to make a code for the person’s own agent, or for a channel’s', () => {
    expect(joinCodeModel({ state: { kind: 'idle' }, now: NOW, agent: null })).toEqual({
      kind: 'offer',
      title: strings.joinCode.title,
      intro: strings.joinCode.intro,
      button: strings.joinCode.create,
      busy: false,
      problem: null,
    })
    expect(joinCodeModel({ state: { kind: 'idle' }, now: NOW, agent: 'Payments wiki' })).toMatchObject({
      intro: strings.joinCode.introAgent({ agent: 'Payments wiki' }),
    })
  })

  it('says while a code is being made, and when none could be', () => {
    expect(joinCodeModel({ state: { kind: 'creating' }, now: NOW, agent: null })).toMatchObject({
      button: strings.joinCode.creating,
      busy: true,
    })
    expect(joinCodeModel({ state: { kind: 'failed' }, now: NOW, agent: null })).toMatchObject({
      button: strings.joinCode.create,
      busy: false,
      problem: strings.joinCode.failed,
    })
  })

  it('shows the whole line to paste and how long it still works, to the second', () => {
    expect(joinCodeModel({ state: made, now: NOW, agent: null })).toEqual({
      kind: 'code',
      title: strings.joinCode.title,
      command: ' homingbird setup --server https://hb.example.com --join hbj_secret --agent claude',
      explanation: strings.joinCode.explanation,
      countdown: strings.joinCode.expiresIn({ time: '10:00' }),
      copy: strings.joinCode.copy,
      copyProblem: null,
    })
    expect(joinCodeModel({ state: made, now: NOW + 599_001, agent: 'Wiki' })).toMatchObject({
      explanation: strings.joinCode.explanationAgent({ agent: 'Wiki' }),
      countdown: strings.joinCode.expiresIn({ time: '0:01' }),
    })
    expect(joinCodeModel({ state: made, now: NOW + 125_000, agent: null })).toMatchObject({
      countdown: strings.joinCode.expiresIn({ time: '7:55' }),
    })
  })

  it('says it was copied, or that the browser would not copy it', () => {
    expect(joinCodeModel({ state: { ...made, copied: 'copied' }, now: NOW, agent: null })).toMatchObject({
      copy: strings.joinCode.copied,
      copyProblem: null,
    })
    expect(joinCodeModel({ state: { ...made, copied: 'refused' }, now: NOW, agent: null })).toMatchObject({
      copy: strings.joinCode.copy,
      copyProblem: strings.joinCode.copyFailed,
    })
  })

  it('offers a new code once the shown one expired', () => {
    expect(joinCodeModel({ state: made, now: NOW + 600_000, agent: null })).toEqual({
      kind: 'expired',
      title: strings.joinCode.title,
      text: strings.joinCode.expired,
      button: strings.joinCode.again,
    })
  })

  it('names the connection the code made once it was used, says whether it is awake, and offers another server', () => {
    const connected = { kind: 'connected' as const, credential: { id: 'cred_1', name: 'build-1' } }
    expect(joinCodeModel({ state: connected, now: NOW, agent: null, awake: true })).toEqual({
      kind: 'connected',
      title: strings.joinCode.title,
      text: strings.joinCode.connected({ name: 'build-1' }),
      awake: strings.joinCode.awakeNow,
      button: strings.joinCode.another,
    })
    expect(joinCodeModel({ state: connected, now: NOW, agent: 'Wiki' })).toMatchObject({
      text: strings.joinCode.connectedAgent({ name: 'build-1', agent: 'Wiki' }),
      awake: strings.joinCode.notAwakeYet,
    })
  })

  it('builds the line from the address the server gave, with a space first so the shell can leave it out of its history', () => {
    expect(joinCommand({ ...code, serverUrl: 'https://relay.example/hb' })).toBe(
      ' homingbird setup --server https://relay.example/hb --join hbj_secret --agent claude',
    )
  })

  it('counts from this browser’s clock when the server says how long the code works, else from its expiry', () => {
    expect(localExpiry({ ...code, expiresAt: 5, expiresInSeconds: 600 }, NOW)).toBe(NOW + 600_000)
    expect(localExpiry(code, NOW)).toBe(code.expiresAt)
  })
})

describe('isJoinedAgentAwake', () => {
  const awake = { humanOnline: true, agentOnline: true }
  const asleep = { humanOnline: true, agentOnline: false }
  const directory = [entry(ANA, 'Ana', { presence: awake }), entry(BEN, 'Ben', { presence: asleep })]

  it('reads the viewer’s own agent from the directory', () => {
    const input = { channel: null, channels: [], directory }
    expect(isJoinedAgentAwake({ ...input, viewerId: ANA })).toBe(true)
    expect(isJoinedAgentAwake({ ...input, viewerId: BEN })).toBe(false)
    expect(isJoinedAgentAwake({ ...input, viewerId: null })).toBe(false)
  })

  it('reads a channel’s agent from its channel', () => {
    const agent = (presence: typeof awake) => ({ id: BEN, name: 'Wiki', presence })
    const channels = [channel('billing', { agent: agent(awake) }), channel('ops', { agent: agent(asleep) })]
    const input = { channels, directory, viewerId: ANA }
    expect(isJoinedAgentAwake({ ...input, channel: 'billing' })).toBe(true)
    expect(isJoinedAgentAwake({ ...input, channel: 'ops' })).toBe(false)
    expect(isJoinedAgentAwake({ ...input, channel: 'nowhere' })).toBe(false)
  })
})
