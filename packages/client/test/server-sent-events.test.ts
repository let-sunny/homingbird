import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type ServerSentMessage, parseServerSentEvents } from '../src/server-sent-events.ts'

const collect = async (chunks: ReadonlyArray<string>): Promise<ServerSentMessage[]> => {
  const out: ServerSentMessage[] = []
  for await (const message of parseServerSentEvents(
    (async function* () {
      yield* chunks
    })(),
  ))
    out.push(message)
  return out
}

describe('parseServerSentEvents', () => {
  it('reads id, event and data', async () => {
    expect(await collect(['id: 7\nevent: note.sent\ndata: {"a":1}\n\n'])).toEqual([
      { id: '7', event: 'note.sent', data: '{"a":1}' },
    ])
  })

  it('defaults the event name and the id', async () => {
    expect(await collect(['data: hello\n\n'])).toEqual([{ id: null, event: 'message', data: 'hello' }])
  })

  it('joins several data lines with newlines', async () => {
    expect(await collect(['data: one\ndata: two\ndata:\n\n'])).toEqual([
      { id: null, event: 'message', data: 'one\ntwo\n' },
    ])
  })

  it('ignores comments, unknown fields and blocks without data', async () => {
    expect(await collect([': keep-alive\n\n', 'retry: 10\nevent: x\n\n', 'bogus\ndata: kept\n\n'])).toEqual([
      { id: null, event: 'message', data: 'kept' },
    ])
  })

  it('strips exactly one leading space from a value', async () => {
    expect(await collect(['data:  two spaces\n\n', 'data:none\n\n'])).toEqual([
      { id: null, event: 'message', data: ' two spaces' },
      { id: null, event: 'message', data: 'none' },
    ])
  })

  it('accepts LF, CRLF and CR line endings', async () => {
    const expected = [{ id: '1', event: 'e', data: 'd' }]
    expect(await collect(['id: 1\nevent: e\ndata: d\n\n'])).toEqual(expected)
    expect(await collect(['id: 1\r\nevent: e\r\ndata: d\r\n\r\n'])).toEqual(expected)
    expect(await collect(['id: 1\revent: e\rdata: d\r\r'])).toEqual(expected)
  })

  it('does not emit a message that was never terminated', async () => {
    expect(await collect(['data: complete\n\ndata: cut off'])).toEqual([
      { id: null, event: 'message', data: 'complete' },
    ])
    expect(await collect([])).toEqual([])
  })

  it('yields the same messages however the stream is split into chunks', async () => {
    const line = fc.stringMatching(/^[a-z0-9 {}":,.]{0,20}$/)
    const message = fc.record({
      id: fc.option(fc.nat().map(String), { nil: null }),
      event: fc.constantFrom('note.sent', 'presence', 'message'),
      data: fc.array(line, { minLength: 1, maxLength: 3 }),
    })
    const serialize = (m: { id: string | null; event: string; data: string[] }): string =>
      `${m.id === null ? '' : `id: ${m.id}\n`}event: ${m.event}\n${m.data.map((d) => `data: ${d}\n`).join('')}\n`
    await fc.assert(
      fc.asyncProperty(
        fc.array(message, { maxLength: 6 }),
        fc.array(fc.nat(40), { maxLength: 30 }),
        async (messages, cuts) => {
          const whole = messages.map(serialize).join(': ping\n\n')
          const chunks: string[] = []
          let rest = whole
          for (const cut of cuts) {
            chunks.push(rest.slice(0, cut))
            rest = rest.slice(cut)
          }
          chunks.push(rest)
          expect(await collect(chunks)).toEqual(await collect([whole]))
          expect(await collect([whole])).toEqual(
            messages.map((m) => ({ id: m.id, event: m.event, data: m.data.join('\n') })),
          )
        },
      ),
    )
  })
})
