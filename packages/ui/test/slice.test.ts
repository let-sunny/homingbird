import { describe, expect, it } from 'vitest'
import { signal } from '../src/signal.ts'
import { slice } from '../src/slice.ts'

describe('slice', () => {
  it('changes only when the part it computes holds different data', () => {
    const rooms = signal([{ id: 'a', title: 'Ana', preview: 'hi' }])
    const titles = slice([rooms], () => rooms.get().map((room) => ({ title: room.title })))
    const seen: unknown[] = []
    titles.subscribe((value) => seen.push(value))
    rooms.set([{ id: 'a', title: 'Ana', preview: 'hello' }])
    expect(seen).toEqual([])
    rooms.set([{ id: 'a', title: 'Ana Silva', preview: 'hello' }])
    expect(seen).toEqual([[{ title: 'Ana Silva' }]])
    expect(titles.get()).toEqual([{ title: 'Ana Silva' }])
  })
})
