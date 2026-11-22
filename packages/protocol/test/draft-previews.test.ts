import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  DraftPreview,
  DraftPreviewAllowance,
  NO_DRAFT_PREVIEWS,
  type PreviewPlace,
  isPreviewableDraft,
  previewViewers,
} from '../src/draft-previews.ts'
import { MemberId } from '../src/ids.ts'

const author = MemberId.of('authorauthor1')
const lee = MemberId.of('leeleeleelee1')
const mo = MemberId.of('momomomomomo1')

const place = (overrides: Partial<PreviewPlace> = {}): PreviewPlace => ({
  kind: 'direct',
  participantIds: [author, lee],
  channel: null,
  isPrivateQuestion: false,
  ...overrides,
})

describe('who sees an unconfirmed draft', () => {
  it('shows nothing to anyone by default', () => {
    expect(previewViewers(NO_DRAFT_PREVIEWS, author, place())).toEqual([])
    expect(previewViewers(NO_DRAFT_PREVIEWS, author, place({ kind: 'channel', channel: 'ops' }))).toEqual([])
  })

  it('shows a direct or group conversation’s draft to the allowed people in it only', () => {
    const allowance = { people: [lee], channels: [] }
    expect(previewViewers(allowance, author, place())).toEqual([lee])
    expect(
      previewViewers(allowance, author, place({ kind: 'group', participantIds: [author, lee, mo] })),
    ).toEqual([lee])
    expect(previewViewers({ people: [author], channels: [] }, author, place())).toEqual([])
  })

  it('shows a channel room’s draft to everyone in the room when the channel is allowed', () => {
    const room = place({ kind: 'channel', channel: 'ops', participantIds: [author, lee, mo] })
    expect(previewViewers({ people: [], channels: ['ops'] }, author, room)).toEqual([lee, mo])
    expect(previewViewers({ people: [lee], channels: ['wiki'] }, author, room)).toEqual([])
    expect(previewViewers({ people: [], channels: ['ops'] }, author, { ...room, channel: null })).toEqual([])
  })

  it('never shows a private question’s draft, nor one in a kind of place this client does not know', () => {
    const everything = { people: [lee, mo], channels: ['ops'] }
    expect(previewViewers(everything, author, place({ isPrivateQuestion: true }))).toEqual([])
    expect(
      previewViewers(everything, author, place({ kind: 'channel', channel: 'ops', isPrivateQuestion: true })),
    ).toEqual([])
    expect(previewViewers(everything, author, place({ kind: 'unknown' }))).toEqual([])
  })

  it('never shows the author as a viewer of their own draft, whatever the allowance', () => {
    fc.assert(
      fc.property(
        arbitrary(DraftPreviewAllowance),
        fc.constantFrom('direct', 'group', 'channel', 'unknown'),
        fc.boolean(),
        (allowance, kind, isPrivateQuestion) => {
          const viewers = previewViewers({ ...allowance, people: [...allowance.people, author] }, author, {
            kind,
            participantIds: [author, ...allowance.people],
            channel: allowance.channels[0] ?? null,
            isPrivateQuestion,
          })
          expect(viewers).not.toContain(author)
        },
      ),
    )
  })
})

describe('which drafts preview', () => {
  it('previews only a draft its person’s agent wrote', () => {
    expect(isPreviewableDraft({ status: 'draft', agentName: 'Desk' })).toBe(true)
    expect(isPreviewableDraft({ status: 'draft', agentName: null })).toBe(false)
    expect(isPreviewableDraft({ status: 'sent', agentName: 'Desk' })).toBe(false)
    expect(isPreviewableDraft({ status: 'draft', agentName: 'Desk', fromDebate: {} })).toBe(false)
  })
})

describe('the preview read model', () => {
  it('round-trips every generated preview and allowance', () => {
    fc.assert(
      fc.property(arbitrary(DraftPreview), arbitrary(DraftPreviewAllowance), (preview, allowance) => {
        expect(DraftPreview.decode(JSON.parse(JSON.stringify(preview)))).toMatchObject({ _tag: 'Ok' })
        expect(DraftPreviewAllowance.decode(JSON.parse(JSON.stringify(allowance)))).toMatchObject({
          _tag: 'Ok',
        })
      }),
      { numRuns: 50 },
    )
  })

  it('reads a state a newer server added as unknown, and carries no basis or agent internals', () => {
    const preview = {
      noteId: 'note_abcdefghijkl',
      conversationId: 'conv_abcdefghijkl',
      authorId: author,
      agentName: 'Desk',
      inReplyTo: null,
      state: 'pending_review',
      body: 'hello',
      createdAt: 1,
      updatedAt: 1,
    }
    const decoded = DraftPreview.read(preview)
    expect(decoded).toMatchObject({ _tag: 'Ok', value: { state: 'unknown' } })
    expect(Object.keys(DraftPreview.fields)).not.toContain('basis')
  })
})
