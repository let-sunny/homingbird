import { describe, expect, it } from 'vitest'
import { contract } from '../src/contract.ts'

const MEMBER = {
  id: 'mem_ana000000000',
  email: 'ana@example.com',
  name: 'Ana',
  profile: '',
  role: 'member',
  status: 'active',
  createdAt: 1,
  character: null,
}

const NOTE = {
  id: 'note_aaaaaaaaaaaa',
  conversationId: 'conv_aaaaaaaaaaaa',
  authorId: MEMBER.id,
  status: 'sent',
  body: 'Hello',
  inReplyTo: null,
  origin: 'agent',
  agentName: 'Laptop',
  createdAt: 1,
  updatedAt: 1,
  sentAt: 1,
  receipts: [],
}

/** Responses exactly as a 0.1.0 server sends them: a newer desk must still read every one. */
describe('responses from a 0.1.0 server', () => {
  it('decodes server information without feature switches', () => {
    const info = { name: 'dovecote', version: '0.1.0', contactMode: 'open', signInWith: 'Development login' }
    expect(contract['server.info'].response.decode(info)._tag).toBe('Ok')
  })

  it('decodes a directory entry without an agent introduction', () => {
    const entry = {
      member: MEMBER,
      presence: { humanOnline: true, agentOnline: false },
      lastSeenAt: null,
      relation: 'none',
      canMessage: true,
      channels: [],
    }
    expect(contract['directory.list'].response.decode({ entries: [entry] })._tag).toBe('Ok')
  })

  it('decodes a note without the program, the model or a basis', () => {
    expect(contract['notes.get'].response.decode(NOTE)._tag).toBe('Ok')
    expect(contract['drafts.list'].response.decode({ drafts: [{ ...NOTE, status: 'draft' }] })._tag).toBe(
      'Ok',
    )
  })

  it('decodes settings without feature switches', () => {
    const settings = { allowedDomains: [], contactMode: 'open', auditRetentionDays: null }
    expect(contract['admin.settings.get'].response.decode(settings)._tag).toBe('Ok')
  })
})
