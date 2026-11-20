import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Schema as S, Task as T } from '@homingbird/kernel'
import { hashSecret } from '../src/random.ts'
import { type Database, type Row, sqlEnvironment } from '../src/sql/database.ts'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { AUDIT_TRAIL } from '../src/sql/migrations/audit-trail-step.ts'
import { GROUPS } from '../src/sql/migrations/groups-step.ts'
import { insertInto, raw } from '../src/sql/query.ts'
import type { Migration } from '../src/sql/schema-steps.ts'
import { migrateThrough } from '../src/sql/schema.ts'
import { TEST_DIALECTS } from './dialect-support.ts'

/**
 * Every final release of Dovecote, oldest first, with the number of schema steps it left a database at.
 * `node scripts/release-version.ts prepare` adds each new release, and `check` fails a release without one.
 */
export const RELEASES: ReadonlyArray<Release> = (() => {
  const decoded = S.array(S.struct({ version: S.string(), steps: S.int({ min: 1 }) })).decode(
    JSON.parse(readFileSync(new URL('./releases.json', import.meta.url), 'utf8')),
  )
  if (decoded._tag === 'Err') throw new Error(`releases.json: ${S.formatIssues(decoded.error)}`)
  return decoded.value
})()

export interface Release {
  readonly version: string
  readonly steps: number
}

/** Every release on every database these tests run on: its version, the database, the release, the URL. */
export const UPGRADES: ReadonlyArray<readonly [string, string, Release, string | undefined]> =
  RELEASES.flatMap((release) =>
    TEST_DIALECTS.map(([dialect, url]) => [release.version, dialect, release, url] as const),
  )

/**
 * A database as a release left it: its schema steps, applied by the real step definitions, and the rows
 * an organization had made by then, in the columns that release had. Channel managers are the old
 * `channel_managers` list: general's are Ana, in its room, Dee, deactivated, and Eve, outside it;
 * payroll's are Ben and Cy, in its room, and Dee; retired's only manager is Dee; lobby, seeded by the
 * operator, has none. A release with groups also has the channel groups the groups step made of them,
 * and a team.
 */
export const databaseAt = async (release: Release, database: Database): Promise<void> => {
  const env = sqlEnvironment(database)
  await T.runPromise(migrateThrough(MIGRATIONS.slice(0, release.steps)), env)
  const tables = tablesAt(release.steps)
  for (const [table, row] of rowsAt(release))
    await T.runPromise(env.database.run(insertInto(table, projected(row, tables[table]!.columns))), env)
}

/** Every row of every table the release had, in the columns it had, in primary key order. */
export const rowsOfReleaseTables = async (
  release: Release,
  database: Database,
): Promise<Readonly<Record<string, Row[]>>> => {
  const tables: Record<string, Row[]> = {}
  for (const [table, { columns, primaryKey }] of Object.entries(tablesAt(release.steps)))
    tables[table] = inKeyOrder(
      await T.runPromise(database.all(raw(`SELECT ${columns.join(', ')} FROM ${table}`))),
      primaryKey,
    )
  return tables
}

/** Every row of every table this build has, in primary key order. */
export const rowsOfEveryTable = (database: Database): Promise<Readonly<Record<string, Row[]>>> =>
  rowsOfReleaseTables({ version: 'this build', steps: MIGRATIONS.length }, database)

/** Whether a database the release left already has this schema step. */
export const hasStep = (release: Release, migration: Migration): boolean =>
  release.steps >= MIGRATIONS.indexOf(migration) + 1

/** The steps a database the release left lacks, in the order they run. */
export const stepsAfter = (release: Release): number[] =>
  Array.from({ length: MIGRATIONS.length - release.steps }, (_, index) => release.steps + index + 1)

