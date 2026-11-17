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
  readonly announced: string[]
  readonly until: (condition: () => boolean) => Promise<void>
  readonly approveAnnouncedCode: (decision?: { approve: boolean }) => Promise<void>
}

export const startRunningServer = async (): Promise<RunningServer> => {
  const server = await startTestServer()
  const owner = await server.signIn('ana@example.com', 'Ana')
  const recorded: RecordedCall[] = []
  const announced: string[] = []
  const until = async (condition: () => boolean): Promise<void> => {
    for (let turn = 0; turn < 400 && !condition(); turn++) await new Promise((resolve) => setTimeout(resolve, 5))
    if (!condition()) throw new Error('the awaited condition never came true')
  }
  const approved = new Set<string>()
  const pendingCode = (): string | undefined =>
    announced.flatMap((line) => line.match(CODE) ?? []).find((code) => !approved.has(code))
  return {
    server,
    owner,
    recorded,
    announced,
    until,
    fetch: fetchThrough(server, recorded),
    credentialPath: join(await mkdtemp(join(tmpdir(), 'homingbird-mcp-')), 'mcp-credentials.json'),
    approveAnnouncedCode: async (decision = { approve: true }) => {
      await until(() => pendingCode() !== undefined)
      const code = pendingCode()!
      approved.add(code)
      await owner.api('POST', `/device/${code}`, { ...decision, name: 'Cursor on laptop' })
      await server.clock.advance(5_000)
    },
  }
}

const CODE = /[A-Z]{4}-[A-Z]{4}/
