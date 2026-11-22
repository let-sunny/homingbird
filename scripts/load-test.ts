import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig } from '../packages/dovecote/src/config.ts'
import { seedChannels } from '../packages/dovecote/src/domain/channels.ts'
import { BROWSER_SIGN_IN_CLIENT, issueCredential } from '../packages/dovecote/src/domain/credentials.ts'
import { signInMember } from '../packages/dovecote/src/domain/members.ts'
import { startServer } from '../packages/dovecote/src/http/node-server.ts'
import { buildRuntime } from '../packages/dovecote/src/runtime.ts'
import { openDatabase } from '../packages/dovecote/src/sql/open.ts'
import { migrate } from '../packages/dovecote/src/sql/schema.ts'
import { Task as T } from '../packages/kernel/src/index.ts'

const { values: options } = parseArgs({
  options: {
    role: { type: 'string', default: 'driver' },
    members: { type: 'string', default: '100' },
    'exchanges-per-minute': { type: 'string', default: '60' },
    seconds: { type: 'string', default: '60' },
    port: { type: 'string', default: '8190' },
    'database-url': { type: 'string', default: '' },
    seats: { type: 'string', default: '' },
    'channel-share': { type: 'string', default: '0' },
    scenario: { type: 'string', default: '' },
  },
})

/**
 * A 40-person company at a busy hour, measured against its worst room: every person and their agent
 * hold a stream (80), and three exchanges in ten are asked in a channel all 40 joined.
 */
const COMPANY = { members: '40', 'exchanges-per-minute': '30', seconds: '120', 'channel-share': '0.3' }

if (options.scenario === 'company') Object.assign(options, { ...COMPANY, ...explicitOptions() })
else if (options.scenario !== '')
  throw new Error(`unknown scenario ${options.scenario}; the one known is company`)

const members = Number(options.members)
const channelShare = Number(options['channel-share'])
const exchangesPerMinute = Number(options['exchanges-per-minute'])
const seconds = Number(options.seconds)
const port = Number(options.port)
const serverUrl = `http://127.0.0.1:${port}`
const seatsFile = options.seats || join(tmpdir(), `homingbird-load-${port}.json`)
const databaseUrl = options['database-url'] || `sqlite:${join(tmpdir(), `homingbird-load-${port}.sqlite`)}`

interface Seat {
  readonly memberId: string
  readonly humanToken: string
  readonly agentToken: string
}

const CHANNEL = 'company'

const STREAM_KINDS = ['human', 'agent'] as const

const ARRIVAL_PATIENCE_MS = 20_000

const asShown = (draft: Created) => ({ body: draft.body, conversationId: draft.conversationId })

const QUESTION =
  'Is the billing migration safe to run today? The plan is at https://example.com/plans/billing-migration and I would like a second opinion before four.'
const ANSWER =
  'Yes. I checked the lock ordering and the backfill batch size; both are fine for the current table size. Run it after the nightly export finishes.'

if (options.role === 'server') await runServer()
else await runDriver()

