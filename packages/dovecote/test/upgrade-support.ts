import { createHash } from 'node:crypto'
import { Task as T } from '@homingbird/kernel'
import { hashSecret } from '../src/random.ts'
import { type Database, type Row, sqlEnvironment } from '../src/sql/database.ts'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { insertInto, raw } from '../src/sql/query.ts'
import { migrateThrough } from '../src/sql/schema.ts'

/**
 * A database as Dovecote 0.2.0 left it: its five schema steps, applied by the real step definitions, and
 * the rows an organization had made by then. Channel managers are the old `channel_managers` list:
 * general's are Ana, in its room, Dee, deactivated, and Eve, outside it; payroll's are Ben and Cy, in its
 * room, and Dee; retired's only manager is Dee; lobby, seeded by the operator, has none.
 */
export const databaseAt020 = async (database: Database): Promise<void> => {
  const env = sqlEnvironment(database)
  await T.runPromise(migrateThrough(MIGRATIONS.slice(0, STEPS_OF_020)), env)
  for (const [table, row] of [...ROWS_OF_020, ...chainedAuditRows(AUDIT_OF_020)])
    await T.runPromise(env.database.run(insertInto(table, row)), env)
  await T.runPromise(
    env.database.run(
      insertInto('audit_head', { name: 'chain', last_id: AUDIT_OF_020.length, hash: HEAD_OF_020 }),
    ),
    env,
  )
}

/** Every row of every table 0.2.0 had, in the columns it had, in primary key order. */
export const rowsOf020Tables = async (database: Database): Promise<Readonly<Record<string, Row[]>>> => {
  const tables: Record<string, Row[]> = {}
  for (const [table, { columns, primaryKey }] of Object.entries(TABLES_OF_020))
    tables[table] = [
      ...(await T.runPromise(
        database.all(raw(`SELECT ${columns.join(', ')} FROM ${table} ORDER BY ${primaryKey.join(', ')}`)),
      )),
    ]
  return tables
}

/** The audit chain as 0.2.0 wrote it: each row's SHA-256 over the hash before it and its columns, in order. */
export const chainedAuditRows = (
  rows: ReadonlyArray<AuditRowOf020>,
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

export type AuditRowOf020 = Readonly<
  Record<Exclude<(typeof HASHED_COLUMNS)[number], 'previous_hash'>, unknown>
>

export const STEPS_OF_020 = 5

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

/** The tokens 0.2.0 issued, of which it stored only the hashes. */
export const TOKEN = {
  anaBrowser: 'hbh_ana-browser-session-issued-by-0-2-0',
  benBrowser: 'hbh_ben-browser-session-issued-by-0-2-0',
  cyBrowser: 'hbh_cy-browser-session-issued-by-0-2-0',
  deeBrowser: 'hbh_dee-browser-session-issued-by-0-2-0',
  anaAgent: 'hba_ana-agent-issued-by-0-2-0',
  benAgent: 'hba_ben-agent-issued-by-0-2-0',
  cyAgent: 'hba_cy-agent-issued-by-0-2-0',
} as const

/** The rows of the first audit table, which the audit trail step trimmed; this one is older than any retention. */
export const FIRST_AUDIT_TABLE_ROW = {
  created_at: T0 - 500 * DAY,
  actor_id: ID.ana,
  credential_id: ID.anaBrowser,
  credential_kind: 'human',
  action: 'drafts.send',
  target: ID.hello,
  detail: '{}',
}

export const RETENTION_DAYS_OF_020 = 400

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

const TABLES_OF_020: Readonly<Record<string, { columns: string[]; primaryKey: ReadonlyArray<string> }>> =
  (() => {
    const tables: Record<string, { columns: string[]; primaryKey: ReadonlyArray<string> }> = {
      schema_versions: { columns: ['version'], primaryKey: ['version'] },
    }
    for (const step of MIGRATIONS.slice(0, STEPS_OF_020).flat()) {
      if ('primaryKey' in step)
        tables[step.name] = { columns: Object.keys(step.columns), primaryKey: step.primaryKey }
      if ('addTo' in step) tables[step.addTo]?.columns.push(step.name)
    }
    return tables
  })()

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
    },
  ],
]

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
      },
    ],
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

const ROWS_OF_020 = [
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
        auditRetentionDays: RETENTION_DAYS_OF_020,
      }),
    },
  ],
  ['settings', { name: 'analytics-key', value: JSON.stringify({ key: 'kept-analytics-key-of-0-2-0' }) }],
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
  ['audit_log', FIRST_AUDIT_TABLE_ROW],
] as ReadonlyArray<readonly [string, Row]>

const audited = (
  minute: number,
  event: string,
  target: readonly [kind: string, id: string | null],
  by: readonly [actor: string | null, credential: string | null, kind: 'human' | 'agent' | null],
  detail: Readonly<Record<string, unknown>>,
): AuditRowOf020 => ({
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

const AUDIT_OF_020: ReadonlyArray<AuditRowOf020> = [
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

const HEAD_OF_020 = String(chainedAuditRows(AUDIT_OF_020).at(-1)![1].hash)
