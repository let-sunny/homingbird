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
      quoted: 'x'.repeat(200),
      channelsOn: true,
    })
    expect(model.choices.map((choice) => choice.value)).toEqual(['a', 'b'])
    expect(model.first).toBe('a')
    expect(model.mayCreate).toBe(true)
    expect(model.none).toBeNull()
    expect(model.quote).toHaveLength(140)
  })

  it('says when there is nowhere else to go', () => {
    expect(pickerModel({ channels: [], here: null, quoted: '', channelsOn: true })).toMatchObject({
      none: strings.noOtherChannel,
      first: NEW_CHANNEL,
    })
  })

  it('offers no new channel where channels are off', () => {
    expect(pickerModel({ channels: [], here: null, quoted: '', channelsOn: false }).mayCreate).toBe(false)
  })
})

describe('newChannelFrom', () => {
  it('needs a valid name, and takes the description as optional', () => {
    expect(newChannelFrom(' Ops- ', ' Operations ')).toEqual({ slug: 'ops', description: 'Operations' })
    expect(newChannelFrom('---', 'Operations')).toBeNull()
    expect(newChannelFrom('ops', '  ')).toEqual({ slug: 'ops', description: '' })
  })
})
