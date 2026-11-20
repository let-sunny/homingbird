import { rmSync } from 'node:fs'
import { cpus, tmpdir, totalmem } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig } from '../packages/dovecote/src/config.ts'
import { BROWSER_SIGN_IN_CLIENT, issueCredential } from '../packages/dovecote/src/domain/credentials.ts'
import { type Contribution, teamsShown } from '../packages/dovecote/src/domain/disclosure.ts'
import { signInMember } from '../packages/dovecote/src/domain/members.ts'
import { startServer } from '../packages/dovecote/src/http/node-server.ts'
import { buildRuntime } from '../packages/dovecote/src/runtime.ts'
import { openDatabase } from '../packages/dovecote/src/sql/open.ts'
import { raw } from '../packages/dovecote/src/sql/query.ts'
import { migrate, tableNames } from '../packages/dovecote/src/sql/schema.ts'
import { type Clock, Task as T, systemClock } from '../packages/kernel/src/index.ts'

/** The pilot the roadmap names: what one team's first month on Dovecote looks like. */
export const PILOT_SIZE = {
  members: 50,
  agentsPerMember: 2,
  channels: 20,
  channelsPerMember: 6,
  answerersPerChannel: 4,
  days: 30,
  notesPerDay: 200,
  openDebates: 10,
  agentsPerDebate: 5,
} as const

export type PilotSize = typeof PILOT_SIZE

export type DraftOutcome = 'as_written' | 'edited' | 'discarded'

export interface PlannedExchange {
  readonly day: number
  readonly minute: number
  readonly asker: number
  readonly answerer: number
  readonly channel: number | null
  readonly draftedByAgent: boolean
  readonly agent: number
  readonly question: DraftOutcome
  readonly reply: DraftOutcome | 'released'
}

export interface ChannelPlan {
  readonly members: ReadonlyArray<number>
  readonly answerers: ReadonlyArray<number>
}

export interface Summary {
  readonly runs: number
  readonly medianMs: number
  readonly p95Ms: number
  readonly maxMs: number
}

/** A seeded generator, so two runs seed the same history and their numbers compare. */
export const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Who is in which channel and who answers there; every member is in some channels, none in all. */
export const planChannels = (size: PilotSize, random: () => number): ChannelPlan[] => {
  const rooms = Array.from({ length: size.channels }, () => new Set<number>())
  for (let member = 0; member < size.members; member++)
    for (const channel of pick(size.channels, size.channelsPerMember, random)) rooms[channel]!.add(member)
  return rooms.map((room) => {
    const members = [...room].sort((a, b) => a - b)
    const answerers = pick(members.length, Math.min(size.answerersPerChannel, members.length), random)
      .map((index) => members[index]!)
      .sort((a, b) => a - b)
    return { members, answerers }
  })
}

/**
 * The month of history: each exchange is a question and, unless it was discarded, a reply; so a day of
 * `notesPerDay / 2` exchanges sends about `notesPerDay` notes. Most drafts come from agents, a few are
 * written by the person, and decisions vary the way the figures are meant to show.
 */
export const planExchanges = (
  size: PilotSize,
  channels: ReadonlyArray<ChannelPlan>,
  random: () => number,
): PlannedExchange[] => {
  const perDay = Math.round(size.notesPerDay / 2)
  const exchanges: PlannedExchange[] = []
  for (let day = 0; day < size.days; day++)
    for (let index = 0; index < perDay; index++) {
      const minute = WORKDAY_START_MINUTE + Math.floor((index * WORKDAY_MINUTES) / perDay)
      const inChannel = random() < CHANNEL_SHARE
      const channel = inChannel ? Math.floor(random() * channels.length) : null
      const room = channel === null ? null : channels[channel]!
      const asker =
        room === null
          ? Math.floor(random() * size.members)
          : room.members[Math.floor(random() * room.members.length)]!
      const candidates = room?.answerers.filter((member) => member !== asker) ?? []
      const answerer =
        room === null
          ? (asker + 1 + Math.floor(random() * (size.members - 1))) % size.members
          : candidates[Math.floor(random() * candidates.length)]!
      exchanges.push({
        day,
        minute,
        asker,
        answerer,
        channel,
        draftedByAgent: random() < AGENT_SHARE,
        agent: Math.floor(random() * size.agentsPerMember),
        question: outcomeFor(random()),
        reply: random() < RELEASE_SHARE ? 'released' : outcomeFor(random()),
      })
    }
  return exchanges
}

/** An organization of the pilot's size with teams that overlap, as an administrator makes them. */
export const TEAM_SIZE = { members: 50, teams: 6, smallestTeam: 3, largestTeam: 12, minimum: 5 } as const

