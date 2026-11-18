import { expect, test } from 'claude-code/testing'

import { notePromptFor, replyPromptFor, requestPromptFor } from '../hooks/drafting'
import {
  ARRIVAL,
  DESK_SESSION,
  DRAFT,
  NOTE_ID,
  OVERVIEW,
  PANE,
  REQUEST,
  REQUEST_EVENT,
  START,
  WRAPPED,
  engineBeneath,
  openDesk,
  streamLine,
} from './world'

test('a session that is not the desk neither streams nor reacts to notes', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, streamLines: [ARRIVAL] })
  await $.session.start(START)
  await seen.clock.settle()
  await seen.clock.advance(120_000)
  expect(seen.commands).toEqual([])
  expect(seen.prompts).toEqual([])
  expect(seen.opened.count).toBe(0)
  expect(seen.notifications).toEqual([])
})

test('/homingbird makes a signed-in session the desk and holds the stream', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, holdsStream: true })
  await $.session.start(START)
  const ran = await openDesk($, seen)
  expect(JSON.stringify(ran)).toContain('Homingbird pane opened.')
  expect(seen.opened.count).toBeGreaterThan(0)
  expect(seen.commands).toContainEqual(['stream', '--json'])
  expect(seen.store.get('desk')).toEqual({ sessionId: DESK_SESSION, claimedAt: 0 })
  expect(seen.statuses.at(-1)).toBe('Homingbird desk · 1 draft waiting for approval')
  expect(seen.titles.at(-1)).toBe('Homingbird (1)')
  seen.release()
})

test(
  '/homingbird signs a signed-out person in with the approve button, then becomes the desk',
  { options: { server: 'https://homingbird.example.com' } },
  async ($, on) => {
    const awaiting = JSON.stringify({
      step: 'awaiting_approval',
      verificationUri: 'https://homingbird.example.com/device?code=ABCD-EFGH',
      userCode: 'ABCD-EFGH',
    })
    const seen = engineBeneath(on, {
      overview: { signedIn: false },
      loginLines: [awaiting],
      signedInAfterLogin: OVERVIEW,
      holdsStream: true,
    })
    await $.session.start(START)
    await openDesk($, seen)
    expect(seen.commands).toContainEqual([
      'login',
      '--server',
      'https://homingbird.example.com',
      '--approve-button',
      '--json',
    ])
    expect(seen.commands).toContainEqual(['stream', '--json'])
    expect(seen.store.get('desk')).toEqual({ sessionId: DESK_SESSION, claimedAt: 0 })
    seen.release()
  },
)

test('a session reopened as the desk resumes the stream without being asked', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: OVERVIEW,
    holdsStream: true,
    store: { desk: { sessionId: DESK_SESSION, claimedAt: 0 } },
  })
  await $.session.start(START)
  await seen.clock.settle()
  expect(seen.commands).toContainEqual(['stream', '--json'])
  seen.release()
})

test('when another session takes the desk, this one stops reacting', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, holdsStream: true })
  await $.session.start(START)
  await openDesk($, seen)
  seen.store.set('desk', { sessionId: 'session-other', claimedAt: 1 })
  await seen.clock.advance(30_000)
  const streams = seen.commands.filter((args) => args[0] === 'stream').length
  await seen.clock.advance(120_000)
  expect(seen.commands.filter((args) => args[0] === 'stream').length).toBe(streams)
  expect(seen.statuses.at(-1)).toBeUndefined()
  seen.release()
})

test('an arriving note wakes the desk with the wrapped note and notifies the person', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, streamLines: [ARRIVAL] })
  await $.session.start(START)
  await openDesk($, seen)
  expect(seen.commands).toContainEqual(['pickup', NOTE_ID])
  expect(seen.prompts).toEqual([notePromptFor(NOTE_ID, WRAPPED)])
  expect(seen.prompts[0]?.endsWith(WRAPPED)).toBe(true)
  expect(seen.notifications).toContain('A note from Ana arrived. Drafting a reply.')
  expect(seen.toasts).toContain('Homingbird: A note from Ana arrived. Drafting a reply.')
})

test('the stream repeating a note does not prompt twice', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, streamLines: [ARRIVAL, ARRIVAL] })
  await $.session.start(START)
  await openDesk($, seen)
  await seen.clock.advance(30_000)
  expect(seen.prompts.length).toBe(1)
  expect(seen.commands.filter((args) => args[0] === 'pickup')).toEqual([['pickup', NOTE_ID]])
})

