import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Task as T } from '../packages/kernel/src/index.ts'
import { loadConfig } from '../packages/dovecote/src/config.ts'
import { issueCredential } from '../packages/dovecote/src/domain/credentials.ts'
import { signInMember } from '../packages/dovecote/src/domain/members.ts'
import { startServer } from '../packages/dovecote/src/http/node-server.ts'
import { buildRuntime } from '../packages/dovecote/src/runtime.ts'
import { openDatabase } from '../packages/dovecote/src/sql/open.ts'
import { migrate } from '../packages/dovecote/src/sql/schema.ts'

const { values: options } = parseArgs({
  options: {
    role: { type: 'string', default: 'driver' },
    members: { type: 'string', default: '100' },
    'exchanges-per-minute': { type: 'string', default: '60' },
    seconds: { type: 'string', default: '60' },
    port: { type: 'string', default: '8190' },
    'database-url': { type: 'string', default: '' },
    seats: { type: 'string', default: '' },
  },
})

const members = Number(options.members)
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
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  await new Promise<void>((ready) =>
    server.stdout!.on('data', (chunk: Buffer) => chunk.toString().includes('ready') && ready()),
  )
  const seats = JSON.parse(readFileSync(seatsFile, 'utf8')) as Seat[]

  const stopStreams = new AbortController()
  const arrivals = new Map<string, (at: number) => void>()
  await Promise.all(seats.map((seat) => holdStream(seat, arrivals, stopStreams.signal)))
  await pause(1_000)
  const idle = sample(server)

  const sendLatencies: number[] = []
  const deliveryLatencies: number[] = []
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
    inFlight.push(
      exchange(asker, answerer, arrivals, sendLatencies, deliveryLatencies).catch((error) =>
        console.error(String(error)),
      ),
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
    }),
  )
  process.exit(0)
}

async function exchange(
  asker: Seat,
  answerer: Seat,
  arrivals: Map<string, (at: number) => void>,
  sendLatencies: number[],
  deliveryLatencies: number[],
): Promise<void> {
  const question = await call(asker.agentToken, 'POST', '/drafts', {
    to: [answerer.memberId],
    body: QUESTION,
  })
  const sentAt = performance.now()
  const delivered = new Promise<number>((resolve) => arrivals.set(question.id, resolve))
  await call(asker.humanToken, 'POST', `/drafts/${question.id}/send`, {})
  sendLatencies.push(performance.now() - sentAt)
  deliveryLatencies.push((await delivered) - sentAt)
  await call(answerer.agentToken, 'POST', `/notes/${question.id}/pickup`)
  const reply = await call(answerer.agentToken, 'POST', '/drafts', { inReplyTo: question.id, body: ANSWER })
  await call(answerer.humanToken, 'POST', `/notes/${question.id}/read`)
  await call(answerer.humanToken, 'POST', `/drafts/${reply.id}/send`, {})
}

async function holdStream(
  seat: Seat,
  arrivals: Map<string, (at: number) => void>,
  signal: AbortSignal,
): Promise<void> {
  for (const token of [seat.humanToken, seat.agentToken]) {
    const response = await fetch(`${serverUrl}/api/v1/events/stream`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    })
    if (token === seat.agentToken) void watch(response, arrivals).catch(() => {})
    else void drain(response).catch(() => {})
  }
}

async function watch(response: Response, arrivals: Map<string, (at: number) => void>): Promise<void> {
  const decoder = new TextDecoder()
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    const text = decoder.decode(chunk)
    if (!text.includes('event: note.sent')) continue
    for (const match of text.matchAll(/"note":\{"id":"(note_[0-9a-z]+)"/g)) {
      arrivals.get(match[1]!)?.(performance.now())
      arrivals.delete(match[1]!)
    }
  }
}

async function drain(response: Response): Promise<void> {
  for await (const _ of response.body as unknown as AsyncIterable<Uint8Array>) continue
}

async function call(token: string, method: string, path: string, body?: unknown): Promise<{ id: string }> {
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

function sample(server: ChildProcess): { cpuMs: number; rssMb: number } {
  const fields = readFileSync(`/proc/${server.pid}/stat`, 'utf8').split(') ')[1]!.split(' ')
  const ticks = Number(fields[11]) + Number(fields[12])
  const status = readFileSync(`/proc/${server.pid}/status`, 'utf8')
  return { cpuMs: ticks * 10, rssMb: Number(/VmRSS:\s+(\d+)/.exec(status)![1]) / 1024 }
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
  })
  if (config._tag === 'Err') throw new Error(config.error.join('; '))
  const database = await openDatabase(databaseUrl)
  const { env, background } = buildRuntime({ config: config.value, database, log: () => {} })
  await T.runPromise(migrate, env)
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
          client: 'load-test',
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
  await startServer(env, port)
  process.stdout.write('ready\n')
}

