import { describe, expect, it } from 'vitest'
import { muteToggleModel } from '../../src/models/mute-toggle.ts'
import { strings } from '../../src/strings.ts'
import { ROOM, conversation } from '../support/fixtures.ts'

describe('muteToggleModel', () => {
  it('offers to mute a conversation, named for it, with what muting would do', () => {
    expect(muteToggleModel(conversation(), 'Ben', true)).toEqual({
      conversationId: ROOM,
      muted: false,
      label: 'Mute Ben',
      mark: null,
      hint: strings.mute.hint,
    })
  })

  it('offers to lift the mute of a muted conversation, marks it, and says it is muted', () => {
    expect(muteToggleModel(conversation({ muted: true }), '#billing', true)).toEqual({
      conversationId: ROOM,
      muted: true,
      label: 'Unmute #billing',
      mark: strings.mute.muted,
      hint: strings.mute.hintMuted,
    })
  })

  it('offers nothing while muting is off, or in an archived room that receives nothing', () => {
    expect(muteToggleModel(conversation({ muted: true }), 'Ben', false)).toBeNull()
    expect(muteToggleModel(conversation({ archivedAt: 5 }), '#old', true)).toBeNull()
  })
})
