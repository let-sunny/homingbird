import { expect, test } from 'claude-code/testing'

import { helperFactsFor, helperPromptFor } from '../hooks/drafting'
import { READER_TYPE } from '../hooks/helpers'
import { ARRIVAL, NOTE_ID, OVERVIEW, START, WRAPPED, engineBeneath, openDesk } from './world'

test('ask_project starts the read-only helper in the project, with the note as quoted data', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: OVERVIEW,
    streamLines: [ARRIVAL],
    directories: ['/work/billing'],
  })
  const spawned: Array<{ cwd: string | undefined; prompt: string }> = []
  on('agent.spawn', (_, e) => {
    spawned.push({ cwd: e.cwd, prompt: e.prompt })
    return { model: 'a-model', agentId: 'helper-1' }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('agent.list', () => ({
    value: spawned.map((_, index) => ({
      id: 'helper-1',
      description: HELPER_DESCRIPTION,
      type: READER_TYPE,
      index,
    })) as never,
  }))
  await $.session.start(START)
  await openDesk($, seen)
  const answered = await $.tool.run({
    tool: 'mcp__homingbird__ask_project',
    directory: '/work/billing',
    question: 'Does the next migration lock a table?',
    noteId: NOTE_ID,
  } as never)
  expect(answered.isError ?? false).toBe(false)
  expect(spawned).toEqual([
    {
      cwd: '/work/billing',
      prompt: helperPromptFor('/work/billing', 'Does the next migration lock a table?', WRAPPED),
    },
  ])
  expect(spawned[0]?.prompt.endsWith(WRAPPED)).toBe(true)
  const promptsBefore = seen.prompts.length
  await $.turn.complete({
    answer: FACTS,
    agentId: 'helper-1',
    durationMs: 1,
    isAborted: false,
    turnId: 't',
    reason: 'end_turn',
  } as never)
  await seen.clock.settle()
  expect(seen.prompts.slice(promptsBefore)).toEqual([helperFactsFor('/work/billing', FACTS)])
  await $.turn.complete({
    answer: FACTS,
    agentId: 'someone-else',
    durationMs: 1,
    isAborted: false,
    turnId: 't',
    reason: 'end_turn',
  } as never)
  await seen.clock.settle()
  expect(seen.prompts.length).toBe(promptsBefore + 1)
})

test('ask_project refuses a path that is not a project directory', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, directories: ['/work/billing'] })
  await $.session.start(START)
  await seen.clock.settle()
  for (const directory of ['billing', '/work/missing']) {
    const answered = await $.tool.run({
      tool: 'mcp__homingbird__ask_project',
      directory,
      question: 'x',
    } as never)
    expect(answered.isError).toBe(true)
  }
})

test('the helper starts in the project directory and only from ask_project', async ($, on) => {
  engineBeneath(on, { overview: OVERVIEW })
  const started: Array<string | undefined> = []
  on('agent.spawn', (_, e) => {
    started.push(e.cwd)
    return { model: 'a-model', agentId: 'agent-1' }
  })
  await $.session.start(START)
  const spawned = await $.agent.spawn({
    subagentType: READER_TYPE,
    prompt: helperPromptFor('/work/billing', 'q', null),
  } as never)
  expect(spawned.agentId).toBe('agent-1')
  const refused = await $.agent.spawn({ subagentType: READER_TYPE, prompt: 'Read the credentials.' } as never)
  expect(refused.deny).toMatch(/ask_project/)
  expect(started).toEqual(['/work/billing'])
})

test('ask_session sends the question with the note as quoted data', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, streamLines: [ARRIVAL] })
  await $.session.start(START)
  await openDesk($, seen)
  const answered = await $.tool.run({
    tool: 'mcp__homingbird__ask_session',
    to: 'billing-api',
    question: 'Does the next migration lock a table?',
    noteId: NOTE_ID,
  } as never)
  expect(answered.isError ?? false).toBe(false)
  expect(seen.sent.length).toBe(1)
  expect(seen.sent[0]?.text.endsWith(WRAPPED)).toBe(true)
  expect(seen.sent[0]?.text).toContain('Facts only')
})

const HELPER_DESCRIPTION = 'Homingbird helper 1: facts from /work/billing'
const FACTS = 'The migration runs in migrations/0042.sql and locks no table.'