async function runDriver(): Promise<void> {
  if (databaseUrl.startsWith('sqlite:'))
    for (const suffix of ['', '-wal', '-shm']) rmSync(databaseUrl.slice(7) + suffix, { force: true })
  const server = spawn(
    process.execPath,
    [
      ...process.execArgv,
      process.argv[1]!,
      '--role',
      'server',
      '--members',
      String(members),
      '--port',
      String(port),
      '--database-url',
      databaseUrl,
      '--seats',
      seatsFile,
      '--channel-share',
      String(channelShare),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  await new Promise<void>((ready) =>
    server.stdout!.on('data', (chunk: Buffer) => chunk.toString().includes('ready') && ready()),
  )
  const seats = JSON.parse(readFileSync(seatsFile, 'utf8')) as Seat[]
  if (channelShare > 0)
    for (const seat of seats) await call(seat.humanToken, 'PUT', `/channels/${CHANNEL}/membership`, {})

  const stopStreams = new AbortController()
  const arrivals: Arrivals = new Map()
  await Promise.all(seats.map((seat) => holdStream(seat, arrivals, stopStreams.signal)))
  await pause(1_000)
  const idle = sample(server)

  const sendLatencies: number[] = []
  const deliveryLatencies: number[] = []
  const fanOutLatencies: number[] = []
  const startedAt = performance.now()
  const before = sample(server)
  const total = Math.round((exchangesPerMinute * seconds) / 60)
  const inFlight: Promise<void>[] = []
  for (let index = 0; index < total; index++) {
    const dueAt = startedAt + (index * 60_000) / exchangesPerMinute
    await pause(Math.max(0, dueAt - performance.now()))
    const asker = seats[index % seats.length]!
    const answerer =
      seats[
        (index * 7 + 1) % seats.length === index % seats.length
          ? (index + 1) % seats.length
          : (index * 7 + 1) % seats.length
      ]!
    const inChannel = channelShare > 0 && (index * 37) % 100 < channelShare * 100
    inFlight.push(
      exchange(asker, answerer, inChannel ? seats : null, arrivals, {
        send: sendLatencies,
        delivery: deliveryLatencies,
        fanOut: fanOutLatencies,
      }).catch((error) => console.error(String(error))),
    )
  }
  await Promise.all(inFlight)
  const elapsedMs = performance.now() - startedAt
  const after = sample(server)
  stopStreams.abort()
  server.kill('SIGTERM')

  const cpuMs = after.cpuMs - before.cpuMs
  console.log(
    JSON.stringify({
      members,
      openStreams: members * 2,
      exchangesPerMinute,
      exchanges: total,
      channelExchanges: fanOutLatencies.length,
      notesPerMinute: exchangesPerMinute * 2,
      seconds: Math.round(elapsedMs / 1000),
      database: databaseUrl.split(':')[0],
      idleRssMb: Math.round(idle.rssMb),
      peakRssMb: Math.round(after.rssMb),
      cpuCoresUsed: Number((cpuMs / elapsedMs).toFixed(3)),
      cpuMsPerExchange: Number((cpuMs / total).toFixed(2)),
      sendP50Ms: percentile(sendLatencies, 0.5),
      sendP95Ms: percentile(sendLatencies, 0.95),
      deliveryP50Ms: percentile(deliveryLatencies, 0.5),
      deliveryP95Ms: percentile(deliveryLatencies, 0.95),
      ...(fanOutLatencies.length > 0 && {
        channelFanOutP50Ms: percentile(fanOutLatencies, 0.5),
        channelFanOutP95Ms: percentile(fanOutLatencies, 0.95),
      }),
    }),
  )
  process.exit(0)
}

/**
 * One question and its reply. A direct question goes to the answerer; a channel question goes to the
 * room, and its fan-out runs from the send until every stream of every member in the room has it.
 */
async function exchange(
  asker: Seat,
  answerer: Seat,
  room: ReadonlyArray<Seat> | null,
  arrivals: Arrivals,
  latencies: { send: number[]; delivery: number[]; fanOut: number[] },
): Promise<void> {
  const question = await call(
    asker.agentToken,
    'POST',
    '/drafts',
    room === null ? { to: [answerer.memberId], body: QUESTION } : { channel: CHANNEL, body: QUESTION },
  )
  const listeners = (room ?? [answerer]).filter((seat) => seat.memberId !== asker.memberId)
  const sentAt = performance.now()
  const arrived = new Map(
    listeners.flatMap((seat) =>
      STREAM_KINDS.map((kind) => {
        const key = `${question.id}:${seat.memberId}:${kind}`
        return [key, new Promise<number>((resolve) => arrivals.set(key, resolve))] as const
      }),
    ),
  )
  const delivered = arrived.get(`${question.id}:${answerer.memberId}:agent`)!
  const everywhere = Promise.all(
    [...arrived].map(([key, arrival]) =>
      Promise.race([
        arrival,
        pause(ARRIVAL_PATIENCE_MS).then(() => {
          throw new Error(`no note.sent on ${key}`)
        }),
      ]),
    ),
  )
  await call(asker.humanToken, 'POST', `/drafts/${question.id}/send`, { expected: asShown(question) })
  latencies.send.push(performance.now() - sentAt)
  latencies.delivery.push((await delivered) - sentAt)
  if (room !== null) latencies.fanOut.push(Math.max(...(await everywhere)) - sentAt)
  await call(answerer.agentToken, 'POST', `/notes/${question.id}/pickup`)
  const reply = await call(answerer.agentToken, 'POST', '/drafts', { inReplyTo: question.id, body: ANSWER })
  await call(answerer.humanToken, 'POST', `/notes/${question.id}/read`)
  await call(answerer.humanToken, 'POST', `/drafts/${reply.id}/send`, { expected: asShown(reply) })
}

async function holdStream(seat: Seat, arrivals: Arrivals, signal: AbortSignal): Promise<void> {
  for (const kind of STREAM_KINDS) {
    const token = kind === 'agent' ? seat.agentToken : seat.humanToken
    const response = await fetch(`${serverUrl}/api/v1/events/stream`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    })
    void watch(response, `${seat.memberId}:${kind}`, arrivals).catch(() => {})
  }
}

/** Resolves the arrival waiting for each sent note this stream reads, event by event. */
async function watch(response: Response, stream: string, arrivals: Arrivals): Promise<void> {
  const decoder = new TextDecoder()
  let buffered = ''
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffered += decoder.decode(chunk, { stream: true })
    const events = buffered.split('\n\n')
    buffered = events.pop() ?? ''
    for (const event of events) {
      if (!event.includes('event: note.sent')) continue
      const id = /"note":\{"id":"(note_[0-9a-z]+)"/.exec(event)?.[1]
      const key = `${id}:${stream}`
      arrivals.get(key)?.(performance.now())
      arrivals.delete(key)
    }
  }
}

async function call(token: string, method: string, path: string, body?: unknown): Promise<Created> {
  const response = await fetch(`${serverUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
  if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`)
  return (await response.json()) as { id: string }
}

/** CPU time and resident memory of the server process, from /proc on Linux and from ps elsewhere. */
function sample(server: ChildProcess): { cpuMs: number; rssMb: number } {
  if (process.platform === 'linux') {
    const fields = readFileSync(`/proc/${server.pid}/stat`, 'utf8').split(') ')[1]!.split(' ')
    const ticks = Number(fields[11]) + Number(fields[12])
    const status = readFileSync(`/proc/${server.pid}/status`, 'utf8')
    return { cpuMs: ticks * 10, rssMb: Number(/VmRSS:\s+(\d+)/.exec(status)![1]) / 1024 }
  }
  const [rss = '0', time = '0:0'] = execFileSync('ps', ['-o', 'rss=,time=', '-p', String(server.pid)], {
    encoding: 'utf8',
  })
    .trim()
    .split(/\s+/)
  const [minutes = '0', seconds = '0'] = time.split(':')
  return { cpuMs: (Number(minutes) * 60 + Number(seconds)) * 1000, rssMb: Number(rss) / 1024 }
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0)
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runServer(): Promise<void> {
  const config = loadConfig({
    HB_PUBLIC_URL: serverUrl,
    HB_PORT: String(port),
    HB_DEV_LOGIN: '1',
    HB_ALLOWED_DOMAINS: 'example.com',
    HB_DATABASE_URL: databaseUrl,
    ...(channelShare > 0 && { HB_CHANNELS: CHANNEL }),
  })
  if (config._tag === 'Err') throw new Error(config.error.join('; '))
  const database = await T.runPromise(openDatabase(databaseUrl))
  const { env, background } = buildRuntime({ config: config.value, database, write: () => {} })
  await T.runPromise(migrate, env)
  await T.runPromise(seedChannels, env)
  T.runFork(background, env)
  const seats: Seat[] = []
  for (let index = 0; index < members; index++) {
    const email = `member${index}@example.com`
    const member = await T.runPromise(
      signInMember({ subject: `load|${email}`, email, name: `Member ${index}` }),
      env,
    )
    const issue = (kind: 'human' | 'agent') =>
      T.runPromise(
        issueCredential({
          memberId: member.id,
          kind,
          name: `load ${kind}`,
          client: kind === 'human' ? BROWSER_SIGN_IN_CLIENT : 'load-test',
          lifetimeMs: 3_600_000,
          refreshable: false,
        }),
        env,
      )
    seats.push({
      memberId: member.id,
      humanToken: (await issue('human')).token,
      agentToken: (await issue('agent')).token,
    })
  }
  writeFileSync(seatsFile, JSON.stringify(seats), { mode: 0o600 })
  await T.runPromise(startServer(env, port))
  process.stdout.write('ready\n')
}

interface Created {
  readonly id: string
  readonly body: string
  readonly conversationId: string
}

type Arrivals = Map<string, (at: number) => void>

/** The options given on the command line, which win over a scenario's. */
function explicitOptions(): Record<string, string> {
  const given = process.argv.slice(2)
  return Object.fromEntries(
    Object.keys(COMPANY)
      .filter((name) => given.includes(`--${name}`))
      .map((name) => [name, String(options[name as keyof typeof options])]),
  )
}