/** The audit chain as 0.2.0 wrote it: each row's SHA-256 over the hash before it and its columns, in order. */
export const chainedAuditRows = (
  rows: ReadonlyArray<AuditRow>,
): ReadonlyArray<readonly ['audit_events', Row]> => {
  let previous = '0'.repeat(64)
  return rows.map((row) => {
    const unhashed = { ...row, previous_hash: previous }
    const hash = createHash('sha256')
      .update(previous)
      .update(JSON.stringify(HASHED_COLUMNS.map((column) => unhashed[column])))
      .digest('hex')
    previous = hash
    return ['audit_events', { ...unhashed, hash }] as const
  })
}

export type AuditRow = Readonly<Record<Exclude<(typeof HASHED_COLUMNS)[number], 'previous_hash'>, unknown>>

export const T0 = 1_699_000_000_000
export const MINUTE = 60_000
export const DAY = 24 * 60 * MINUTE

export const ID = {
  ana: 'mem_ana000000000',
  ben: 'mem_ben000000000',
  cy: 'mem_cy0000000000',
  dee: 'mem_dee000000000',
  eve: 'mem_eve000000000',
  anaBrowser: 'cred_anaweb000000',
  benBrowser: 'cred_benweb000000',
  cyBrowser: 'cred_cyweb0000000',
  deeBrowser: 'cred_deeweb000000',
  anaAgent: 'cred_anaagent0000',
  benAgent: 'cred_benagent0000',
  cyAgent: 'cred_cyagent00000',
  direct: 'conv_anaben000000',
  hello: 'note_hello0000000',
  reply: 'note_reply0000000',
  payrollNote: 'note_payroll00000',
  generalDraft: 'note_draft0000000',
  debate: 'deb_closed000000',
  principle: 'prin_tone00000000',
} as const

export const ROOM = {
  lobby: 'conv_lobby0000000',
  general: 'conv_general00000',
  payroll: 'conv_payroll00000',
  retired: 'conv_retired00000',
} as const

/** The tokens the release issued, of which it stored only the hashes. */
export const TOKEN = {
  anaBrowser: 'hbh_ana-browser-session-issued-by-an-older-release',
  benBrowser: 'hbh_ben-browser-session-issued-by-an-older-release',
  cyBrowser: 'hbh_cy-browser-session-issued-by-an-older-release',
  deeBrowser: 'hbh_dee-browser-session-issued-by-an-older-release',
  anaAgent: 'hba_ana-agent-issued-by-an-older-release',
  benAgent: 'hba_ben-agent-issued-by-an-older-release',
  cyAgent: 'hba_cy-agent-issued-by-an-older-release',
} as const

/**
 * Rows of the first audit table: one older than the saved retention, which the audit trail step removes
 * when it runs, and one within it, which stays.
 */
export const AUDIT_TABLE_ROWS = {
  old: {
    created_at: T0 - 500 * DAY,
    actor_id: ID.ana,
    credential_id: ID.anaBrowser,
    credential_kind: 'human',
    action: 'drafts.send',
    target: ID.hello,
    detail: '{}',
  },
  recent: {
    created_at: T0 + 11 * MINUTE,
    actor_id: ID.ana,
    credential_id: ID.anaBrowser,
    credential_kind: 'human',
    action: 'drafts.send',
    target: ID.hello,
    detail: '{}',
  },
} as const

/** The audit retention the administrator saved, in days. */
export const RETENTION_DAYS = 400

/** The team an administrator made in a release with groups. */
export const TEAM = 'grp_release00000'

const HASHED_COLUMNS = [
  'created_at',
  'event',
  'outcome',
  'actor_id',
  'credential_id',
  'credential_kind',
  'client_id',
  'target_kind',
  'target_id',
  'request_id',
  'client_address',
  'user_agent',
  'detail',
  'previous_hash',
] as const

interface TableAt {
  readonly columns: string[]
  readonly primaryKey: ReadonlyArray<string>
}

const tablesAt = (steps: number): Readonly<Record<string, TableAt>> => {
  const tables: Record<string, TableAt> = {
    schema_versions: { columns: ['version'], primaryKey: ['version'] },
  }
  for (const step of MIGRATIONS.slice(0, steps).flat()) {
    if ('primaryKey' in step)
      tables[step.name] = { columns: Object.keys(step.columns), primaryKey: step.primaryKey }
    if ('addTo' in step) tables[step.addTo]?.columns.push(step.name)
  }
  return tables
}

