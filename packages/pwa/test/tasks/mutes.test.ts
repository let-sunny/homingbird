import { describe, expect, it } from 'vitest'
import * as tasks from '../../src/tasks/mutes.ts'
import { testApp } from '../support/app.ts'
import { ROOM, conversation, me } from '../support/fixtures.ts'

const OTHER = 'conv_other0000000' as never

const answers = {
  'conversations.mute': () => conversation({ muted: true, unreadCount: 3 }),
  'conversations.unmute': () => conversation({ muted: false, unreadCount: 3 }),
  'me.notifications.set': () => ({ notifications: 'direct' }),
}

describe('mute tasks', () => {
  it('mutes and unmutes a conversation, changing that alone and only in its row of the list', async () => {
    const { run, state, routes } = testApp(answers)
    const other = conversation({ id: OTHER })
    state.conversations.set([conversation(), other])
    await run(tasks.setMuted(ROOM, true))
    expect(state.conversations.get()).toEqual([conversation({ muted: true }), other])
    await run(tasks.setMuted(ROOM, false))
    expect(state.conversations.get()[0]).toMatchObject({ muted: false })
    expect(state.conversations.get()[1]).toBe(other)
    expect(routes()).toEqual(['conversations.mute', 'conversations.unmute'])
  })

  it('saves the notification level and keeps it with the person signed in', async () => {
    const { run, state } = testApp(answers)
    state.session.set(me({ notifications: 'all' }))
    await run(tasks.chooseNotificationLevel('direct'))
    expect((state.session.get() as ReturnType<typeof me>).notifications).toBe('direct')
    state.session.set(null)
    await run(tasks.chooseNotificationLevel('direct'))
    expect(state.session.get()).toBeNull()
  })
})