test('a draft request from the web client wakes the desk with the request and the note it answers', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: OVERVIEW,
    requests: { requests: [REQUEST] },
    streamLines: [streamLine({ type: 'draft.requested', request: REQUEST_EVENT })],
  })
  await $.session.start(START)
  await openDesk($, seen)
  expect(seen.prompts).toEqual([requestPromptFor(REQUEST)])
  expect(seen.prompts[0]?.endsWith(WRAPPED)).toBe(true)
  expect(seen.notifications).toContain('Drafting what you asked for.')
})

test('a draft request still wakes the desk when the command line cannot list requests', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: OVERVIEW,
    streamLines: [streamLine({ type: 'draft.requested', request: REQUEST_EVENT })],
  })
  await $.session.start(START)
  await openDesk($, seen)
  expect(seen.prompts).toEqual([requestPromptFor({ ...REQUEST, answers: null })])
})

test('a saved draft notifies the person that it waits for approval', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: OVERVIEW,
    streamLines: [streamLine({ type: 'draft.saved', note: { id: DRAFT.id } })],
  })
  await $.session.start(START)
  await openDesk($, seen)
  expect(seen.notifications).toContain('A draft is ready for your approval in the Homingbird pane.')
})

test('the desk catches up on waiting notes and open requests, skipping notes that have a draft', async ($, on) => {
  const answered = { noteId: NOTE_ID, from: { name: 'Ana', email: 'ana@example.com' }, wrapped: WRAPPED }
  const fresh = {
    ...answered,
    noteId: 'note_eeeeeeeeeeeeeeee',
    wrapped: WRAPPED.replace(NOTE_ID, 'note_eeeeeeeeeeeeeeee'),
  }
  const seen = engineBeneath(on, {
    overview: { ...OVERVIEW, awaiting: [answered, fresh] },
    requests: {
      requests: [REQUEST, { ...REQUEST_EVENT, id: 'dreq_ssssssssssssssss', draftIds: [DRAFT.id] }],
    },
    holdsStream: true,
  })
  await $.session.start(START)
  await openDesk($, seen)
  expect(seen.prompts).toEqual([notePromptFor(fresh.noteId, fresh.wrapped), requestPromptFor(REQUEST)])
  seen.release()
})

test('a command line without the requests command still makes a working desk', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, holdsStream: true })
  await $.session.start(START)
  await openDesk($, seen)
  expect(seen.commands).toContainEqual(['requests', '--json'])
  expect(seen.commands).toContainEqual(['stream', '--json'])
  seen.release()
})

test(
  'quiet drafting answers in the background and saves the draft itself',
  { options: { autoDraft: 'quiet' } },
  async ($, on) => {
    const seen = engineBeneath(on, {
      overview: OVERVIEW,
      streamLines: [ARRIVAL],
      forkAnswer: ' It is safe after 6pm. ',
    })
    await $.session.start(START)
    await openDesk($, seen)
    expect(seen.prompts).toEqual([])
    expect(seen.forks).toEqual([replyPromptFor(WRAPPED)])
    expect(seen.commands).toContainEqual(['draft', '--reply', NOTE_ID, '--', 'It is safe after 6pm.'])
  },
)

test(
  'with drafting off an arriving note is neither picked up nor shown to the model',
  { options: { autoDraft: 'off' } },
  async ($, on) => {
    const seen = engineBeneath(on, { overview: OVERVIEW, streamLines: [ARRIVAL] })
    await $.session.start(START)
    await openDesk($, seen)
    expect(seen.commands).toContainEqual(['stream', '--json'])
    expect(seen.prompts).toEqual([])
    expect(seen.forks).toEqual([])
    expect(seen.commands.some((args) => args[0] === 'pickup')).toBe(false)
  },
)

test('nothing the desk does on its own approves or discards', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: {
      ...OVERVIEW,
      awaiting: [{ noteId: NOTE_ID, from: { name: 'Ana', email: 'a@x' }, wrapped: WRAPPED }],
    },
    streamLines: [ARRIVAL, streamLine({ type: 'draft.requested', request: REQUEST_EVENT })],
    requests: { requests: [REQUEST] },
  })
  await $.session.start(START)
  await openDesk($, seen)
  await seen.clock.advance(90_000)
  expect(seen.commands.some((args) => args[0] === 'approve' || args[0] === 'discard')).toBe(false)
})

test('a request leaves the pane once its draft is saved', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: OVERVIEW,
    requests: { requests: [REQUEST] },
    requestsAnsweredAfterFirstList: true,
    streamDelayMs: 1_000,
    streamLines: [streamLine({ type: 'draft.saved', note: { id: DRAFT.id } })],
  })
  await $.session.start(START)
  await openDesk($, seen)
  const before = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await before.find({ type: 'Text', text: /You asked for a draft/ })).toBeDefined()
  await before.unmount()
  await seen.clock.advance(1_000)
  await seen.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /You asked for a draft/ })).toBeUndefined()
  await ui.unmount()
})