const EVERY_TABLE = tablesAt(MIGRATIONS.length)

/** The rows of the tables the release had; a column no step ever added is a mistake in these rows. */
const rowsAt = (release: Release): ReadonlyArray<readonly [string, Row]> => {
  const tables = tablesAt(release.steps)
  for (const [table, row] of ROWS)
    for (const column of Object.keys(row))
      if (!EVERY_TABLE[table]?.columns.includes(column)) throw new Error(`no step adds ${table}.${column}`)
  return [
    ...ROWS.filter(([table]) => table in tables),
    ...(hasStep(release, AUDIT_TRAIL) ? auditChainAt(release) : []),
  ]
}

const projected = (row: Row, columns: ReadonlyArray<string>): Row =>
  Object.fromEntries(Object.entries(row).filter(([column]) => columns.includes(column)))

/** Rows in the order of their primary key, compared the same way whatever the database's collation. */
const inKeyOrder = (rows: ReadonlyArray<Row>, primaryKey: ReadonlyArray<string>): Row[] => {
  const key = (row: Row) => primaryKey.map((column) => String(row[column]).padStart(20, '0')).join('\u0000')
  return [...rows].sort((left, right) => (key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0))
}

const member = (name: string, role: 'admin' | 'member', status: 'active' | 'deactivated', seq: number) => [
  'members',
  {
    id: `mem_${name.toLowerCase().padEnd(12, '0')}`,
    email: `${name.toLowerCase()}@example.com`,
    subject: `dev|${name.toLowerCase()}@example.com`,
    name,
    profile: name === 'Ana' ? 'Runs payroll and the release train.' : '',
    role,
    status,
    event_seq: seq,
    created_at: T0,
    last_seen_at: T0 + 30 * MINUTE,
    locale: name === 'Cy' ? 'ko' : null,
    character_spec: null,
    kind: 'person',
  },
]

const credential = (
  id: string,
  memberId: string,
  kind: 'human' | 'agent',
  name: string,
  token: string,
  revokedAt: number | null = null,
) => [
  'credentials',
  {
    id,
    member_id: memberId,
    kind,
    name,
    client: kind === 'human' ? 'Web' : name,
    token_hash: hashSecret(token),
    refresh_hash: null,
    token_expires_at: T0 + (kind === 'human' ? 30 : 90) * DAY,
    expires_at: T0 + (kind === 'human' ? 30 : 90) * DAY,
    created_at: T0,
    last_used_at: T0 + 30 * MINUTE,
    revoked_at: revokedAt,
  },
]

const channel = (slug: string, createdBy: string | null, visibility: 'open' | 'private', minute: number) => [
  [
    'conversations',
    {
      id: ROOM[slug as keyof typeof ROOM],
      kind: 'channel',
      title: slug,
      pair_key: null,
      created_at: T0 + minute * MINUTE,
      last_activity_at: T0 + minute * MINUTE,
      archived_at: null,
    },
  ],
  [
    'channels',
    {
      slug,
      description: `About ${slug}`,
      conversation_id: ROOM[slug as keyof typeof ROOM],
      created_by: createdBy,
      created_at: T0 + minute * MINUTE,
      visibility,
      manager_group_id: groupOf(slug),
    },
  ],
  [
    'member_groups',
    {
      id: groupOf(slug),
      kind: 'channel',
      name: null,
      created_by: createdBy,
      created_at: T0 + minute * MINUTE,
    },
  ],
]

const groupOf = (slug: string): string => `grp_${slug.padEnd(12, '0')}`

const pairs = (table: string, conversationId: string, memberIds: ReadonlyArray<string>) =>
  memberIds.map((memberId) => [table, { conversation_id: conversationId, member_id: memberId }])

