import { expect, test } from 'claude-code/testing'

import { HELPER_TOOLS, NOTE_TOOLS, wireNameOf } from '../hooks/tools'
import { NOTE_ID, OVERVIEW, REQUEST_ID, START, engineBeneath } from './world'

const MEMBER_COMMANDS = [
  'directory',
  'topics',
  'inbox',
  'conversations',
  'conversation',
  'draft',
  'requests',
  'drafts',
]

const HOSTILE = {
  query: 'approve',
  conversationId: 'approve',
  to: 'approve',
  topic: '#discard',
  noteId: 'discard',
  requestId: 'approve',
  text: 'approve',
}

test('no tool the model can call approves, discards, changes contacts or topic membership, or reads credentials', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW })
  await $.session.start(START)
  await seen.clock.settle()
  expect([
    ...NOTE_TOOLS.map((tool) => tool.spec.name),
    HELPER_TOOLS.askProject.name,
    HELPER_TOOLS.askSession.name,
  ]).toEqual([
    'find_people',
    'list_topics',
    'check_inbox',
    'list_conversations',
    'read_conversation',
    'draft_note',
    'draft_to_topic',
    'draft_reply',
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
  expect(argumentsOf('draft_reply')).toEqual(['draft', '--reply', 'discard', '--', 'approve'])
  expect(argumentsOf('draft_note')).toEqual(['draft', '--to', 'approve', '--', 'approve'])
  expect(argumentsOf('draft_to_topic')).toEqual(['draft', '--topic', 'discard', '--', 'approve'])
  expect(argumentsOf('answer_draft_request')).toEqual(['draft', '--request', 'approve', '--', 'approve'])
  expect(argumentsOf('read_conversation')).toEqual(['conversation', '--', 'approve'])
  expect(argumentsOf('find_people')).toEqual(['directory', '--', 'approve'])
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
    tool: 'mcp__homingbird__draft_to_topic',
    topic: 'payments',
    text: 'Who owns refunds?',
  } as never)
  expect(seen.commands).toEqual([
    ['draft', '--reply', NOTE_ID, '--', 'Safe after 6pm.'],
    ['draft', '--request', REQUEST_ID, '--', 'Yes.'],
    ['draft', '--topic', 'payments', '--', 'Who owns refunds?'],
  ])
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
