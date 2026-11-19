import { describe, expect, it } from 'vitest'
import { connectionModel, helpedChannels } from '../../src/models/connection.ts'
import { formats, strings } from '../../src/strings.ts'
import { ANA, channel, credential, entry } from '../support/fixtures.ts'

describe('connectionModel', () => {
  it('waits for the credentials, then marks the current one, the revoked ones and when each was used', () => {
    const base = { viewerId: ANA, directory: [], channels: [] }
    expect(connectionModel({ ...base, credentials: null }).credentials).toBeNull()
    const model = connectionModel({
      ...base,
      credentials: [
        credential('cred_web', { kind: 'human', current: true, lastUsedAt: 5 }),
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
      }).presence,
    ).toEqual(presence)
    expect(
      connectionModel({ viewerId: ANA, directory: [], channels: [], credentials: null }).presence,
    ).toBeNull()
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
