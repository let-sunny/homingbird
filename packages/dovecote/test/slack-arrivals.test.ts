import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Agent, type Session, type TestServer, connectAgent, storedRows } from './harness.ts'
import {
  type FakeSlack,
  askInSlack,
  fakeSlack,
  linkChannel,
  linkPerson,
  sendSlackEvent,
  slackEvent,
  startSlackServer,
} from './slack-support.ts'

let server: TestServer
let slack: FakeSlack
let ana: Session
let ben: Session
let benAgent: Agent

beforeEach(async () => {
  slack = fakeSlack([
    { id: 'U0ANA', name: 'Ana Silva', email: 'ana@example.com' },
    { id: 'U0BEN', name: 'Ben', email: 'ben@example.com' },
    { id: 'U0BOB', name: 'Bob', email: 'bob@elsewhere.example' },
    { id: 'U0GUS', name: 'Gus', guest: true },
  ])
  server = await startSlackServer(slack)
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
  await ana.api('POST', '/channels', { slug: 'billing', description: 'Billing' })
  await ben.api('PUT', '/channels/billing/membership')
  await ben.api('PUT', '/channels/billing/answering')
  await linkPerson(server, slack, ana)
  await linkChannel(server, slack, ana, 'U0ANA', 'billing')
})

afterEach(() => server?.close())

const roomNotes = async () => {
  const channel = (await ana.api('GET', '/channels/billing')).json
  return (await ana.api('GET', `/conversations/${channel.conversationId}/notes`)).json.notes as any[]
}

const ephemerals = () =>
  slack.calls.filter((call) => call.method === 'chat.postEphemeral').map((call) => call.fields)

