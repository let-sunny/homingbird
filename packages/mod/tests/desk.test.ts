import { expect, test } from 'claude-code/testing'

import { notePromptFor, replyPromptFor, requestPromptFor } from '../hooks/drafting'
import {
  ARRIVAL,
  DESK_SESSION,
  DRAFT,
  HOST_CLIENT,
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
  'with a configured server the pane offers Sign in to its host and Open web; signing in asks for an agent credential, then becomes the desk',
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
    expect(seen.commands.some((command) => command[0] === 'login')).toBe(false)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ key: 'sign-in' }))?.props?.label).toBe('Sign in to homingbird.example.com')
    expect((await ui.find({ type: 'Link', text: /Open web/ }))?.props?.href).toBe(
      'https://homingbird.example.com',
    )
    await ui.press({ key: 'sign-in' })
    await seen.clock.settle()
    await ui.unmount()
    expect(seen.commands).toContainEqual(['login', '--server', 'https://homingbird.example.com', '--json'])
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

test('a debate room waiting on the agent gives the person one notice per ask, and the desk takes no turn', async ($, on) => {
  const changed = streamLine(
    { type: 'debate.changed', debateId: 'deb_debate000000', participantIds: ['mem_mmmmmmmmmmmmmmmm'] },
    {},
  )
  const seen = engineBeneath(on, {
    overview: OVERVIEW,
    debates: [
      { id: 'deb_debate000000', wants: 'turn', turnsTaken: 1 },
      { id: 'deb_debate111111', wants: 'result', turnsTaken: 4 },
      { id: 'deb_debate222222', wants: 'nothing' },
    ],
    streamLines: [changed, changed],
  })
  await $.session.start(START)
  await openDesk($, seen)
  expect(seen.notifications.filter((text) => text.startsWith('A debate room'))).toEqual([
    'A debate room is waiting for your agent’s turn. The desk or runner connected to this server can take it; follow the room in the web client.',
    'A debate room’s turns ran out and it asks your agent for the result. People approve it in the web client.',
  ])
  expect(seen.prompts).toEqual([])
  expect(seen.commands.filter((args) => args[0] === 'debates')).toHaveLength(2)
})

test('a debate room change says nothing when the command line cannot list rooms', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: OVERVIEW,
    exitCodes: { debates: 2 },
    streamLines: [
      streamLine({
        type: 'debate.changed',
        debateId: 'deb_debate000000',
        participantIds: ['mem_mmmmmmmmmmmmmmmm'],
      }),
    ],
  })
  await $.session.start(START)
  await openDesk($, seen)
  expect(seen.notifications.filter((text) => text.startsWith('A debate room'))).toEqual([])
})

test('a change in a room the agent takes no part in runs nothing', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: OVERVIEW,
    debates: [{ id: 'deb_debate000000', wants: 'turn', turnsTaken: 1, resultRound: 0 }],
    streamLines: [
      streamLine({ type: 'debate.changed', debateId: 'deb_debate000000', participantIds: ['mem_other'] }),
    ],
  })
  await $.session.start(START)
  await openDesk($, seen)
  expect(seen.commands.filter((args) => args[0] === 'debates')).toEqual([])
})

test('a declined result gives a new notice when the room asks for the result again', async ($, on) => {
  const changed = streamLine({
    type: 'debate.changed',
    debateId: 'deb_debate000000',
    participantIds: ['mem_mmmmmmmmmmmmmmmm'],
  })
  let lists = 0
  const world = {
    overview: OVERVIEW,
    streamLines: [changed, changed, changed],
    get debates(): unknown[] {
      lists += 1
      return [{ id: 'deb_debate000000', wants: 'result', turnsTaken: 4, resultRound: lists < 3 ? 0 : 1 }]
    },
  }
  const seen = engineBeneath(on, world)
  await $.session.start(START)
  await openDesk($, seen)
  expect(lists).toBe(3)
  expect(seen.notifications.filter((text) => text.includes('asks your agent for the result'))).toHaveLength(2)
})

test('a saved draft notifies the person that it waits for approval', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: OVERVIEW,
    streamLines: [streamLine({ type: 'draft.saved', note: { id: DRAFT.id } })],
  })
  await $.session.start(START)
  await openDesk($, seen)
  expect(seen.notifications).toContain('A draft is ready for your approval in the Homingbird web client.')
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
    expect(seen.clients).toContain(HOST_CLIENT)
    expect(seen.commands).toContainEqual(['draft', '--reply', NOTE_ID, '--', 'It is safe after 6pm.'])
  },
)