export type TeamSize = typeof TEAM_SIZE

/**
 * Who is in which team: each team draws its size and its members at random, so people share teams the
 * way they do when nobody plans it. With `primary`, every person is in one team at most.
 */
export const planTeams = (size: TeamSize, random: () => number, primary = false): number[][] => {
  const free = Array.from({ length: size.members }, (_, member) => member)
  return Array.from({ length: size.teams }, () => {
    const wanted = size.smallestTeam + Math.floor(random() * (size.largestTeam - size.smallestTeam + 1))
    if (!primary) return pick(size.members, wanted, random).sort((a, b) => a - b)
    const members: number[] = []
    while (members.length < wanted && free.length > 0)
      members.push(free.splice(Math.floor(random() * free.length), 1)[0]!)
    return members.sort((a, b) => a - b)
  })
}

/** How many teams the cell rule shows, with every member active, over one organization per seed. */
export const measureTeams = (
  size: TeamSize,
  seeds: ReadonlyArray<number>,
  primary = false,
): { readonly shown: number[]; readonly atBest: number[]; readonly largeEnough: number[] } => {
  const results = seeds.map((seed) => {
    const teams = planTeams(size, seededRandom(seed), primary)
    const contributions: Contribution[] = Array.from({ length: size.members }, (_, member) => ({
      person: `m${member}`,
      teams: teams.flatMap((team, index) => (team.includes(member) ? [`t${index}`] : [])),
    }))
    return {
      shown: teamsShown(contributions, size.minimum).shown.length,
      atBest: mostTeamsShown(teams, size),
      largeEnough: teams.filter((team) => team.length >= size.minimum).length,
    }
  })
  return {
    shown: results.map((result) => result.shown),
    atBest: results.map((result) => result.atBest),
    largeEnough: results.map((result) => result.largeEnough),
  }
}

/** The most teams any choice could show under the cell rule, tried one subset at a time. */
export const mostTeamsShown = (teams: ReadonlyArray<ReadonlyArray<number>>, size: TeamSize): number => {
  let best = 0
  for (let subset = 0; subset < 2 ** teams.length; subset++) {
    const chosen = teams.filter((_, index) => (subset >> index) & 1)
    if (chosen.length <= best || chosen.some((team) => team.length < size.minimum)) continue
    const cells = Map.groupBy(
      Array.from({ length: size.members }, (_, member) => member),
      (member) => chosen.map((team) => (team.includes(member) ? 1 : 0)).join(''),
    )
    if ([...cells.values()].every((cell) => cell.length >= size.minimum)) best = chosen.length
  }
  return best
}

/** One line per number of teams shown: how many organizations showed that many. */
export const teamTable = (measured: { readonly shown: ReadonlyArray<number> }, teams: number): string =>
  [
    '| Teams shown | Organizations |',
    '| --- | --- |',
    ...Array.from(
      { length: teams + 1 },
      (_, count) => `| ${count} | ${measured.shown.filter((shown) => shown === count).length} |`,
    ),
  ].join('\n')

export const summarize = (durationsMs: ReadonlyArray<number>): Summary => {
  const sorted = [...durationsMs].sort((a, b) => a - b)
  const at = (fraction: number) =>
    sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!
  return {
    runs: sorted.length,
    medianMs: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(sorted.at(-1) ?? 0),
  }
}

/** The Markdown table docs/deployment.md keeps, one row per measured call. */
export const measurementTable = (rows: ReadonlyArray<{ readonly what: string } & Summary>): string =>
  [
    '| What | Runs | Median | p95 | Max |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      (row) => `| ${row.what} | ${row.runs} | ${row.medianMs} ms | ${row.p95Ms} ms | ${row.maxMs} ms |`,
    ),
  ].join('\n')

export const isSlow = (summary: Summary): boolean => summary.p95Ms > SLOW_MS

const SLOW_MS = 500
const WORKDAY_START_MINUTE = 8 * 60
const WORKDAY_MINUTES = 10 * 60
const CHANNEL_SHARE = 0.4
const AGENT_SHARE = 0.8
const RELEASE_SHARE = 0.05
const DAY_MS = 24 * 60 * 60_000

const outcomeFor = (draw: number): DraftOutcome =>
  draw < 0.7 ? 'as_written' : draw < 0.9 ? 'edited' : 'discarded'

const pick = (from: number, count: number, random: () => number): number[] => {
  const chosen = new Set<number>()
  while (chosen.size < count) chosen.add(Math.floor(random() * from))
  return [...chosen]
}

const round = (ms: number): number => Math.round(ms * 10) / 10