describe('a question asked in a linked Slack channel', () => {
  it('arrives as a sent note of the link, recorded as arriving, with who asked and where', async () => {
    const ts = await askInSlack(server, 'U0BOB', 'What is the refund rule for annual plans?')
    const [note] = await roomNotes()
    expect(note).toMatchObject({
      status: 'sent',
      body: 'What is the refund rule for annual plans?',
      origin: 'outside',
      inReplyTo: null,
      via: {
        tool: 'slack',
        askerName: 'Bob',
        askerId: null,
        channelName: 'billing-help',
        edited: false,
        deleted: false,
        threadAt: ts,
        newerMessages: 0,
      },
    })
    expect(note.approvedBy).toBeUndefined()
    expect(note.receipts.map((receipt: { memberId: string }) => receipt.memberId)).toContain(ben.me.member.id)
    expect(slack.calls.find((call) => call.method === 'reactions.add')!.fields).toEqual({
      channel: 'C0HELP',
      timestamp: ts,
      name: 'eyes',
    })
    expect(JSON.stringify(note)).not.toContain('U0BOB')
  })

  it('reaches the answerers’ agents as a channel question', async () => {
    await askInSlack(server, 'U0BOB', 'Is the export nightly?')
    const inbox = (await benAgent.api('GET', '/inbox')).json
    expect(JSON.stringify(inbox)).toContain('Is the export nightly?')
  })

  it('turns Slack’s markup into plain text and names the people it mentions', async () => {
    await askInSlack(
      server,
      'U0BOB',
      'ask <@U0ANA> and <!here> in <#C0X|general>: <https://docs.example/refunds|the docs> &amp; <https://x.example>',
    )
    const [note] = await roomNotes()
    expect(note.body).toBe(
      'ask @Ana Silva and @here in #general: the docs (https://docs.example/refunds) & https://x.example',
    )
  })

  it('keeps one note for a message Slack sent twice, and nothing for a mention with no text', async () => {
    const ts = await askInSlack(server, 'U0BOB', 'Twice?')
    await askInSlack(server, 'U0BOB', 'Twice?', { ts })
    await askInSlack(server, 'U0BOB', '')
    expect(await roomNotes()).toHaveLength(1)
  })

  it('replies a follow-up in the thread to the thread’s newest note', async () => {
    const ts = await askInSlack(server, 'U0BOB', 'First?')
    const [first] = await roomNotes()
    await askInSlack(server, 'U0BOB', 'And then?', { threadTs: ts })
    const notes = await roomNotes()
    expect(notes.find((note) => note.body === 'And then?').inReplyTo).toBe(first.id)
  })

  it('tells a guest only full members are answered, and keeps nothing', async () => {
    await askInSlack(server, 'U0GUS', 'Can I ask?')
    expect(ephemerals().at(-1)!.text).toBe('Homingbird answers full members of Acme only.')
    expect(await roomNotes()).toEqual([])
  })

  it('takes ten questions an hour from one person, then tells them to wait', async () => {
    for (let number = 0; number < 11; number++) await askInSlack(server, 'U0BOB', `Question ${number}?`)
    expect(await roomNotes()).toHaveLength(10)
    expect(ephemerals().at(-1)!.text).toBe(
      'You asked Homingbird 10 questions here in the last hour. Ask again later.',
    )
    await server.clock.advance(60 * 60_000 + 1)
    await askInSlack(server, 'U0BOB', 'Later?')
    expect(await roomNotes()).toHaveLength(11)
  })

  it('records a linked asker by their link, and one with a member’s email as that member for review only', async () => {
    await askInSlack(server, 'U0ANA', 'Mine?')
    await askInSlack(server, 'U0BEN', 'Ben’s?')
    const arrivals = await storedRows(server, 'slack_arrivals')
    expect(arrivals.find((row) => row.asker_slack_id === 'U0ANA')).toMatchObject({
      asker_member_id: ana.me.member.id,
      asker_linked: 1,
    })
    expect(arrivals.find((row) => row.asker_slack_id === 'U0BEN')).toMatchObject({
      asker_member_id: ben.me.member.id,
      asker_linked: 0,
    })
    const notes = await roomNotes()
    expect(notes.find((note) => note.body === 'Mine?').via.askerId).toBe(ana.me.member.id)
    expect(notes.find((note) => note.body === 'Ben’s?').via.askerId).toBeNull()
  })

  it('counts the messages a thread gets after its question, and its newest one, ignoring the app’s own', async () => {
    const ts = await askInSlack(server, 'U0BOB', 'Moving?')
    for (const [user, at] of [
      ['U0BOB', '1800000001.000100'],
      ['U0BOT', '1800000002.000100'],
      ['U0ANA', '1700000000.000100'],
    ] as const)
      await sendSlackEvent(
        server,
        slackEvent({ type: 'message', channel: 'C0HELP', user, ts: at, thread_ts: ts, text: 'thanks' }),
      )
    await sendSlackEvent(
      server,
      slackEvent({ type: 'message', channel: 'C0HELP', bot_id: 'B0BOT', ts: '1800000003.0', thread_ts: ts }),
    )
    await sendSlackEvent(
      server,
      slackEvent({ type: 'message', channel: 'C0HELP', user: 'U0BOB', ts: '1800000004.0', thread_ts: '1.0' }),
    )
    await sendSlackEvent(
      server,
      slackEvent({
        type: 'message',
        subtype: 'channel_join',
        channel: 'C0HELP',
        user: 'U0BOB',
        ts: '1800000005.0',
        thread_ts: ts,
      }),
    )
    await sendSlackEvent(
      server,
      slackEvent({
        type: 'message',
        channel: 'C0UNLINKED',
        user: 'U0BOB',
        ts: '1800000006.0',
        thread_ts: ts,
      }),
    )
    await sendSlackEvent(server, slackEvent({ type: 'message', channel: 'C0HELP', user: 'U0BOB', ts }))
    await server.slackPass()
    const [note] = await roomNotes()
    expect(note.via).toMatchObject({ threadAt: '1800000001.000100', newerMessages: 1 })
    expect(JSON.stringify(await storedRows(server, 'slack_events'))).not.toContain('thanks')
  })

  it('follows an edit in Slack, and a deletion, which discards the drafts answering it and tells their authors', async () => {
    const ts = await askInSlack(server, 'U0BOB', 'Original?')
    const [question] = await roomNotes()
    const draft = (await benAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'An answer' })).json
    await sendSlackEvent(
      server,
      slackEvent({
        type: 'message',
        subtype: 'message_changed',
        channel: 'C0HELP',
        ts: '1800000010.0',
        message: { ts, user: 'U0BOB', text: '<@U0BOT> Edited?' },
      }),
    )
    await sendSlackEvent(
      server,
      slackEvent({
        type: 'message',
        subtype: 'message_changed',
        channel: 'C0HELP',
        ts: '1800000011.0',
        message: { ts: '5.5', user: 'U0BOB', text: 'not ours' },
      }),
    )
    await server.slackPass()
    expect((await roomNotes())[0]).toMatchObject({
      body: 'Edited?',
      via: { edited: true, threadAt: '1800000010.0' },
    })
    await sendSlackEvent(
      server,
      slackEvent({
        type: 'message',
        subtype: 'message_deleted',
        channel: 'C0HELP',
        ts: '1800000012.0',
        deleted_ts: ts,
      }),
    )
    await server.slackPass()
    expect((await roomNotes())[0]).toMatchObject({
      body: 'Deleted in Slack.',
      via: { deleted: true, edited: true },
    })
    expect((await ben.api('GET', `/notes/${draft.id}`)).json.status).toBe('discarded')
    const notices = await storedRows(server, 'notices')
    expect(notices).toEqual([expect.objectContaining({ kind: 'slack_deleted', note_id: draft.id })])
  })

  it('answers a mention in a channel that is not linked, and stays silent in a stopped link', async () => {
    await askInSlack(server, 'U0BOB', 'Here?', { channel: 'C0ELSE' })
    expect(ephemerals().at(-1)!.text).toContain('not linked to Homingbird')
    await sendSlackEvent(server, slackEvent({ type: 'channel_archive', channel: 'C0HELP' }))
    await server.slackPass()
    const before = slack.calls.length
    await askInSlack(server, 'U0BOB', 'Still?')
    expect(slack.calls.length).toBe(before)
  })
})
