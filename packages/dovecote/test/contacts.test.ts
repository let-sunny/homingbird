import { afterEach, describe, expect, it } from 'vitest'
import { type Session, type TestServer, asShown, startTestServer } from './harness.ts'

let server: TestServer
afterEach(() => server.close())

const people = async (overrides: Record<string, string> = {}) => {
  server = await startTestServer(overrides)
  const ana = await server.signIn('ana@example.com', 'Ana')
  const ben = await server.signIn('ben@example.com', 'Ben')
  return { ana, ben }
}

const entryFor = async (viewer: Session, other: Session) =>
  (await viewer.api('GET', '/directory')).json.entries.find(
    (entry: any) => entry.member.id === other.me.member.id,
  )

const canDraftTo = async (author: Session, recipient: Session) =>
  (await author.api('POST', '/drafts', { to: [recipient.me.member.id], body: 'hi' })).status === 200

describe('open mode', () => {
  it('lets anyone in the organization message anyone, without a contact', async () => {
    const { ana, ben } = await people()
    expect(await entryFor(ana, ben)).toMatchObject({ relation: 'none', canMessage: true })
    expect(await entryFor(ana, ana)).toMatchObject({ relation: 'self', canMessage: false })
    expect(await canDraftTo(ana, ben)).toBe(true)
  })
})

describe('contacts mode', () => {
  it('requires the recipient to accept a request first', async () => {
    const { ana, ben } = await people({ HB_CONTACT_MODE: 'contacts' })
    expect(await entryFor(ana, ben)).toMatchObject({ relation: 'none', canMessage: false })
    expect(await canDraftTo(ana, ben)).toBe(false)

    expect((await ana.api('POST', '/contacts', { memberId: ben.me.member.id })).json.state).toBe(
      'request_sent',
    )
    expect(await entryFor(ana, ben)).toMatchObject({ relation: 'request_sent', canMessage: false })
    expect(await entryFor(ben, ana)).toMatchObject({ relation: 'request_received', canMessage: false })
    expect((await ana.api('POST', `/contacts/${ben.me.member.id}/accept`)).status).toBe(404)

    expect((await ben.api('POST', `/contacts/${ana.me.member.id}/accept`)).json.state).toBe('accepted')
    expect(await entryFor(ana, ben)).toMatchObject({ relation: 'contact', canMessage: true })
    expect(await canDraftTo(ana, ben)).toBe(true)
    expect(await canDraftTo(ben, ana)).toBe(true)
  })

  it('lists contacts with their state from each side', async () => {
    const { ana, ben } = await people({ HB_CONTACT_MODE: 'contacts' })
    await ana.api('POST', '/contacts', { memberId: ben.me.member.id })
    expect((await ana.api('GET', '/contacts')).json).toEqual({
      contacts: [{ memberId: ben.me.member.id, state: 'request_sent', since: server.clock.now() }],
      blocked: [],
    })
    expect((await ben.api('GET', '/contacts')).json.contacts[0]).toMatchObject({
      memberId: ana.me.member.id,
      state: 'request_received',
    })
  })

  it('treats a request in the other direction as acceptance', async () => {
    const { ana, ben } = await people({ HB_CONTACT_MODE: 'contacts' })
    await ana.api('POST', '/contacts', { memberId: ben.me.member.id })
    expect((await ben.api('POST', '/contacts', { memberId: ana.me.member.id })).json.state).toBe('accepted')
    expect((await ana.api('POST', '/contacts', { memberId: ben.me.member.id })).json.state).toBe('accepted')
  })

  it('stops messaging again when either side removes the contact', async () => {
    const { ana, ben } = await people({ HB_CONTACT_MODE: 'contacts' })
    await ana.api('POST', '/contacts', { memberId: ben.me.member.id })
    await ben.api('POST', `/contacts/${ana.me.member.id}/accept`)
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'pending' })).json
    await ben.api('DELETE', `/contacts/${ana.me.member.id}`)
    expect((await ana.api('GET', '/contacts')).json.contacts).toEqual([])
    expect((await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))).status).toBe(403)
  })

  it('refuses a request to oneself, to a stranger id and to someone unknown', async () => {
    const { ana } = await people({ HB_CONTACT_MODE: 'contacts' })
    expect((await ana.api('POST', '/contacts', { memberId: ana.me.member.id })).status).toBe(409)
    expect((await ana.api('POST', '/contacts', { memberId: 'mem_doesnotexist00' })).status).toBe(404)
    expect((await ana.api('POST', '/contacts', { memberId: 'nope' })).status).toBe(400)
  })
})

describe('blocking', () => {
  for (const mode of ['open', 'contacts'] as const)
    it(`stops messages in both directions in ${mode} mode and is not disclosed to the blocked person`, async () => {
      const { ana, ben } = await people({ HB_CONTACT_MODE: mode })
      await ana.api('POST', '/contacts', { memberId: ben.me.member.id })
      await ben.api('POST', '/contacts', { memberId: ana.me.member.id })
      expect(await canDraftTo(ana, ben)).toBe(true)

      expect((await ben.api('PUT', `/blocks/${ana.me.member.id}`)).status).toBe(200)
      expect((await ben.api('GET', '/contacts')).json).toEqual({ contacts: [], blocked: [ana.me.member.id] })
      expect(await entryFor(ben, ana)).toMatchObject({ relation: 'blocked', canMessage: false })
      expect((await entryFor(ana, ben)).relation).not.toBe('blocked')
      expect(await canDraftTo(ana, ben)).toBe(false)
      expect(await canDraftTo(ben, ana)).toBe(false)
      expect((await ana.api('POST', '/contacts', { memberId: ben.me.member.id })).status).toBe(403)

      await ben.api('PUT', `/blocks/${ana.me.member.id}`)
      await ben.api('DELETE', `/blocks/${ana.me.member.id}`)
      expect((await ben.api('GET', '/contacts')).json.blocked).toEqual([])
      expect(await canDraftTo(ana, ben)).toBe(mode === 'open')
    })

  it('cannot block oneself, and a draft written before a block cannot be sent', async () => {
    const { ana, ben } = await people()
    expect((await ana.api('PUT', `/blocks/${ana.me.member.id}`)).status).toBe(409)
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'pending' })).json
    await ben.api('PUT', `/blocks/${ana.me.member.id}`)
    expect((await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))).status).toBe(403)
  })
})

describe('contact events', () => {
  it('tells both sides when a request is made and accepted', async () => {
    const { ana, ben } = await people({ HB_CONTACT_MODE: 'contacts' })
    await ana.api('POST', '/contacts', { memberId: ben.me.member.id })
    await ben.api('POST', `/contacts/${ana.me.member.id}/accept`)
    const typesFor = async (viewer: Session) =>
      (await viewer.api('GET', '/events/poll?after=0')).json.events.map((event: any) => [
        event.body.type,
        event.body.memberId,
      ])
    expect(await typesFor(ana)).toEqual([
      ['contact.changed', ben.me.member.id],
      ['contact.changed', ben.me.member.id],
    ])
    expect(await typesFor(ben)).toEqual([
      ['contact.changed', ana.me.member.id],
      ['contact.changed', ana.me.member.id],
    ])
  })
})
