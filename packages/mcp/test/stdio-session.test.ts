import { Task as T } from '@homingbird/kernel'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { linesOf, runStdioSession } from '../src/stdio-session.ts'
import { ADAPTER_VERSION } from '../src/version.ts'
import { fakeApi, sequentialNonce } from './support.ts'

const chunksOf = async function* (chunks: ReadonlyArray<string | Uint8Array>) {
  yield* chunks
}

const collect = async (chunks: ReadonlyArray<string | Uint8Array>): Promise<string[]> => {
  const lines: string[] = []
  for await (const line of linesOf(chunksOf(chunks))) lines.push(line)
  return lines
}

const session = async (chunks: ReadonlyArray<string | Uint8Array>, signal?: AbortSignal) => {
  const written: string[] = []
  const exit = await T.run(
    runStdioSession({
      input: chunksOf(chunks),
      write: (line) => written.push(line),
      context: { api: fakeApi().api, serverVersion: ADAPTER_VERSION, nonce: sequentialNonce() },
    }),
    undefined,
    signal,
  )
  return { written, exit }
}

const request = (id: number, method: string, params: object = {}) =>
  `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`

describe('linesOf', () => {
  it('yields complete lines, skips blank ones, and flushes an unterminated last line', async () => {
    expect(await collect(['a\nb\n', '\n  \n', 'c'])).toEqual(['a', 'b', 'c'])
    expect(await collect([])).toEqual([])
    expect(await collect(['only\n'])).toEqual(['only'])
  })

  it('joins a line split across chunks, and a character split across byte chunks', async () => {
    const bytes = new TextEncoder().encode('{"text":"안녕"}\n')
    expect(await collect([bytes.subarray(0, 11), bytes.subarray(11)])).toEqual(['{"text":"안녕"}'])
    expect(await collect(['{"a"', ':1}\n{"b"', ':2}\n'])).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('yields the same lines however the input is cut into chunks', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.stringMatching(/^[ -~]{1,20}$/).filter((line) => line.trim() !== ''), { maxLength: 6 }),
        fc.array(fc.nat(200), { maxLength: 8 }),
        async (lines, cuts) => {
          const whole = lines.map((line) => `${line}\n`).join('')
          const points = [...new Set([0, ...cuts.map((cut) => cut % (whole.length + 1)), whole.length])].sort(
            (a, b) => a - b,
          )
          const chunks = points.slice(1).map((end, index) => whole.slice(points[index], end))
          expect(await collect(chunks)).toEqual(lines)
        },
      ),
    )
  })
})

describe('runStdioSession', () => {
  it('answers each request on its own line and nothing for a notification', async () => {
    const { written, exit } = await session([
      request(1, 'ping'),
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
      request(2, 'tools/list'),
    ])
    expect(exit._tag).toBe('Ok')
    expect(written).toHaveLength(2)
    expect(written.every((line) => line.endsWith('\n') && !line.slice(0, -1).includes('\n'))).toBe(true)
    expect(written.map((line) => JSON.parse(line).id)).toEqual([1, 2])
  })

  it('answers a line that is not JSON with a parse error and keeps going', async () => {
    const { written } = await session(['{not json\n', request(3, 'ping')])
    expect(JSON.parse(written[0]!)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    })
    expect(JSON.parse(written[1]!).id).toBe(3)
  })

  it('stops reading once it is interrupted', async () => {
    const stop = new AbortController()
    const written: string[] = []
    const input = (async function* () {
      yield request(1, 'ping')
      stop.abort()
      yield request(2, 'ping')
    })()
    const exit = await T.run(
      runStdioSession({
        input,
        write: (line) => written.push(line),
        context: { api: fakeApi().api, serverVersion: ADAPTER_VERSION, nonce: sequentialNonce() },
      }),
      undefined,
      stop.signal,
    )
    expect(exit).toMatchObject({ _tag: 'Err', error: { _tag: 'Interrupt' } })
    expect(written.map((line) => JSON.parse(line).id)).toEqual([1])
  })
})