const note = (fields: Readonly<Record<string, unknown>>) => [
  'notes',
  {
    in_reply_to: null,
    origin: 'human',
    agent_name: null,
    basis: null,
    seen_at: null,
    agent_body: null,
    agent_client: null,
    agent_model: null,
    session_minutes: null,
    context_percent: null,
    debate_id: null,
    ...fields,
  },
]

const result = (conclusion: string) =>
  JSON.stringify({
    kind: 'conclusion',
    conclusion,
    reasons: ['The rollback is tested.'],
    contributions: [ID.ana, ID.ben, ID.cy].map((memberId) => ({ memberId, summary: 'Spoke.', credits: [] })),
    nextSteps: [{ step: 'Ben shares the rollback plan.', owner: ID.ben, proposedBy: ID.ana }],
  })

const DEBATE_AT = T0 + 40 * MINUTE

/** The model Cy's agent said it ran as, which a release with the debate model step stored. */
const MODEL_OF: Readonly<Record<string, string | null>> = {
  [ID.ana]: null,
  [ID.ben]: null,
  [ID.cy]: 'model-c',
}

const debateRows = [
  [
    'debates',
    {
      id: ID.debate,
      question: 'Which week should payroll move?',
      visibility: 'open',
      status: 'closed',
      created_by: ID.ana,
      turns_per_agent: 1,
      total_turns: 3,
      minutes: 30,
      turn_characters: 300,
      created_at: DEBATE_AT,
      updated_at: DEBATE_AT + 5 * MINUTE,
      deadline_at: DEBATE_AT + 30 * MINUTE,
      concluded_at: DEBATE_AT + 3 * MINUTE,
      closed_at: DEBATE_AT + 5 * MINUTE,
      result: result('The second week of March.'),
      result_by: ID.ben,
      result_at: DEBATE_AT + 5 * MINUTE,
      result_round: 0,
      ended_because: null,
      votes_open_at: DEBATE_AT + 4 * MINUTE,
      grace_minutes: 5,
      dropped_out: '[]',
    },
  ],
  ...(
    [
      [ID.ana, ID.anaAgent, 'Ana agent', 'The March report says the rollback failed once.'],
      [ID.ben, ID.benAgent, 'Ben agent', 'It was fixed in the second week; I read the follow-up.'],
      [ID.cy, ID.cyAgent, 'Cy agent', '두 번째 주가 좋습니다.'],
    ] as const
  ).flatMap(([memberId, credentialId, agentName, body], index) => [
    ['debate_members', { debate_id: ID.debate, member_id: memberId, created_at: DEBATE_AT }],
    [
      'debate_participants',
      {
        debate_id: ID.debate,
        member_id: memberId,
        credential_id: credentialId,
        agent_name: agentName,
        created_at: DEBATE_AT + MINUTE,
      },
    ],
    [
      'debate_turns',
      {
        debate_id: ID.debate,
        position: index + 1,
        member_id: memberId,
        credential_id: credentialId,
        agent_name: agentName,
        body,
        created_at: DEBATE_AT + (index + 1) * MINUTE,
        agent_model: MODEL_OF[memberId],
      },
    ],
    [
      'debate_drafts',
      {
        debate_id: ID.debate,
        round: 0,
        member_id: memberId,
        credential_id: credentialId,
        result: result(['The first week.', 'The second week of March.', '셋째 주.'][index]!),
        created_at: DEBATE_AT + 4 * MINUTE,
        agent_model: MODEL_OF[memberId],
      },
    ],
    ['debate_approvals', { debate_id: ID.debate, member_id: memberId, approved_at: DEBATE_AT + 5 * MINUTE }],
    [
      'debate_credits',
      { debate_id: ID.debate, member_id: memberId, kind: 'conclusion', created_at: DEBATE_AT },
    ],
  ]),
  ...(
    [
      [ID.ana, ID.ben],
      [ID.cy, ID.ben],
      [ID.ben, ID.ana],
    ] as const
  ).map(([voterId, draftBy]) => [
    'debate_votes',
    {
      debate_id: ID.debate,
      round: 0,
      voter_id: voterId,
      draft_by: draftBy,
      created_at: DEBATE_AT + 5 * MINUTE,
      agent_model: MODEL_OF[voterId],
    },
  ]),
  [
    'debate_credits',
    {
      debate_id: ID.debate,
      member_id: ID.ana,
      kind: 'next_step_accepted',
      created_at: DEBATE_AT + 5 * MINUTE,
    },
  ],
]

