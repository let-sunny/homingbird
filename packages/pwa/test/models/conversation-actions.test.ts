import { describe, expect, it } from 'vitest'
import { conversationActionsModel, offersAny } from '../../src/models/conversation-actions.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, ROOM, conversation } from '../support/fixtures.ts'

const group = conversation({ kind: 'group', participantIds: [ANA, BEN, CY] })

const actionsFor = (room = group, switches: { hideOn?: boolean; leaveOn?: boolean } = {}) =>
  conversationActionsModel({
    conversation: room,
    title: 'Ben, Cy',
    viewerId: ANA,
    hideOn: switches.hideOn ?? true,
    leaveOn: switches.leaveOn ?? true,
  })

describe('conversationActionsModel', () => {
  it('offers a group’s hide, a new group with its other people, and leave, each with what it does', () => {
    expect(actionsFor()).toEqual({
      hide: {
        conversationId: ROOM,
        hidden: false,
        label: 'Hide Ben, Cy from your list',
        hint: strings.places.hideHint,
        done: strings.places.hiddenNow({ name: 'Ben, Cy' }),
      },
      newGroup: {
        label: strings.places.newGroup,
        hint: strings.places.newGroupHint,
        href: `#/new?to=${encodeURIComponent(`${BEN},${CY}`)}`,
      },
      leave: {
        conversationId: ROOM,
        label: strings.places.leave,
        title: 'Leave Ben, Cy?',
        body: strings.places.leaveBody,
        done: strings.places.left({ name: 'Ben, Cy' }),
      },
    })
    expect(offersAny(actionsFor())).toBe(true)
  })

  it('says a hidden room stays listed while a draft waits, and that leaving discards the drafts', () => {
    const drafted = actionsFor(conversation({ ...group, draftCount: 2 }))
    expect(drafted.hide?.hint).toBe(strings.places.hideWithDraft)
    expect(drafted.leave?.body).toBe(strings.places.leaveBodyWithDrafts)
  })

  it('offers to show a hidden room again, saying nothing more once it is back', () => {
    expect(actionsFor(conversation({ ...group, hidden: true, draftCount: 1 })).hide).toEqual({
      conversationId: ROOM,
      hidden: true,
      label: 'Show Ben, Cy in your list again',
      hint: strings.places.hideHint,
      done: null,
    })
  })

  it('offers a direct message its hide only: it cannot be left, and a new group needs two others', () => {
    const direct = actionsFor(conversation())
    expect(direct.hide).not.toBeNull()
    expect(direct.leave).toBeNull()
    expect(direct.newGroup).toBeNull()
    expect(actionsFor(conversation({ kind: 'group', participantIds: [ANA, BEN] })).newGroup).toBeNull()
  })

  it('offers nothing in a channel room, a private question, an archived room or a room of an unknown kind', () => {
    for (const room of [
      conversation({ kind: 'channel' }),
      conversation({ ...group, privateQuestionOf: 'billing' }),
      conversation({ ...group, archivedAt: 5 }),
      conversation({ ...group, kind: 'unknown' }),
    ]) {
      expect(actionsFor(room)).toEqual({ hide: null, leave: null, newGroup: null })
      expect(offersAny(actionsFor(room))).toBe(false)
    }
  })

  it('leaves out what the server switched off, keeping a new group, which needs no switch', () => {
    expect(actionsFor(group, { hideOn: false, leaveOn: false })).toMatchObject({ hide: null, leave: null })
    expect(offersAny(actionsFor(group, { hideOn: false, leaveOn: false }))).toBe(true)
    expect(offersAny(actionsFor(conversation(), { hideOn: false }))).toBe(false)
  })
})
