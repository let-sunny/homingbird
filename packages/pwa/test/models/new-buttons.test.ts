import { describe, expect, it } from 'vitest'
import { newButtonsModel } from '../../src/models/new-buttons.ts'
import { strings } from '../../src/strings.ts'
import { everything, serverInfo } from '../support/fixtures.ts'

describe('newButtonsModel', () => {
  it('starts a message from Direct messages and a channel from Channels, each with its hint', () => {
    expect(newButtonsModel(everything())).toEqual({
      message: { label: strings.newMessageButton, hint: strings.hints.newMessage, href: '#/new' },
      channel: { label: strings.newChannel, hint: strings.hints.newChannel },
    })
  })

  it('offers no new channel where the organization has switched channels off', () => {
    const model = newButtonsModel(serverInfo({ channels: false }))
    expect([model.message.href, model.channel]).toEqual(['#/new', null])
  })
})
