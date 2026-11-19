import { contract } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { accountHandlers } from '../src/api/account-handlers.ts'
import { adminHandlers } from '../src/api/admin-handlers.ts'
import { channelHandlers } from '../src/api/channel-handlers.ts'
import { contactHandlers } from '../src/api/contact-handlers.ts'
import { credentialHandlers } from '../src/api/credential-handlers.ts'
import { debateHandlers } from '../src/api/debate-handlers.ts'
import { eventHandlers } from '../src/api/event-handlers.ts'
import { handlers } from '../src/api/handlers.ts'
import { noteHandlers } from '../src/api/note-handlers.ts'
import { teachingHandlers } from '../src/api/teaching-handlers.ts'

const GROUPS = {
  accountHandlers,
  adminHandlers,
  channelHandlers,
  contactHandlers,
  credentialHandlers,
  debateHandlers,
  eventHandlers,
  noteHandlers,
  teachingHandlers,
}

describe('the handlers', () => {
  it('answer every route of the contract, and nothing else', () => {
    expect(Object.keys(handlers).sort()).toEqual(Object.keys(contract).sort())
  })

  it('come from groups that never answer the same route twice', () => {
    const routes = Object.values(GROUPS).flatMap((group) => Object.keys(group))
    expect(new Set(routes).size).toBe(routes.length)
    expect(routes.length).toBe(Object.keys(contract).length)
  })

  it('keep each route in the group its name belongs to', () => {
    const owner = (route: string) => Object.entries(GROUPS).find(([, group]) => route in group)![0]
    expect(owner('drafts.send')).toBe('noteHandlers')
    expect(owner('principles.create')).toBe('teachingHandlers')
    expect(owner('admin.insights')).toBe('adminHandlers')
    expect(owner('debates.waiting')).toBe('debateHandlers')
    expect(owner('blocks.add')).toBe('contactHandlers')
  })
})