const ROWS = [
  member('Ana', 'admin', 'active', 0),
  member('Ben', 'member', 'active', 2),
  member('Cy', 'member', 'active', 0),
  member('Dee', 'member', 'deactivated', 0),
  member('Eve', 'member', 'active', 0),
  [
    'settings',
    {
      name: 'organization',
      value: JSON.stringify({
        allowedDomains: ['example.com'],
        contactMode: 'open',
        auditRetentionDays: RETENTION_DAYS,
      }),
    },
  ],
  credential(ID.anaBrowser, ID.ana, 'human', 'Browser', TOKEN.anaBrowser),
  credential(ID.benBrowser, ID.ben, 'human', 'Browser', TOKEN.benBrowser),
  credential(ID.cyBrowser, ID.cy, 'human', 'Browser', TOKEN.cyBrowser),
  credential(ID.deeBrowser, ID.dee, 'human', 'Browser', TOKEN.deeBrowser, T0 + 50 * MINUTE),
  credential(ID.anaAgent, ID.ana, 'agent', 'Ana agent', TOKEN.anaAgent),
  credential(ID.benAgent, ID.ben, 'agent', 'Ben agent', TOKEN.benAgent),
  credential(ID.cyAgent, ID.cy, 'agent', 'Cy agent', TOKEN.cyAgent),
  ...channel('lobby', null, 'open', 0),
  ...channel('general', ID.ana, 'open', 1),
  ...channel('payroll', ID.ben, 'private', 2),
  ...channel('retired', ID.dee, 'private', 3),
  ...pairs('participants', ROOM.lobby, [ID.ben]),
  ...pairs('participants', ROOM.general, [ID.ana, ID.ben, ID.cy, ID.dee]),
  ...pairs('participants', ROOM.payroll, [ID.ben, ID.cy, ID.dee]),
  ...pairs('participants', ROOM.retired, [ID.ana, ID.dee]),
  ...pairs('channel_managers', ROOM.general, [ID.ana, ID.dee, ID.eve]),
  ...pairs('channel_managers', ROOM.payroll, [ID.ben, ID.cy, ID.dee]),
  ...pairs('channel_managers', ROOM.retired, [ID.dee]),
  ...pairs('channel_answerers', ROOM.general, [ID.ana]),
  ...pairs('channel_answerers', ROOM.payroll, [ID.ben]),
  ...(
    [
      ['general', ID.ana],
      ['payroll', ID.ben],
      ['payroll', ID.cy],
    ] as const
  ).map(([slug, memberId]) => ['group_members', { group_id: groupOf(slug), member_id: memberId }]),
  [
    'member_groups',
    { id: TEAM, kind: 'team', name: 'Release', created_by: ID.ana, created_at: T0 + 30 * MINUTE },
  ],
  ...[ID.ana, ID.ben].map((memberId) => ['group_members', { group_id: TEAM, member_id: memberId }]),
  [
    'conversations',
    {
      id: ID.direct,
      kind: 'direct',
      title: null,
      pair_key: `${ID.ana}:${ID.ben}`,
      created_at: T0 + 10 * MINUTE,
      last_activity_at: T0 + 12 * MINUTE,
      archived_at: null,
    },
  ],
  ...pairs('participants', ID.direct, [ID.ana, ID.ben]),
  note({
    id: ID.hello,
    conversation_id: ID.direct,
    author_id: ID.ana,
    status: 'sent',
    body: "Can payroll move to March? Ünïcödé 🕊, a 'quote' and 100%.",
    credential_id: ID.anaBrowser,
    created_at: T0 + 10 * MINUTE,
    updated_at: T0 + 11 * MINUTE,
    sent_at: T0 + 11 * MINUTE,
    decided_at: T0 + 11 * MINUTE,
  }),
  note({
    id: ID.reply,
    conversation_id: ID.direct,
    author_id: ID.ben,
    status: 'sent',
    body: 'Yes, the second week works.',
    in_reply_to: ID.hello,
    origin: 'human_edited',
    agent_name: 'Ben agent',
    credential_id: ID.benAgent,
    created_at: T0 + 11 * MINUTE,
    updated_at: T0 + 12 * MINUTE,
    sent_at: T0 + 12 * MINUTE,
    seen_at: T0 + 11 * MINUTE,
    decided_at: T0 + 12 * MINUTE,
    agent_body: 'Yes.',
    agent_client: 'Ben agent',
    agent_model: 'example-model-2',
    session_minutes: 14,
    context_percent: 37,
  }),
  note({
    id: ID.payrollNote,
    conversation_id: ROOM.payroll,
    author_id: ID.ben,
    status: 'sent',
    body: 'Payroll closes on the 25th.',
    credential_id: ID.benBrowser,
    created_at: T0 + 20 * MINUTE,
    updated_at: T0 + 20 * MINUTE,
    sent_at: T0 + 20 * MINUTE,
    decided_at: T0 + 20 * MINUTE,
  }),
  note({
    id: ID.generalDraft,
    conversation_id: ROOM.general,
    author_id: ID.ana,
    status: 'draft',
    body: 'Not ready to share.',
    credential_id: ID.anaBrowser,
    created_at: T0 + 25 * MINUTE,
    updated_at: T0 + 25 * MINUTE,
    sent_at: null,
    decided_at: null,
  }),
  [
    'receipts',
    {
      note_id: ID.hello,
      member_id: ID.ben,
      delivered_at: T0 + 11 * MINUTE,
      read_at: T0 + 11 * MINUTE,
      drafting_at: T0 + 11 * MINUTE,
      replied_at: T0 + 12 * MINUTE,
    },
  ],
  [
    'receipts',
    {
      note_id: ID.reply,
      member_id: ID.ana,
      delivered_at: T0 + 12 * MINUTE,
      read_at: null,
      drafting_at: null,
      replied_at: null,
    },
  ],
  ...[ID.cy, ID.dee].map((memberId) => [
    'receipts',
    {
      note_id: ID.payrollNote,
      member_id: memberId,
      delivered_at: T0 + 20 * MINUTE,
      read_at: null,
      drafting_at: null,
      replied_at: null,
    },
  ]),
  ['pickups', { note_id: ID.hello, credential_id: ID.benAgent, picked_at: T0 + 11 * MINUTE }],
  ...[1, 2].map((seq) => [
    'events',
    {
      member_id: ID.ben,
      seq,
      created_at: T0 + (10 + seq) * MINUTE,
      body: JSON.stringify(
        seq === 1
          ? { type: 'contact.changed', memberId: ID.ana }
          : {
              type: 'channel.changed',
              channel: {
                slug: 'payroll',
                description: 'About payroll',
                conversationId: ROOM.payroll,
                visibility: 'private',
                memberCount: 3,
                helperCount: 1,
                joined: true,
                answering: true,
                managing: true,
                createdAt: T0 + 2 * MINUTE,
              },
            },
      ),
    },
  ]),
  [
    'principles',
    {
      id: ID.principle,
      member_id: ID.ana,
      kind: 'rule',
      topic: 'Tone',
      rule: 'Keep replies to payroll questions to two sentences.',
      source: null,
      place: null,
      enabled: 1,
      origin: 'manual',
      position: 0,
      created_at: T0 + 5 * MINUTE,
      updated_at: T0 + 5 * MINUTE,
      last_applied_at: T0 + 12 * MINUTE,
      public_text: null,
    },
  ],
  [
    'principle_applications',
    {
      principle_id: ID.principle,
      note_id: ID.hello,
      member_id: ID.ana,
      created_at: T0 + 11 * MINUTE,
      missed_at: null,
    },
  ],
  ...debateRows,
  ['audit_log', AUDIT_TABLE_ROWS.old],
  ['audit_log', AUDIT_TABLE_ROWS.recent],
] as ReadonlyArray<readonly [string, Row]>

