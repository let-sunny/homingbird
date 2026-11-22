import { describe, expect, it } from 'vitest'
import { allowanceFrom, previewSettingsModel } from '../../src/models/preview-settings.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, channel, entry, me, member } from '../support/fixtures.ts'

const directory = [
  entry(CY, 'Cy'),
  entry(BEN, 'Ben'),
  entry(ANA, 'Ana'),
  entry('mem_wiki00000000' as never, 'Wiki', {
    member: member('mem_wiki00000000' as never, 'Wiki', { kind: 'channel_agent' }),
  }),
  entry('mem_gone00000000' as never, 'Gone', {
    member: member('mem_gone00000000' as never, 'Gone', { status: 'deactivated' }),
  }),
]

const input = (allowance: Parameters<typeof previewSettingsModel>[0]['allowance']) => ({
  me: me(),
  allowance,
  directory,
  channels: [channel('ops', { joined: true }), channel('wiki', { joined: false })],
})

describe('previewSettingsModel', () => {
  it('waits for the allowance, and says when it could not be read', () => {
    expect(previewSettingsModel(input(null))).toEqual({ kind: 'loading' })
    expect(previewSettingsModel(input('failed'))).toEqual({ kind: 'failed', text: strings.loadFailed })
  })

  it('offers the other active people by name and the channels the person is in, ticking what is allowed', () => {
    const model = previewSettingsModel(input({ people: [BEN], channels: ['ops'] }))
    expect(model).toEqual({
      kind: 'ready',
      intro: strings.draftPreviews.intro,
      people: [
        { value: BEN, label: 'Ben', checked: true },
        { value: CY, label: 'Cy', checked: false },
      ],
      noPeople: null,
      channels: [{ value: 'ops', label: '#ops', checked: true }],
      noChannels: null,
      summary: strings.draftPreviews.somebody({ people: '1', channels: '1' }),
    })
  })

  it('says nobody is allowed, and what to do when there is nobody or no channel to choose', () => {
    const model = previewSettingsModel({
      ...input({ people: [], channels: [] }),
      directory: [],
      channels: [],
    })
    expect(model).toMatchObject({
      noPeople: strings.draftPreviews.noPeople,
      noChannels: strings.draftPreviews.noChannels,
      summary: strings.draftPreviews.nobody,
    })
  })

  it('keeps a deactivated person who is still allowed, so that saving can take them out', () => {
    const model = previewSettingsModel(input({ people: ['mem_gone00000000' as never], channels: [] }))
    expect(model.kind === 'ready' && model.people.map((one) => one.label)).toEqual(['Ben', 'Cy', 'Gone'])
  })
})

describe('allowanceFrom', () => {
  it('keeps each ticked person and channel once, and drops what is not a member id', () => {
    expect(allowanceFrom([BEN, BEN, 'nonsense'], ['ops', 'ops'])).toEqual({
      people: [BEN],
      channels: ['ops'],
    })
  })
})
