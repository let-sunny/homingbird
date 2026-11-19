import { expect, it } from 'vitest'
import { startTestServer, storedRows } from './harness.ts'

it('carries a note from draft through approval to a reply', async () => {
  const server = await startTestServer()
  const ana = await server.signIn('ana@example.com', 'Ana')
  const ben = await server.signIn('ben@example.com', 'Ben')
  expect(ana.me.member.role).toBe('admin')
  expect(ben.me.member.role).toBe('member')

  const draft = await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Is the migration safe?' })
  expect(draft.status).toBe(200)
  expect(draft.json.status).toBe('draft')
  expect((await ben.api('GET', '/conversations')).json.conversations).toEqual([])
  expect((await ben.api('GET', `/notes/${draft.json.id}`)).status).toBe(404)

  const sent = await ana.api('POST', `/drafts/${draft.json.id}/send`, {})
  expect(sent.json.status).toBe('sent')
  expect(sent.json.receipts).toMatchObject([{ memberId: ben.me.member.id, state: 'delivered' }])

  const inbox = await ben.api('GET', '/inbox')
  expect(inbox.json.items).toHaveLength(1)
  await ben.api('POST', `/notes/${draft.json.id}/read`)
  const reply = await ben.api('POST', '/drafts', { inReplyTo: draft.json.id, body: 'Yes, go ahead.' })
  expect((await ana.api('GET', `/notes/${draft.json.id}`)).json.receipts[0].state).toBe('drafting')
  await ben.api('POST', `/drafts/${reply.json.id}/send`, {})
  expect((await ana.api('GET', `/notes/${draft.json.id}`)).json.receipts[0].state).toBe('replied')

  const events = await ana.api('GET', '/events/poll?after=0')
  expect(events.json.events.map((event: any) => event.body.type)).toEqual([
    'draft.saved',
    'note.sent',
    'note.status',
    'note.status',
    'note.sent',
    'note.status',
  ])
  const audit = JSON.stringify(await storedRows(server, 'audit_events'))
  expect(audit).toContain('note.approved')
  expect(audit).not.toContain('Yes, go ahead.')
  await server.close()
})
