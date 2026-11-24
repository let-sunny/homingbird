import { WRAPPER_TAG } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { DRAFT, READING } from './command-fixtures.ts'
import { AGENT_TOKEN, ANA, SERVER, channelNamed, world } from './support.ts'

describe('overview', () => {
  it('gathers who is signed in, conversations, waiting notes and drafts in one answer', async () => {
    const w = world({ stubs: READING })
    await w.run('overview', '--json')
    const overview = w.json()
    expect(overview).toMatchObject({
      signedIn: true,
      server: SERVER,
      member: { id: ANA.id, name: 'Ana', email: 'ana@example.com' },
    })
    expect(overview).not.toHaveProperty('hasApproveButton')
    expect(overview.conversations).toHaveLength(1)
    expect(overview.awaiting[0].wrapped).toContain(`<${WRAPPER_TAG}`)
    expect(overview.drafts[0]).toMatchObject({ id: DRAFT.id, body: 'Yes, after six.' })
    expect(JSON.stringify(overview)).not.toContain(AGENT_TOKEN)
  })

  it('names the channel whose managers review a channel agent’s drafts, and where', async () => {
    const agent = { ...ANA, kind: 'channel_agent' }
    const w = world({
      stubs: {
        ...READING,
        'me.get': () =>
          ({
            member: agent,
            credential: { id: 'cred_aaaaaaaaaaaa', kind: 'agent', name: 'Desk' },
            contactMode: 'open',
          }) as never,
        'channels.list': () =>
          ({
            channels: [channelNamed('payments-wiki', { id: ANA.id, name: 'Wiki' })],
            hasMore: false,
            cursor: null,
          }) as never,
      },
    })
    await w.run('overview', '--json')
    expect(w.json()).toMatchObject({
      member: { kind: 'channel_agent' },
      reviewChannel: 'payments-wiki',
      reviewLink: `${SERVER}/#/channel/payments-wiki/agent`,
    })
    await w.run('overview')
    expect(w.lines.at(-1)).toContain('Drafts waiting for the managers of #payments-wiki')
    expect(w.lines.at(-1)).toContain(`They review them at ${SERVER}/#/channel/payments-wiki/agent`)
  })

  it('names no channel when the channel list cannot be read', async () => {
    const agent = { ...ANA, kind: 'channel_agent' }
    const w = world({
      stubs: {
        ...READING,
        'me.get': () =>
          ({
            member: agent,
            credential: { id: 'cred_aaaaaaaaaaaa', kind: 'agent', name: 'Desk' },
            contactMode: 'open',
          }) as never,
        'channels.list': () => ({ channels: [], hasMore: false, cursor: null }) as never,
      },
    })
    await w.run('overview', '--json')
    expect(w.json()).not.toHaveProperty('reviewChannel')
  })

  it('prints the same as sections of text', async () => {
    const w = world({ stubs: READING, signedIn: 'agent' })
    await w.run('overview')
    expect(w.lines[0]).toMatch(
      /^Signed in as Ana on https:\/\/hb\.example\.com\n\nDirect notes and channels\n.*\n\nWaiting for a reply\n[\s\S]*\n\nDrafts waiting for approval\n/,
    )
  })

  it('says not signed in without calling the server', async () => {
    const w = world({ signedIn: 'none' })
    expect(await w.run('overview', '--json')).toBe(0)
    expect(w.json()).toEqual({ signedIn: false })
    await w.run('overview')
    expect(w.lines.at(-1)).toBe('Not signed in.')
    expect(w.calls).toEqual([])
  })
})

describe('guidance', () => {
  const CONVERSATION = 'conv_aaaaaaaaaaaa'

  it('gives the answering flow, then the principles, for one conversation', async () => {
    const w = world({
      stubs: {
        'answeringFlow.get': () => ({ flow: '## Before drafting\n1. Look it up.', updatedAt: 1 }),
        'principles.drafting': () => ({
          principles: [
            { kind: 'rule' as const, topic: 'Release dates', rule: 'check RELEASES.md', source: null },
          ],
          leftOut: 0,
          ignored: [],
          ignoredLeftOut: 0,
        }),
      },
    })
    await w.run('guidance', CONVERSATION, '--json')
    const { guidance } = w.json()
    expect(guidance.indexOf('Look it up.')).toBeLessThan(
      guidance.indexOf('- Release dates: check RELEASES.md'),
    )
    expect(w.calls.map((call) => call.route)).toContain('principles.drafting')
  })

  it('says so when nothing applies, and refuses something that is not a conversation id', async () => {
    const w = world({
      stubs: {
        'answeringFlow.get': () => ({ flow: null, updatedAt: null }),
        'principles.drafting': () => ({ principles: [], leftOut: 0, ignored: [], ignoredLeftOut: 0 }),
      },
    })
    await w.run('guidance', CONVERSATION)
    expect(w.lines).toEqual(['No answering flow or principles apply here.'])
    expect(await w.run('guidance', 'nonsense')).not.toBe(0)
  })
})
