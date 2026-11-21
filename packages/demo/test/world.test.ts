import { makeTestClock } from '@homingbird/kernel'
import { ConversationId, MemberId, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { createWorld } from '../src/world.ts'
import { NOW } from './support/demo.ts'

const ana = MemberId.of('demoana00000')
const ben = MemberId.of('demoben00000')
const moved = (seq: number) => ({
  type: 'note.moved' as const,
  noteId: NoteId.of(`demonote${String(seq).padStart(4, '0')}`),
  fromConversationId: ConversationId.of('demowithana0'),
  toConversationId: ConversationId.of('demowithben0'),
})

describe('createWorld', () => {
  it('starts from the seeded team at the clock’s time and replaces its records whole', () => {
    const world = createWorld(makeTestClock(NOW))
    expect(world.startedAt).toBe(NOW)
    expect(world.records().members.length).toBeGreaterThan(0)
    world.update((records) => ({ ...records, notes: [] }))
    expect(world.records().notes).toEqual([])
  })

  it('delivers an event only to the members it names, and keeps it for a stream that comes back', () => {
    const world = createWorld(makeTestClock(NOW))
    const heard: number[] = []
    const stop = world.listen(ana, (event) => heard.push(event.seq))
    world.emit([ana], moved(1))
    world.emit([ben], moved(2))
    stop()
    world.emit([ana], moved(3))
    expect(heard).toEqual([1])
    expect(world.eventsAfter(ana, 0).map((event) => event.seq)).toEqual([1, 3])
    expect(world.eventsAfter(ana, 1).map((event) => event.seq)).toEqual([3])
    expect(world.eventsAfter(ben, 0)).toEqual([{ seq: 2, at: NOW, body: moved(2) }])
  })

  it('makes new identifiers that read as their kind and never repeat', () => {
    const world = createWorld(makeTestClock(NOW))
    const first = world.nextId('note')
    const second = world.nextId('note')
    expect(NoteId.decode(first)._tag).toBe('Ok')
    expect(second).not.toBe(first)
  })
})
