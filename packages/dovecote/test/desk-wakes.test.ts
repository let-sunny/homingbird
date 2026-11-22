import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openWakeTarget } from '../src/wake/desk-wakes.ts'
import {
  ROUTINE_URL,
  WAKE_TOKEN,
  agentCredentialOf,
  routineSetup,
  startCloudDeskServer,
} from './cloud-desk-support.ts'
import { type Session, TEST_SECRETS_KEY, type TestServer, connectAgent, storedRows } from './harness.ts'

let server: TestServer
let ana: Session

beforeEach(async () => {
  server = await startCloudDeskServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  await connectAgent(server, ana, { name: 'Cloud desk' })
  await ana.api('PUT', '/me/desk-wake', routineSetup(await agentCredentialOf(ana)))
})

afterEach(() => server?.close())

const storedWake = async () =>
  (await storedRows(server, 'desk_wakes'))[0] as { sealed: string; member_id: string }

describe('a stored wake', () => {
  it('opens with the server’s key for its own member only', async () => {
    const row = await storedWake()
    const key = Buffer.from(TEST_SECRETS_KEY, 'base64')
    expect(openWakeTarget(key, row as never)).toEqual({
      url: ROUTINE_URL,
      headers: [
        { name: 'Authorization', value: `Bearer ${WAKE_TOKEN}` },
        { name: 'anthropic-version', value: '2023-06-01' },
      ],
    })
    expect(openWakeTarget(key, { ...row, member_id: 'mem_ben000000000' } as never)).toBeNull()
    expect(openWakeTarget(Buffer.alloc(32, 9), row as never)).toBeNull()
    expect(openWakeTarget(null, row as never)).toBeNull()
  })

  it('reads as stopped and asks to be set up again when the key changed', async () => {
    const otherKey = Buffer.alloc(32, 8).toString('base64')
    const read = await server.requestWithSettings({ HB_SECRETS_KEY: otherKey })(
      'GET',
      '/api/v1/me/desk-wake',
      {
        cookie: ana.cookie,
      },
    )
    expect(read.json.wake).toMatchObject({
      host: 'api.anthropic.com',
      headerNames: [],
      stoppedBecause: 'unreadable',
    })
  })
})
