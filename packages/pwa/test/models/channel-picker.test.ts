import { describe, expect, it } from 'vitest'
import { NEW_CHANNEL, newChannelFrom, pickerModel } from '../../src/models/channel-picker.ts'
import { strings } from '../../src/strings.ts'
import { channel } from '../support/fixtures.ts'

describe('pickerModel', () => {
  it('offers the other channels, joined first, and a new one', () => {
    const here = channel('here', { joined: true })
    const model = pickerModel({
      channels: [here, channel('b'), channel('a', { joined: true })],
      here,
      movingFrom: here,
      quoted: 'x'.repeat(200),
      channelsOn: true,
    })
    expect(model.choices.map((choice) => choice.value)).toEqual(['a', 'b'])
    expect(model.first).toBe('a')
    expect(model.mayCreate).toBe(true)
    expect(model.none).toBeNull()
    expect(model.quote).toHaveLength(140)
  })

  it('says when there is nowhere else to go, from an open or a private channel', () => {
    expect(
      pickerModel({ channels: [], here: null, movingFrom: null, quoted: '', channelsOn: true }),
    ).toMatchObject({
      none: strings.noOtherChannel,
      first: NEW_CHANNEL,
    })
    const secret = channel('secret', { visibility: 'private', joined: true })
    expect(
      pickerModel({ channels: [secret], here: secret, movingFrom: secret, quoted: '', channelsOn: true }),
    ).toMatchObject({
      none: strings.noOtherPrivateChannel,
      mayCreate: false,
    })
  })
})

describe('newChannelFrom', () => {
  it('needs a valid name and a description', () => {
    expect(newChannelFrom(' Ops- ', ' Operations ')).toEqual({ slug: 'ops', description: 'Operations' })
    expect(newChannelFrom('---', 'Operations')).toBeNull()
    expect(newChannelFrom('ops', '  ')).toBeNull()
  })
})