interface Seat {
  readonly memberId: string
  readonly humanToken: string
  readonly agents: ReadonlyArray<{ readonly id: string; readonly token: string }>
}

const printTeams = (): void => {
  const seeds = Array.from({ length: TEAM_SEEDS }, (_, index) => index + 1)
  for (const primary of [false, true]) {
    const measured = measureTeams(TEAM_SIZE, seeds, primary)
    const total = (values: ReadonlyArray<number>) => values.reduce((sum, value) => sum + value, 0)
    console.log(
      `${primary ? 'One primary team per person' : 'Overlapping teams'}: ${TEAM_SIZE.teams} teams of ${TEAM_SIZE.smallestTeam}-${TEAM_SIZE.largestTeam} among ${TEAM_SIZE.members} people, minimum ${TEAM_SIZE.minimum}, ${seeds.length} organizations\n` +
        `Teams large enough on their own: ${total(measured.largeEnough)} of ${seeds.length * TEAM_SIZE.teams}; shown: ${total(measured.shown)}; at best: ${total(measured.atBest)}\n` +
        `Organizations showing at least half their teams: ${measured.shown.filter((shown) => 2 * shown >= TEAM_SIZE.teams).length}\n\n` +
        `${teamTable(measured, TEAM_SIZE.teams)}\n`,
    )
  }
}

const TEAM_SEEDS = 1000

