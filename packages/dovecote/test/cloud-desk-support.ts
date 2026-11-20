import { type Session, TEST_SECRETS_KEY, type TestServer, startTestServer } from './harness.ts'

export const ROUTINE_URL = 'https://api.anthropic.com/v1/claude_code/routines/trig_01ABCDEF/fire'
export const WAKE_TOKEN = 'sk-ant-oat01-wake-secret-0123456789abcdef'

export const routineSetup = (credentialId: string, overrides: Readonly<Record<string, unknown>> = {}) => ({
  url: ROUTINE_URL,
  headers: [
    { name: 'Authorization', value: `Bearer ${WAKE_TOKEN}` },
    { name: 'anthropic-version', value: '2023-06-01' },
  ],
  credentialId,
  enabled: true,
  ...overrides,
})

export const agentCredentialOf = async (person: Pick<Session, 'api'>): Promise<string> =>
  (await person.api('GET', '/credentials')).json.credentials.find(
    (each: { kind: string; revokedAt: number | null }) => each.kind === 'agent' && each.revokedAt === null,
  ).id

/** A wake service that records each request and answers with the next status queued, 200 once they run out. */
export interface FakeService {
  readonly calls: Array<{ readonly url: string; readonly init: RequestInit }>
  readonly wakes: () => ReadonlyArray<{ readonly url: string; readonly init: RequestInit }>
  readonly answers: Array<number | { readonly status: number; readonly retryAfter: string }>
  /** Holds the next wake unanswered until the returned function answers it with a status. */
  readonly holdNext: () => (status: number) => void
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>
}

export const fakeService = (): FakeService => {
  const calls: FakeService['calls'] = []
  const answers: FakeService['answers'] = []
  let held: Promise<number> | null = null
  return {
    calls,
    answers,
    holdNext: () => {
      let answer: (status: number) => void = () => {}
      held = new Promise<number>((resolve) => {
        answer = resolve
      })
      return (status) => answer(status)
    },
    wakes: () => calls.filter((call) => call.url.startsWith('https://api.anthropic.com/')),
    fetch: async (url, init) => {
      calls.push({ url, init: init ?? {} })
      if (!url.startsWith('https://api.anthropic.com/')) return new Response('', { status: 201 })
      if (held !== null) {
        const waiting = held
        held = null
        return new Response('{}', { status: await waiting })
      }
      const next = answers.shift() ?? 200
      return typeof next === 'number'
        ? new Response('{}', { status: next })
        : new Response('{}', { status: next.status, headers: { 'retry-after': next.retryAfter } })
    },
  }
}

export const startCloudDeskServer = (
  service: FakeService = fakeService(),
  overrides: Readonly<Record<string, string>> = {},
): Promise<TestServer> =>
  startTestServer(
    { HB_FEATURES: 'cloudDesk=on', HB_SECRETS_KEY: TEST_SECRETS_KEY, ...overrides },
    { fetch: service.fetch as never },
  )
