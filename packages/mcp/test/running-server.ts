import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type RecordedCall, SERVER_URL, fetchThrough } from '../../cli/test/server-fetch.ts'
import { type Session, type TestServer, startTestServer } from '../../dovecote/test/harness.ts'

export { SERVER_URL }
export type { RecordedCall }

export interface RunningServer {
  readonly server: TestServer
  readonly owner: Session
  readonly fetch: ReturnType<typeof fetchThrough>
  readonly recorded: RecordedCall[]
  readonly credentialPath: string
  readonly launched: string[][]
  readonly launch: (argv: ReadonlyArray<string>) => Promise<void>
  readonly until: (condition: () => boolean | Promise<boolean>) => Promise<void>
  readonly decide: (text: string, decision?: { approve: boolean }) => Promise<void>
  readonly agentOnline: () => Promise<boolean>
}

export const CODE = /[A-Z]{4}-[A-Z]{4}/

export const startRunningServer = async (): Promise<RunningServer> => {
  const server = await startTestServer()
  const owner = await server.signIn('ana@example.com', 'Ana')
  const recorded: RecordedCall[] = []
  const launched: string[][] = []
  const until: RunningServer['until'] = async (condition) => {
    for (let turn = 0; turn < 400; turn++) {
      if (await condition()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('the awaited condition never came true')
  }
  return {
    server,
    owner,
    recorded,
    launched,
    until,
    launch: async (argv) => void launched.push([...argv]),
    fetch: fetchThrough(server, recorded),
    credentialPath: join(await mkdtemp(join(tmpdir(), 'homingbird-mcp-')), 'mcp-credentials.json'),
    decide: async (text, decision = { approve: true }) => {
      const code = CODE.exec(text)?.[0]
      if (code === undefined) throw new Error(`no user code in: ${text}`)
      await owner.api('POST', `/device/${code}`, { ...decision, name: 'Cursor on laptop' })
      await server.clock.advance(5_000)
    },
    agentOnline: async () =>
      (await owner.api('GET', '/directory')).json.entries.find((entry: any) => entry.relation === 'self')
        .presence.agentOnline,
  }
}
