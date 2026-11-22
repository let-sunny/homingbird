import { afterEach, describe, expect, it } from 'vitest'
import { type TestServer, connectAgent, startTestServer, storedRows } from './harness.ts'

let server: TestServer
afterEach(() => server?.close())

const recorded = async (from = 0) =>
  (await storedRows(server, 'audit_events'))
    .slice(from)
    .map((row) => [row.event, row.target_id, JSON.parse(String(row.detail))])

describe('what each audited route records', () => {
  it('records channel, contact, credential and administration changes by ids and enums only', async () => {
    server = await startTestServer({ HB_CHANNELS: 'general' })
    const ana = await server.signIn('ana@example.com', 'Ana')
    const ben = await server.signIn('ben@example.com', 'Ben')
    const agent = await connectAgent(server, ben, { name: 'Ben agent' })
    const start = (await storedRows(server, 'audit_events')).length
    await ana.api('POST', '/channels', { slug: 'payroll', description: 'Pay runs', visibility: 'open' })
    await ben.api('PUT', '/channels/payroll/membership', { answering: true })
    await ben.api('DELETE', '/channels/payroll/answering')
    await ben.api('PUT', '/channels/payroll/answering')
    await ben.api('DELETE', '/channels/payroll/membership')
    await ana.api('POST', '/contacts', { memberId: ben.me.member.id })
    await ben.api('POST', `/contacts/${ana.me.member.id}/accept`)
    await ana.api('DELETE', `/contacts/${ben.me.member.id}`)
    await ana.api('PUT', `/blocks/${ben.me.member.id}`)
    await ana.api('DELETE', `/blocks/${ben.me.member.id}`)
    const credential = (await ben.api('GET', '/credentials')).json.credentials.find(
      (each: { kind: string }) => each.kind === 'agent',
    )
    await ben.api('PATCH', `/credentials/${credential.id}`, { name: 'Laptop' })
    await ben.api('DELETE', `/credentials/${credential.id}`)
    await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, { role: 'admin', status: 'deactivated' })
    await ana.api('PATCH', '/admin/channels/payroll', { slug: 'pay', description: 'Pay' })
    await ana.api('POST', '/admin/channels/pay/archive', { moveMembersTo: 'general' })
    await ana.api('POST', '/admin/channels/general/archive', {})
    expect(await recorded(start)).toEqual([
      ['channel.created', 'payroll', { visibility: 'open' }],
      ['channel.joined', 'payroll', {}],
      ['channel.answering_changed', 'payroll', { on: false }],
      ['channel.answering_changed', 'payroll', { on: true }],
      ['channel.left', 'payroll', {}],
      ['contact.requested', ben.me.member.id, {}],
      ['contact.accepted', ana.me.member.id, {}],
      ['contact.removed', ben.me.member.id, {}],
      ['contact.blocked', ben.me.member.id, {}],
      ['contact.unblocked', ben.me.member.id, {}],
      ['credential.renamed', credential.id, {}],
      ['credential.revoked', credential.id, {}],
      [
        'member.access_changed',
        ben.me.member.id,
        { role: { from: 'member', to: 'admin' }, status: { from: 'active', to: 'deactivated' } },
      ],
      [
        'channel.renamed',
        'payroll',
        { fields: ['slug', 'description'], slug: { from: 'payroll', to: 'pay' } },
      ],
      ['channel.archived', 'pay', { moveMembersTo: 'general' }],
      ['channel.archived', 'general', {}],
    ])
    expect(JSON.stringify(await recorded(start))).not.toMatch(/Pay runs|Laptop/)
    expect(agent.token).not.toBe('')
  })

  it('records principle changes by field names and a reorder by its count', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    const first = (await ana.api('POST', '/principles', { topic: 'One', rule: 'first rule', place: null }))
      .json
    const second = (
      await ana.api('POST', '/principles', { kind: 'answer', topic: 'Two', rule: 'second', place: null })
    ).json
    await ana.api('PATCH', `/principles/${first.id}`, { enabled: false, topic: 'Uno' })
    await ana.api('PUT', '/principles/order', { ids: [second.id, first.id] })
    expect((await recorded()).filter(([event]) => String(event).startsWith('principle.'))).toEqual([
      ['principle.created', first.id, { kind: 'rule' }],
      ['principle.created', second.id, { kind: 'answer' }],
      ['principle.changed', first.id, { fields: ['topic', 'enabled'], enabled: false }],
      ['principle.reordered', null, { count: 2 }],
    ])
  })

  it('records a settings change with the values before and after, and only the name of a changed flow', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    const settings = (await ana.api('GET', '/admin/settings')).json
    await ana.api('PUT', '/admin/settings', {
      ...settings,
      allowedDomains: ['example.com', 'partner.org'],
      contactMode: 'contacts',
    })
    const [change] = (await recorded()).filter(([event]) => event === 'organization.settings_changed')
    expect(change).toEqual([
      'organization.settings_changed',
      null,
      {
        changed: ['allowedDomains', 'contactMode'],
        allowedDomains: { from: ['example.com'], to: ['example.com', 'partner.org'] },
        contactMode: { from: 'open', to: 'contacts' },
      },
    ])
  })

  it('records which kind of program a credential went to, never the name it gave itself', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    for (const form of [
      { client_name: 'Laptop of Ana Lopez', client_kind: 'mcp', scope: 'notes' },
      { client_name: 'An older desk', scope: 'notes' },
      { client_name: 'Something', client_kind: 'spaceship', scope: 'notes' },
    ]) {
      const started = await server.request('POST', '/oauth/device_authorization', { form })
      await ana.api('POST', `/device/${started.json.user_code}`, { approve: true })
      await server.request('POST', '/oauth/token', {
        form: {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: started.json.device_code,
        },
      })
    }
    const issued = (await recorded())
      .filter(([event]) => event === 'credential.issued')
      .map(([, , detail]) => detail)
    expect(issued).toEqual([
      { kind: 'human', grant: 'browser', clientKind: 'browser' },
      { kind: 'agent', grant: 'device_code', clientKind: 'mcp' },
      { kind: 'agent', grant: 'device_code', clientKind: 'device' },
      { kind: 'agent', grant: 'device_code', clientKind: 'device' },
    ])
    expect(JSON.stringify(await storedRows(server, 'audit_events'))).not.toContain('Ana Lopez')
  })

  it('records a mute by the conversation and a notification level by its value, never a note', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    const ben = await server.signIn('ben@example.com', 'Ben')
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Secret plans' })).json
    await ana.api('POST', `/drafts/${draft.id}/send`, {})
    const start = (await storedRows(server, 'audit_events')).length
    await ben.api('PUT', `/conversations/${draft.conversationId}/mute`)
    await ben.api('DELETE', `/conversations/${draft.conversationId}/mute`)
    await ben.api('PUT', '/me/notifications', { notifications: 'direct' })
    expect(await recorded(start)).toEqual([
      ['conversation.mute_changed', draft.conversationId, { muted: true }],
      ['conversation.mute_changed', draft.conversationId, { muted: false }],
      ['member.notifications_changed', ben.me.member.id, { notifications: 'direct' }],
    ])
    expect(JSON.stringify((await storedRows(server, 'audit_events')).slice(start))).not.toContain('Secret')
  })
})
