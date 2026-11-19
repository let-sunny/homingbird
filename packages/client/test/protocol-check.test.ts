import { Task as T } from '@homingbird/kernel'
import { type Api, PROTOCOL_VERSION, Unavailable } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { requireReadableServer } from '../src/protocol-check.ts'

const serverOf = (answer: T.Task<unknown, ReturnType<typeof Unavailable>>) =>
  ({ 'server.info': () => answer }) as unknown as Pick<Api, 'server.info'>

const failure = (message: string) => ({ _tag: 'Err', error: { _tag: 'Fail', error: { message } } })

describe('requireReadableServer', () => {
  it('lets a session start on a server of this protocol', async () => {
    expect(
      await T.run(requireReadableServer(serverOf(T.succeed({ protocolVersion: PROTOCOL_VERSION })))),
    ).toEqual({
      _tag: 'Ok',
      value: undefined,
    })
  })

  it('says in one sentence which side to upgrade', async () => {
    expect(
      await T.run(requireReadableServer(serverOf(T.succeed({ protocolVersion: PROTOCOL_VERSION + 1 })))),
    ).toMatchObject(
      failure('This Homingbird server is newer than this client understands; upgrade the client.'),
    )
    expect(await T.run(requireReadableServer(serverOf(T.succeed({ protocolVersion: 0 }))))).toMatchObject(
      failure('This Homingbird server is too old for this client; upgrade the server.'),
    )
  })

  it('passes on why a server could not be asked', async () => {
    expect(
      await T.run(requireReadableServer(serverOf(T.fail(Unavailable({ message: 'down' }))))),
    ).toMatchObject(failure('down'))
  })
})
