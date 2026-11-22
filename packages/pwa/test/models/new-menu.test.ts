import { describe, expect, it } from 'vitest'
import { newMenuModel } from '../../src/models/new-menu.ts'
import { strings } from '../../src/strings.ts'
import { everything, serverInfo } from '../support/fixtures.ts'

describe('newMenuModel', () => {
  it('offers a message, a channel and a debate room, each with a sentence saying which to pick', () => {
    const model = newMenuModel(everything())
    expect([model.label, model.trigger]).toEqual([strings.newMenu.label, strings.newMenu.trigger])
    expect(model.items).toEqual([
      {
        kind: 'message',
        label: strings.newMenu.message,
        hint: strings.newMenu.messageHint,
        href: '#/new',
      },
      { kind: 'channel', label: strings.newMenu.channel, hint: strings.newMenu.channelHint },
      { kind: 'debate', label: strings.newMenu.debate, hint: strings.newMenu.debateHint },
    ])
  })

  it('leaves out what the organization has switched off', () => {
    const off = serverInfo({ channels: false, debateRooms: false })
    expect(newMenuModel(off).items.map((item) => item.kind)).toEqual(['message'])
  })
})
