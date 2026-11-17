import { type Schema as S, Schema } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import * as model from '../src/model.ts'

const noteBody = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0)
const refinements = { 'note-body': noteBody }

const schemas = Object.entries(model).filter(
  (entry) => typeof entry[1] === 'object' && entry[1] !== null && 'decode' in entry[1] && 'ast' in entry[1],
) as unknown as Array<[string, S.Schema<unknown>]>

describe('wire model', () => {
  it('exports the schemas the product needs', () => {
    expect(schemas.map(([name]) => name).sort()).toEqual(
      [
        'AuditEntry',
        'Contact',
        'ContactMode',
        'ContactState',
        'Conversation',
        'ConversationKind',
        'Credential',
        'CredentialKind',
        'DirectoryEntry',
        'DraftRequest',
        'Member',
        'MemberStatus',
        'Note',
        'NoteBody',
        'NoteStatus',
        'Origin',
        'Presence',
        'Receipt',
        'ReceiptState',
        'Relation',
        'Role',
        'Settings',
      ].sort(),
    )
  })

  it.each(schemas)('%s accepts every value generated from it, and decoding is idempotent', (_, schema) => {
    fc.assert(
      fc.property(arbitrary(schema, refinements), (value) => {
        const once = schema.decode(JSON.parse(JSON.stringify(value)))
        expect(once._tag).toBe('Ok')
        const twice = schema.decode((once as { value: unknown }).value)
        expect(twice).toEqual(once)
      }),
      { numRuns: 50 },
    )
  })

  it.each(schemas)('%s describes itself as JSON Schema', (_, schema) => {
    expect(() => JSON.stringify(Schema.toJsonSchema(schema.ast))).not.toThrow()
  })

  it('has no attachment field anywhere in a note', () => {
    expect(Object.keys(model.Note.fields).sort()).toEqual(
      [
        'agentName',
        'authorId',
        'body',
        'conversationId',
        'createdAt',
        'id',
        'inReplyTo',
        'origin',
        'receipts',
        'sentAt',
        'status',
        'updatedAt',
      ].sort(),
    )
  })

  it.each(['', '   ', '\n\t', 'x'.repeat(model.NOTE_BODY_MAX + 1), 42, null])(
    'refuses the note body %j',
    (body) => {
      expect(model.NoteBody.is(body)).toBe(false)
    },
  )

  it('accepts a note body up to the limit', () => {
    expect(model.NoteBody.is('hello https://example.com')).toBe(true)
    expect(model.NoteBody.is('x'.repeat(model.NOTE_BODY_MAX))).toBe(true)
  })

  it('keeps audit entries forever unless a retention is set', () => {
    const settings = { allowedDomains: ['example.com'], contactMode: 'open', auditRetentionDays: null }
    expect(model.Settings.is(settings)).toBe(true)
    expect(model.Settings.is({ ...settings, auditRetentionDays: 0 })).toBe(false)
    expect(model.Settings.is({ ...settings, allowedDomains: ['Example.com'] })).toBe(false)
    expect(model.Settings.is({ ...settings, contactMode: 'closed' })).toBe(false)
  })

  it('needs at least two participants in a conversation', () => {
    const conversation = fc.sample(arbitrary(model.Conversation, refinements), 1)[0]!
    expect(
      model.Conversation.is({ ...conversation, participantIds: conversation.participantIds.slice(0, 1) }),
    ).toBe(false)
  })

  it('only knows the two credential kinds', () => {
    expect(model.CredentialKind.is('human')).toBe(true)
    expect(model.CredentialKind.is('agent')).toBe(true)
    expect(model.CredentialKind.is('admin')).toBe(false)
  })
})
