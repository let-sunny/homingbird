import { type Schema as S, Schema } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import * as model from '../src/model.ts'

const noteBody = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0)
const refinements = {
  'note-body': noteBody,
  'agent-label': fc
    .string({ minLength: 1, maxLength: 80 })
    .filter((s) => s.trim() !== '' && !/[\p{Cc}\p{Cf}]/u.test(s)),
}

const schemas = Object.entries(model).filter(
  (entry) => typeof entry[1] === 'object' && entry[1] !== null && 'decode' in entry[1] && 'ast' in entry[1],
) as unknown as Array<[string, S.Schema<unknown>]>

describe('wire model', () => {
  it('exports the schemas the product needs', () => {
    expect(schemas.map(([name]) => name).sort()).toEqual(
      [
        'AgentLabel',
        'AnsweringFlowSetting',
        'Contact',
        'ContactMode',
        'ContactState',
        'Conversation',
        'ConversationKind',
        'Credential',
        'CredentialKind',
        'DeskUnavailableKind',
        'DirectoryEntry',
        'DraftRequest',
        'Locale',
        'Member',
        'MemberKind',
        'MemberStatus',
        'Note',
        'NoteBasis',
        'NoteBody',
        'NoteStatus',
        'Notice',
        'NoticeKind',
        'NotificationLevel',
        'Origin',
        'Presence',
        'PublicText',
        'Receipt',
        'ReceiptState',
        'Relation',
        'Role',
        'Settings',
        'Channel',
        'ChannelMember',
        'ChannelSlug',
        'ChannelVisibility',
        'WhoCanInvite',
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
        'agentClient',
        'agentModel',
        'agentName',
        'approvedBy',
        'basis',
        'authorId',
        'body',
        'conversationId',
        'createdAt',
        'fromDebate',
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

  it('reads settings with or without the retention older web clients still send, and checks the rest', () => {
    const settings = { allowedDomains: ['example.com'], contactMode: 'open', auditRetentionDays: null }
    expect(model.Settings.is(settings)).toBe(true)
    expect(model.Settings.is({ allowedDomains: [], contactMode: 'open' })).toBe(true)
    expect(model.Settings.is({ ...settings, auditRetentionDays: 0 })).toBe(false)
    expect(model.Settings.is({ ...settings, allowedDomains: ['Example.com'] })).toBe(false)
    expect(model.Settings.is({ ...settings, contactMode: 'closed' })).toBe(false)
  })

  it('needs at least one participant in a conversation', () => {
    const conversation = fc.sample(arbitrary(model.Conversation, refinements), 1)[0]!
    expect(model.Conversation.is({ ...conversation, participantIds: [] })).toBe(false)
  })

  it('only knows the two credential kinds', () => {
    expect(model.CredentialKind.is('human')).toBe(true)
    expect(model.CredentialKind.is('agent')).toBe(true)
    expect(model.CredentialKind.is('admin')).toBe(false)
  })
  it('offers English first, as the default, and Korean', () => {
    expect(model.LOCALES).toEqual(['en', 'ko'])
    expect(model.DEFAULT_LOCALE).toBe('en')
    expect(model.Locale.is('ko')).toBe(true)
    expect(model.Locale.is('ko-KR')).toBe(false)
    expect(model.Locale.is('fr')).toBe(false)
  })

  it('requires a character on every member, null for the pigeon', () => {
    const member = fc.sample(arbitrary(model.Member, refinements), 1)[0]!
    const { character: _, ...withoutCharacter } = member
    expect(model.Member.is({ ...member, character: null })).toBe(true)
    expect(model.Member.is(withoutCharacter)).toBe(false)
  })

  it('knows a channel as open or private only', () => {
    expect(model.ChannelVisibility.is('open')).toBe(true)
    expect(model.ChannelVisibility.is('private')).toBe(true)
    expect(model.ChannelVisibility.is('secret')).toBe(false)
  })
})

describe('agentLabelOf', () => {
  it('drops control and format characters, such as a bidi override, and keeps one short line', () => {
    expect(model.agentLabelOf('‮edoC edualC‬ 2.1\n')).toBe('edoC edualC 2.1')
    expect(model.agentLabelOf(`  ${'x'.repeat(90)}`)).toBe('x'.repeat(model.AGENT_LABEL_MAX))
    expect(model.agentLabelOf(`${'y'.repeat(79)} z`)).toBe('y'.repeat(79))
  })

  it('gives nothing for a label that is blank, only invisible characters, or not text', () => {
    for (const value of ['', '   ', '​\u0007', 7, null, undefined, { name: 'x' }])
      expect(model.agentLabelOf(value)).toBeNull()
  })

  it('always gives a label the wire model accepts', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200, unit: 'binary' }), (text) => {
        const label = model.agentLabelOf(text)
        if (label !== null) expect(model.AgentLabel.is(label)).toBe(true)
      }),
    )
  })
})

describe('isPerson', () => {
  it('counts only a person, so that a kind a newer server adds is never one', () => {
    expect(model.isPerson({ kind: 'person' })).toBe(true)
    expect(model.isPerson({ kind: 'channel_agent' })).toBe(false)
    expect(model.isPerson({ kind: 'unknown' })).toBe(false)
    expect(model.MemberKind.read('robot')).toEqual({ _tag: 'Ok', value: 'unknown' })
  })
})