test(
  'quiet drafting that finds nothing to say gives the note back with a reason instead of leaving it drafting',
  { options: { autoDraft: 'quiet' } },
  async ($, on) => {
    const seen = engineBeneath(on, { overview: OVERVIEW, streamLines: [ARRIVAL], forkAnswer: 'NO_REPLY' })
    await $.session.start(START)
    await openDesk($, seen)
    expect(seen.commands).toContainEqual([
      'skip',
      '--',
      NOTE_ID,
      'Quiet drafting runs without tools, so this mode cannot read your knowledge sources, follow answering-flow steps that need tools, open linked documents or look anything up; ask for a draft from the web client, or set Desk drafting to turn.',
    ])
    expect(seen.commands.some((command) => command[0] === 'draft')).toBe(false)
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

test('the status line, toasts and notifications speak the person’s language', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: OVERVIEW,
    locale: 'ko',
    streamLines: [ARRIVAL],
  })
  await $.session.start(START)
  await openDesk($, seen)
  expect(seen.statuses).toContain('Homingbird 전용 세션 · 승인을 기다리는 초안 1개')
  expect(seen.notifications).toContain('Ana 님이 보낸 노트가 도착했어요. 답장 초안을 쓰고 있어요.')
  expect(seen.toasts).toContain('Homingbird: Ana 님이 보낸 노트가 도착했어요. 답장 초안을 쓰고 있어요.')
  expect(seen.commands.filter((args) => args[0] === 'status')).toEqual([['status', '--json']])
})

const FLOW_BLOCK =
  'The answering flow: steps the administrator of this Homingbird server set for every answer.\n1. Look for an existing answer.'

test('an arriving note and a draft request carry the administrator’s answering flow, ahead of the wrapped note', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: { ...OVERVIEW, answeringFlow: FLOW_BLOCK },
    streamLines: [ARRIVAL, streamLine({ type: 'draft.requested', request: REQUEST_EVENT })],
    requests: { requests: [REQUEST_EVENT] },
  })
  await $.session.start(START)
  await openDesk($, seen)
  const forNote = seen.prompts.find((prompt) => prompt.includes(`draft_reply tool with noteId "${NOTE_ID}"`))
  const forRequest = seen.prompts.find((prompt) => prompt.includes('asked for a Homingbird draft'))
  expect(forNote).toContain(FLOW_BLOCK)
  expect(forNote!.indexOf(FLOW_BLOCK)).toBeLessThan(forNote!.indexOf('<colleague-note'))
  expect(forRequest).toContain(FLOW_BLOCK)
  seen.release()
})

test(
  'quiet drafting follows only the wording steps of the answering flow',
  { options: { autoDraft: 'quiet' } },
  async ($, on) => {
    const seen = engineBeneath(on, {
      overview: { ...OVERVIEW, answeringFlow: FLOW_BLOCK },
      streamLines: [ARRIVAL],
      forkAnswer: 'Safe after 6pm.',
    })
    await $.session.start(START)
    await openDesk($, seen)
    expect(seen.forks[0]).toContain(FLOW_BLOCK)
    expect(seen.forks[0]).toContain('you can follow only its steps about wording')
  },
)

test('each draft carries the guidance for its own conversation, so a channel’s principles come first', async ($, on) => {
  const channel = 'conv_tttttttttttttttt'
  const seen = engineBeneath(on, {
    overview: {
      ...OVERVIEW,
      answeringFlow: FLOW_BLOCK,
      awaiting: [
        {
          noteId: NOTE_ID,
          conversationId: channel,
          from: { name: 'Ana', email: 'ana@example.com' },
          wrapped: WRAPPED,
        },
      ],
    },
    streamLines: [ARRIVAL, streamLine({ type: 'draft.requested', request: REQUEST_EVENT })],
    requests: { requests: [REQUEST_EVENT] },
    guidance: {
      [channel]: 'GUIDANCE FOR #payments',
      [REQUEST_EVENT.conversationId]: 'GUIDANCE FOR THE DIRECT MESSAGE',
    },
  })
  await $.session.start(START)
  await openDesk($, seen)
  const forNote = seen.prompts.find((prompt) => prompt.includes(`draft_reply tool with noteId "${NOTE_ID}"`))
  const forRequest = seen.prompts.find((prompt) => prompt.includes('asked for a Homingbird draft'))
  expect(forNote).toContain('GUIDANCE FOR #payments')
  expect(forNote).not.toContain(FLOW_BLOCK)
  expect(forRequest).toContain('GUIDANCE FOR THE DIRECT MESSAGE')
  expect(seen.commands).toContainEqual(['guidance', channel, '--json'])
  expect(seen.commands).toContainEqual(['guidance', REQUEST_EVENT.conversationId, '--json'])
  seen.release()
})