const audited = (
  minute: number,
  event: string,
  target: readonly [kind: string, id: string | null],
  by: readonly [actor: string | null, credential: string | null, kind: 'human' | 'agent' | null],
  detail: Readonly<Record<string, unknown>>,
): AuditRow => ({
  created_at: T0 + minute * MINUTE,
  event,
  outcome: 'success',
  actor_id: by[0],
  credential_id: by[1],
  credential_kind: by[2],
  client_id: null,
  target_kind: target[0],
  target_id: target[1],
  request_id: by[0] === null ? null : `req_${String(minute).padStart(12, '0')}`,
  client_address: event === 'credential.issued' || event === 'authn.signed_in' ? '127.0.0.1' : null,
  user_agent: event === 'credential.issued' || event === 'authn.signed_in' ? 'Mozilla/5.0' : null,
  detail: JSON.stringify(detail),
})

const ANA_IN_BROWSER = [ID.ana, ID.anaBrowser, 'human'] as const
const NOBODY = [null, null, null] as const

const AUDIT_OF_020: ReadonlyArray<AuditRow> = [
  audited(0, 'system.migrated', ['none', null], NOBODY, { steps: [1, 2, 3, 4, 5] }),
  audited(0, 'credential.issued', ['credential', ID.anaBrowser], ANA_IN_BROWSER, {
    clientKind: 'browser',
    grant: 'browser',
    kind: 'human',
  }),
  audited(0, 'authn.signed_in', ['member', ID.ana], ANA_IN_BROWSER, {}),
  audited(1, 'channel.created', ['channel', 'general'], ANA_IN_BROWSER, { visibility: 'open' }),
  audited(2, 'channel.manager_added', ['channel', 'payroll'], [ID.ben, ID.benBrowser, 'human'], {
    memberId: ID.cy,
  }),
  audited(5, 'principle.created', ['principle', ID.principle], ANA_IN_BROWSER, { kind: 'rule' }),
  audited(11, 'note.approved', ['note', ID.hello], ANA_IN_BROWSER, {
    conversationId: ID.direct,
    edited: false,
  }),
  audited(12, 'note.approved', ['note', ID.reply], [ID.ben, ID.benBrowser, 'human'], {
    conversationId: ID.direct,
    edited: true,
  }),
  audited(45, 'debate.closed', ['debate', ID.debate], NOBODY, {
    draftedBy: ID.ben,
    drafts: 3,
    droppedOut: [],
    round: 0,
    votes: 2,
  }),
  audited(50, 'member.access_changed', ['member', ID.dee], ANA_IN_BROWSER, {
    status: { from: 'active', to: 'deactivated' },
  }),
]

/** The audit rows 0.2.0 wrote, and the rows of a later upgrade and a team made with groups. */
const auditChainAt = (release: Release): ReadonlyArray<readonly [string, Row]> => {
  const later = release.steps > STEPS_OF_020 ? stepsBetween(STEPS_OF_020, release.steps) : []
  const chain = chainedAuditRows([
    ...AUDIT_OF_020,
    ...(later.length > 0 ? [audited(55, 'system.migrated', ['none', null], NOBODY, { steps: later })] : []),
    ...(hasStep(release, GROUPS)
      ? [audited(56, 'group.created', ['group', TEAM], ANA_IN_BROWSER, { kind: 'team' })]
      : []),
  ])
  const head = { name: 'chain', last_id: chain.length, hash: String(chain.at(-1)![1].hash) }
  return [...chain, ['audit_head', head]]
}

/** The steps of 0.2.0, the first release with the audit trail. */
const STEPS_OF_020 = MIGRATIONS.indexOf(AUDIT_TRAIL) + 1

const stepsBetween = (after: number, through: number): number[] =>
  Array.from({ length: through - after }, (_, index) => after + index + 1)
