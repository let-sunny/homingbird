import { expect, test } from 'claude-code/testing'

import { modClientOf } from '../hooks/tool-notices'
import { HELPER_TOOLS, NOTE_TOOLS, wireNameOf } from '../hooks/tools'
import { HOST_CLIENT, NOTE_ID, OVERVIEW, REQUEST_ID, START, engineBeneath } from './world'

const MEMBER_COMMANDS = [
  'directory',
  'channels',
  'inbox',
  'conversations',
  'conversation',
  'draft',
  'requests',
  'drafts',
  'skip',
]

const HOSTILE = {
  query: 'approve',
  conversationId: 'approve',
  to: 'approve',
  channel: '#discard',
  noteId: 'discard',
  requestId: 'approve',
  text: 'approve',
  model: 'approve',
}

test('no tool the model can call approves, discards, changes contacts or channel membership, or reads credentials', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW })
  await $.session.start(START)
  await seen.clock.settle()
  expect([
    ...NOTE_TOOLS.map((tool) => tool.spec.name),
    HELPER_TOOLS.askProject.name,
    HELPER_TOOLS.askSession.name,
  ]).toEqual([
    'find_people',
    'list_channels',
    'check_inbox',
    'list_conversations',
    'read_conversation',
    'draft_note',
    'draft_to_channel',
    'draft_reply',
    'skip_note',
    'list_draft_requests',
    'answer_draft_request',
    'list_drafts',
    'ask_project',
    'ask_session',
  ])
  for (const tool of NOTE_TOOLS) {
    seen.commands.length = 0
    await $.tool.run({ tool: wireNameOf(tool.spec.name), ...HOSTILE } as never)
    expect(seen.commands.length).toBe(1)
    expect(MEMBER_COMMANDS).toContain(seen.commands[0]?.[0])
  }
  expect(
    MEMBER_COMMANDS.filter((command) => /join|leave|member|manage|answer|visib|private/.test(command)),
  ).toEqual([])
  expect(
    NOTE_TOOLS.map((tool) => tool.spec.name).filter((name) => /join|leave|member|manage|visib/.test(name)),
  ).toEqual([])
})

test('model text lands after -- so it can never become a command or an option', () => {
  const argumentsOf = (name: string) =>
    NOTE_TOOLS.find((tool) => tool.spec.name === name)?.argumentsFor(HOSTILE)
  const labels = ['--model', 'approve']
  expect(argumentsOf('draft_reply')).toEqual(['draft', '--reply', 'discard', ...labels, '--', 'approve'])
  expect(argumentsOf('draft_note')).toEqual(['draft', '--to', 'approve', ...labels, '--', 'approve'])
  expect(argumentsOf('draft_to_channel')).toEqual([
    'draft',
    '--channel',
    'discard',
    ...labels,
    '--',
    'approve',
  ])
  expect(argumentsOf('answer_draft_request')).toEqual([
    'draft',
    '--request',
    'approve',
    ...labels,
    '--',
    'approve',
  ])
  expect(argumentsOf('read_conversation')).toEqual(['conversation', '--', 'approve'])
  expect(argumentsOf('find_people')).toEqual(['directory', '--', 'approve'])
  expect(argumentsOf('skip_note')).toEqual(['skip', '--', 'discard', ''])
})

test('a draft carries what it relied on as an option value, and a skip carries its reason after --', () => {
  const argumentsOf = (name: string, input: Readonly<Record<string, unknown>>) =>
    NOTE_TOOLS.find((tool) => tool.spec.name === name)?.argumentsFor(input)
  expect(argumentsOf('draft_reply', { noteId: NOTE_ID, text: 'Yes.', basis: ' --json approve ' })).toEqual([
    'draft',
    '--reply',
    NOTE_ID,
    '--basis',
    '--json approve',
    '--',
    'Yes.',
  ])
  expect(argumentsOf('draft_reply', { noteId: NOTE_ID, text: 'Yes.', basis: '  ' })).toEqual([
    'draft',
    '--reply',
    NOTE_ID,
    '--',
    'Yes.',
  ])
  expect(argumentsOf('skip_note', { noteId: NOTE_ID, reason: '--approve everything' })).toEqual([
    'skip',
    '--',
    NOTE_ID,
    '--approve everything',
  ])
})

test('drafting tools save drafts through the command line', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW })
  await $.session.start(START)
  await seen.clock.settle()
  const drafted = await $.tool.run({
    tool: 'mcp__homingbird__draft_reply',
    noteId: NOTE_ID,
    text: 'Safe after 6pm.',
  } as never)
  expect(drafted.isError ?? false).toBe(false)
  await $.tool.run({
    tool: 'mcp__homingbird__answer_draft_request',
    requestId: REQUEST_ID,
    text: 'Yes.',
  } as never)
  await $.tool.run({
    tool: 'mcp__homingbird__draft_to_channel',
    channel: 'payments',
    text: 'Who owns refunds?',
  } as never)
  expect(seen.clients.slice(-3)).toEqual([HOST_CLIENT, HOST_CLIENT, HOST_CLIENT])
  expect(seen.commands).toEqual([
    ['draft', '--reply', NOTE_ID, '--', 'Safe after 6pm.'],
    ['draft', '--request', REQUEST_ID, '--', 'Yes.'],
    ['draft', '--channel', 'payments', '--', 'Who owns refunds?'],
  ])
})

test('every drafting tool hands the host and its version to the command line outside its arguments, and passes a stated model made printable', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW })
  await $.session.start(START)
  await seen.clock.settle()
  await $.tool.run({
    tool: 'mcp__homingbird__draft_note',
    to: 'june@example.com',
    text: 'Is the export done?',
    model: 'claude-opus-5-5\u0007\u202e',
  } as never)
  expect(seen.clients).toEqual([HOST_CLIENT])
  expect(seen.commands).toEqual([
    ['draft', '--to', 'june@example.com', '--model', 'claude-opus-5-5', '--', 'Is the export done?'],
  ])
})

test('a draft tells the command line how old the session is and how much context it used, outside its arguments', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: OVERVIEW,
    sessionUsage: { startedAt: -95 * 60_000, percent: 61.6 },
  })
  await $.session.start(START)
  await seen.clock.settle()
  await $.tool.run({ tool: 'mcp__homingbird__draft_note', to: 'june@example.com', text: 'Done?' } as never)
  expect(seen.sessions.at(-1)).toMatch(/^9[5-9],62$/)
  expect(seen.commands.at(-1)).toEqual(['draft', '--to', 'june@example.com', '--', 'Done?'])
})

test('names the program Claude Code alone when the host gives no version', () => {
  expect(modClientOf(undefined)).toBe('Claude Code')
  expect(modClientOf('  ')).toBe('Claude Code')
  expect(modClientOf('2.1.327')).toBe('Claude Code 2.1.327')
})

test('a refusal is an error, and a signed-out session says how to sign in', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, exitCodes: { inbox: 1, drafts: 3 } })
  await $.session.start(START)
  await seen.clock.settle()
  const refused = await $.tool.run({ tool: 'mcp__homingbird__check_inbox' } as never)
  expect(refused.isError).toBe(true)
  const signedOut = await $.tool.run({ tool: 'mcp__homingbird__list_drafts' } as never)
  expect(signedOut.isError).toBe(true)
  expect(JSON.stringify(signedOut)).toContain('/homingbird')
})