test('with no answering flow the prompts carry none', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, streamLines: [ARRIVAL] })
  await $.session.start(START)
  await openDesk($, seen)
  expect(seen.prompts.join('\n')).not.toContain('answering flow')
})

test(
  'signing out and in again in one session ends the old stream and starts a live one for the new credential',
  { options: { server: 'https://homingbird.example.com' } },
  async ($, on) => {
    const world = {
      overview: OVERVIEW as unknown,
      holdsStream: true,
      loginLines: [
        JSON.stringify({ step: 'awaiting_approval', verificationUri: 'https://x/', userCode: 'A' }),
      ],
      signedInAfterLogin: OVERVIEW,
    }
    const seen = engineBeneath(on, world)
    await $.session.start(START)
    await openDesk($, seen)
    expect(seen.commands.filter((args) => args[0] === 'stream')).toHaveLength(1)
    world.overview = { signedIn: false }
    await seen.clock.advance(30_000)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'sign-in' })
    await seen.clock.settle()
    await ui.unmount()
    expect(seen.commands.filter((args) => args[0] === 'stream')).toHaveLength(2)
    const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await after.find({ type: 'Text', text: /desk · live/ })).toBeDefined()
    await after.unmount()
    seen.release()
  },
)

test(
  'every command names the one server this session is bound to, so another server’s credential is never used',
  { options: { server: 'https://homingbird.example.com' } },
  async ($, on) => {
    const seen = engineBeneath(on, { overview: OVERVIEW, holdsStream: true })
    await $.session.start(START)
    await openDesk($, seen)
    expect(seen.commands.length).toBeGreaterThan(2)
    expect(new Set(seen.servers)).toEqual(new Set(['https://homingbird.example.com']))
    seen.release()
  },
)

test(
  'reproduction: after signing out in the pane it offers Sign in to its own server, never another identity',
  { options: { server: 'https://homingbird.example.com' } },
  async ($, on) => {
    const world = { overview: OVERVIEW as unknown, holdsStream: true }
    const seen = engineBeneath(on, world)
    await $.session.start(START)
    await openDesk($, seen)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    world.overview = { signedIn: false }
    await ui.press({ key: 'sign-out' })
    await seen.clock.settle()
    await ui.unmount()
    expect(seen.commands).toContainEqual(['logout'])
    expect(seen.servers.at(seen.commands.findIndex((args) => args[0] === 'logout'))).toBe(
      'https://homingbird.example.com',
    )
    const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await after.find({ key: 'sign-in' }))?.props?.label).toBe('Sign in to homingbird.example.com')
    expect(await after.find({ type: 'Text', text: /Ben on/ })).toBeUndefined()
    await after.unmount()
    seen.release()
  },
)

test('when the account or server the pane shows changes, the desk stops and says so', async ($, on) => {
  const world = { overview: OVERVIEW as unknown, holdsStream: true }
  const seen = engineBeneath(on, world)
  await $.session.start(START)
  await openDesk($, seen)
  const streams = seen.commands.filter((args) => args[0] === 'stream').length
  world.overview = {
    ...OVERVIEW,
    member: { id: 'mem_aaaaaaaaaaaaaaaa', name: 'Ana', email: 'ana@example.com' },
  }
  await seen.clock.advance(30_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(
    await ui.find({
      type: 'Text',
      text: /now shows Ana on https:\/\/homingbird\.example\.com instead of Ben/,
    }),
  ).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Keep this session open/ })).toBeUndefined()
  await ui.unmount()
  await seen.clock.advance(120_000)
  expect(seen.commands.filter((args) => args[0] === 'stream').length).toBe(streams)
  seen.release()
})