async function measure(): Promise<void> {
  const { values: options } = parseArgs({
    options: {
      'database-url': { type: 'string', default: '' },
      port: { type: 'string', default: '8191' },
      seed: { type: 'string', default: '7' },
      teams: { type: 'boolean', default: false },
    },
  })
  if (options.teams) return printTeams()
  const port = Number(options.port)
  const serverUrl = `http://127.0.0.1:${port}`
  const sqliteFile = join(tmpdir(), `homingbird-pilot-${port}.sqlite`)
  const databaseUrl = options['database-url'] || `sqlite:${sqliteFile}`
  if (databaseUrl.startsWith('sqlite:'))
    for (const suffix of ['', '-wal', '-shm']) rmSync(sqliteFile + suffix, { force: true })

  const size = PILOT_SIZE
  const random = seededRandom(Number(options.seed))
  const channels = planChannels(size, random)
  const exchanges = planExchanges(size, channels, random)
  const today = Date.UTC(2026, 10, 2)
  let now = today - size.days * DAY_MS
  const clock: Clock = { now: () => now, sleep: systemClock.sleep }

  const config = loadConfig({
    HB_PUBLIC_URL: serverUrl,
    HB_PORT: String(port),
    HB_DEV_LOGIN: '1',
    HB_ALLOWED_DOMAINS: 'example.com',
    HB_ADMIN_EMAILS: 'member0@example.com',
    HB_DATABASE_URL: databaseUrl,
  })
  if (config._tag === 'Err') throw new Error(config.error.join('; '))
  const database = await T.runPromise(openDatabase(databaseUrl))
  if (!databaseUrl.startsWith('sqlite:'))
    for (const table of tableNames()) await T.runPromise(database.run(raw(`DROP TABLE IF EXISTS ${table}`)))
  const { env } = buildRuntime({ config: config.value, database, clock, write: () => {} })
  await T.runPromise(migrate, env)
  const server = await T.runPromise(startServer(env, port))

  const call = async (token: string, method: string, path: string, body?: unknown): Promise<any> => {
    const response = await fetch(`${serverUrl}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text}`)
    return text === '' ? null : JSON.parse(text)
  }
  const timed = async (runs: number, attempt: (run: number) => Promise<unknown>): Promise<Summary> => {
    const durations: number[] = []
    for (let run = 0; run < runs; run++) {
      const startedAt = performance.now()
      await attempt(run)
      durations.push(performance.now() - startedAt)
    }
    return summarize(durations)
  }

  const seedingStartedAt = performance.now()
  const seats: Seat[] = []
  for (let index = 0; index < size.members; index++) {
    const email = `member${index}@example.com`
    const member = await T.runPromise(
      signInMember({ subject: `pilot|${email}`, email, name: `Member ${index}` }),
      env,
    )
    const issue = (kind: 'human' | 'agent', name: string) =>
      T.runPromise(
        issueCredential({
          memberId: member.id,
          kind,
          name,
          client: kind === 'human' ? BROWSER_SIGN_IN_CLIENT : 'pilot-measure',
          lifetimeMs: 400 * DAY_MS,
          refreshable: false,
        }),
        env,
      )
    const human = await issue('human', 'browser')
    const agents = []
    for (let agent = 0; agent < size.agentsPerMember; agent++) {
      const issued = await issue('agent', `Agent ${index}.${agent}`)
      agents.push({ id: issued.credentialId, token: issued.token })
    }
    seats.push({ memberId: member.id, humanToken: human.token, agents })
    for (const topic of PRINCIPLE_TOPICS)
      await call(human.token, 'POST', '/principles', {
        topic,
        rule: `Say how ${topic.toLowerCase()} applies.`,
        place: null,
      })
  }
  const slugs = channels.map((_, index) => `pilot-${index}`)
  for (const [index, room] of channels.entries()) {
    const founder = seats[room.members[0] ?? 0]!
    await call(founder.humanToken, 'POST', '/channels', {
      slug: slugs[index],
      description: `Pilot channel ${index}`,
    })
    for (const member of room.members)
      await call(seats[member]!.humanToken, 'PUT', `/channels/${slugs[index]}/membership`, {
        answering: room.answerers.includes(member),
      })
  }

  let sentNotes = 0
  for (const exchange of exchanges) {
    now = today - (size.days - exchange.day) * DAY_MS + exchange.minute * 60_000
    const asker = seats[exchange.asker]!
    const answerer = seats[exchange.answerer]!
    const destination =
      exchange.channel === null ? { to: [answerer.memberId] } : { channel: slugs[exchange.channel] }
    const author = exchange.draftedByAgent ? asker.agents[exchange.agent]!.token : asker.humanToken
    const question = await call(author, 'POST', '/drafts', {
      ...destination,
      body: QUESTION,
      ...(exchange.draftedByAgent && {
        basis: `${BASIS_PREFIX} ${PRINCIPLE_TOPICS[exchange.day % 3]}`,
        model: 'pilot-model',
      }),
    })
    now += 90_000
    await call(asker.humanToken, 'POST', `/drafts/${question.id}/seen`)
    now += 45_000
    if (exchange.question === 'discarded') {
      await call(asker.humanToken, 'POST', `/drafts/${question.id}/discard`)
      continue
    }
    await call(asker.humanToken, 'POST', `/drafts/${question.id}/send`, {
      ...(exchange.question === 'edited' && { body: `${QUESTION} Thanks!` }),
      expected: asShown(question),
    })
    sentNotes++
    now += 4 * 60_000
    const answeringAgent = answerer.agents[(exchange.agent + 1) % size.agentsPerMember]!
    await call(answeringAgent.token, 'POST', `/notes/${question.id}/pickup`)
    if (exchange.reply === 'released') {
      await call(answeringAgent.token, 'POST', `/notes/${question.id}/release`, {
        reason: 'Not mine to answer.',
      })
      continue
    }
    const reply = await call(answeringAgent.token, 'POST', '/drafts', {
      inReplyTo: question.id,
      body: ANSWER,
      basis: `${BASIS_PREFIX} ${PRINCIPLE_TOPICS[(exchange.day + 1) % 3]}`,
    })
    now += 3 * 60_000
    await call(answerer.humanToken, 'POST', `/notes/${question.id}/read`)
    await call(answerer.humanToken, 'POST', `/drafts/${reply.id}/seen`)
    now += 60_000
    if (exchange.reply === 'discarded') await call(answerer.humanToken, 'POST', `/drafts/${reply.id}/discard`)
    else {
      await call(answerer.humanToken, 'POST', `/drafts/${reply.id}/send`, {
        ...(exchange.reply === 'edited' && { body: `${ANSWER} Ask me again on Friday.` }),
        expected: asShown(reply),
      })
      sentNotes++
    }
  }
  now = today + 9 * 60 * 60_000
  const everyone = 'pilot-all'
  await call(seats[0]!.humanToken, 'POST', '/channels', {
    slug: everyone,
    description: 'Everyone in the pilot',
  })
  for (const seat of seats)
    await call(seat.humanToken, 'PUT', `/channels/${everyone}/membership`, { answering: true })
  const debates: string[] = []
  for (let index = 0; index < size.openDebates; index++) {
    const opener = seats[(index * 5) % seats.length]!
    const debate = await call(opener.humanToken, 'POST', '/debates', {
      question: `Pilot question ${index}: which plan holds up?`,
    })
    debates.push(debate.id)
    for (let joined = 0; joined < size.agentsPerDebate; joined++) {
      const seat = seats[(index * 5 + joined) % seats.length]!
      await call(seat.humanToken, 'PUT', `/debates/${debate.id}/agent`, { agentId: seat.agents[0]!.id })
    }
  }
  const seedingSeconds = Math.round((performance.now() - seedingStartedAt) / 1000)

  const streams = new AbortController()
  const arrivals = new Map<string, number>()
  let waitingFor: { id: string; count: number; resolve: () => void } | null = null
  const opened: Promise<void>[] = []
  for (const seat of seats)
    for (const agent of seat.agents)
      opened.push(
        fetch(`${serverUrl}/api/v1/events/stream`, {
          headers: { authorization: `Bearer ${agent.token}` },
          signal: streams.signal,
        }).then((response) => {
          void (async () => {
            const decoder = new TextDecoder()
            let buffered = ''
            for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
              buffered += decoder.decode(chunk, { stream: true })
              const complete = buffered.lastIndexOf('\n\n')
              if (complete === -1) continue
              const events = buffered.slice(0, complete)
              buffered = buffered.slice(complete + 2)
              for (const match of events.matchAll(/"type":"note\.sent","note":\{"id":"([^"]+)"/g)) {
                const current = waitingFor
                if (current === null || match[1] !== current.id) continue
                arrivals.set(current.id, (arrivals.get(current.id) ?? 0) + 1)
                if (arrivals.get(current.id) === current.count) current.resolve()
              }
            }
          })().catch(() => {})
        }),
      )
  await Promise.all(opened)
  await new Promise((resolve) => setTimeout(resolve, 500))
  const openStreams = opened.length

  const admin = seats[0]!
  const results: Array<{ what: string } & Summary> = []
  results.push({
    what: 'Organization insights (`GET /admin/insights`)',
    ...(await timed(20, () => call(admin.humanToken, 'GET', '/admin/insights'))),
  })
  results.push({
    what: "The administrator's own figures (`GET /insights/me`)",
    ...(await timed(20, () => call(admin.humanToken, 'GET', '/insights/me'))),
  })
  results.push({
    what: "Each member's trust figures (`GET /insights/me`, all 50)",
    ...(await timed(size.members, (run) => call(seats[run]!.humanToken, 'GET', '/insights/me'))),
  })
  results.push({
    what: "Each member's principles with this week's figures (`GET /principles`)",
    ...(await timed(size.members, (run) => call(seats[run]!.humanToken, 'GET', '/principles'))),
  })
  results.push({
    what: `One channel note to every open stream (${openStreams} streams, send until the last arrives)`,
    ...(await timed(20, async (run) => {
      const sender = seats[run % seats.length]!
      const draft = await call(sender.humanToken, 'POST', '/drafts', {
        channel: everyone,
        body: `Fan-out ${run}`,
      })
      const delivered = new Promise<void>((resolve) => {
        waitingFor = { id: draft.id, count: openStreams, resolve }
      })
      await call(sender.humanToken, 'POST', `/drafts/${draft.id}/send`, { expected: asShown(draft) })
      await delivered
      waitingFor = null
    })),
  })
  const agents = seats.flatMap((seat) => seat.agents)
  results.push({
    what: `Debate asks for every agent (\`GET /debate-asks\`, ${agents.length} agents, ${debates.length} open rooms)`,
    ...(await timed(agents.length * 3, (run) =>
      call(agents[run % agents.length]!.token, 'GET', '/debate-asks'),
    )),
  })
  streams.abort()
  await T.runPromise(server.close)

  const counts = await T.runPromise(
    database.all(
      raw(
        'SELECT (SELECT COUNT(*) FROM notes) AS notes, (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM receipts) AS receipts',
      ),
    ),
  )
  console.log(
    JSON.stringify(
      {
        database: databaseUrl.split(':')[0],
        machine: `${cpus().length} × ${cpus()[0]?.model ?? 'unknown CPU'}, ${Math.round(totalmem() / 2 ** 30)} GB, Node ${process.version}`,
        seedingSeconds,
        sentNotes,
        stored: counts[0],
        slow: results.filter(isSlow).map((row) => row.what),
      },
      null,
      2,
    ),
  )
  console.log(measurementTable(results))
  await T.runPromise(database.close)
  process.exit(0)
}

const QUESTION =
  'Is the billing migration safe to run today? The plan is in the release notes and I would like a second opinion before four.'
const ANSWER =
  'Yes. I checked the lock ordering and the backfill batch size; both are fine for the current table size. Run it after the nightly export.'
const BASIS_PREFIX = 'Principles applied:'
const PRINCIPLE_TOPICS = ['Release dates', 'Billing questions', 'Who owns what']

const isRunDirectly = process.argv[1] !== undefined && import.meta.filename === process.argv[1]

if (isRunDirectly) await measure()

const asShown = (draft: { readonly body: string; readonly conversationId: string }) => ({
  body: draft.body,
  conversationId: draft.conversationId,
})
