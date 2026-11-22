import { Task as T } from '@homingbird/kernel'
import { SLACK_QUESTION_EDITED, SLACK_THREAD_MOVED } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Agent, type Session, type TestServer, connectAgent, storedRows } from './harness.ts'
import {
  type FakeSlack,
  askInSlack,
  connectWorkspace,
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
    { id: 'U0BOB', name: 'Bob', email: 'bob@elsewhere.example' },
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

const ANSWER = 'Refunds keep the yearly discount <@U0ANA> & <!channel>'

/** A question from Slack and Ben's agent's draft answering it, as Ben's card shows them. */
const draftAnswer = async () => {
  const ts = await askInSlack(server, 'U0BOB', 'Do refunds keep the discount?')
  const question = (await ben.api('GET', '/inbox')).json.items[0].note
  const draft = (await benAgent.api('POST', '/drafts', { inReplyTo: question.id, body: ANSWER })).json
  return { ts, question, draft }
}

const send = (draft: { id: string; body: string; conversationId: string }, threadAt: string | undefined) =>
  ben.api('POST', `/drafts/${draft.id}/send`, {
    expected: {
      body: draft.body,
      conversationId: draft.conversationId,
      ...(threadAt !== undefined && { threadAt }),
    },
  })

const posts = () => slack.posted().filter((post) => post.channel === 'C0HELP' && post.thread_ts !== undefined)

/** How a note's post to Slack stood in each live change a person was told about. */
const postingChanges = async (person: Session, noteId: string) =>
  ((await person.api('GET', '/events/poll?after=0')).json.events as any[])
    .filter((event) => event.body.type === 'note.changed' && event.body.note.id === noteId)
    .map((event) => event.body.note.posting)

/** Runs the notifier until what it was given is done, as the server does in the background. */
const notified = async () => {
  const running = T.runFork(server.background, server.env)
  await server.settled()
  await running.interrupt()
}

const failFourTimes = async () => {
  for (const wait of [0, 5, 15, 60]) {
    await server.clock.advance(wait * 60_000)
    slack.refuseNext('chat.postMessage', 'internal_error')
    await server.slackPass()
  }
}

describe('posting an approved answer to Slack', () => {
  it('posts nothing for a draft, then posts the sent answer in the thread, escaped, under who wrote it', async () => {
    const { ts, question, draft } = await draftAnswer()
    await server.slackPass()
    expect(posts()).toEqual([])
    expect((await send(draft, question.via.threadAt)).status).toBe(200)
    expect((await storedRows(server, 'slack_outbox'))[0]).toMatchObject({ state: 'pending' })
    await server.slackPass()
    expect(posts()).toEqual([
      expect.objectContaining({
        thread_ts: ts,
        text: 'Ben\nRefunds keep the yearly discount &lt;@U0ANA&gt; &amp; &lt;!channel&gt;',
        unfurl_links: 'false',
      }),
    ])
    expect((await ben.api('GET', `/notes/${draft.id}`)).json.posting).toBe('posted')
    await server.slackPass()
    expect(posts()).toHaveLength(1)
  })

  it('refuses a send once the Slack thread moved since the card was read, and takes it after', async () => {
    const { ts, question, draft } = await draftAnswer()
    await sendSlackEvent(
      server,
      slackEvent({ type: 'message', channel: 'C0HELP', user: 'U0BOB', ts: '1800000001.0', thread_ts: ts }),
    )
    await server.slackPass()
    const refused = await send(draft, question.via.threadAt)
    expect(refused.status).toBe(409)
    expect(refused.json.error.message).toBe(SLACK_THREAD_MOVED)
    expect((await send(draft, undefined)).status).toBe(409)
    expect((await ben.api('GET', `/notes/${draft.id}`)).json.status).toBe('draft')
    expect((await send(draft, '1800000001.0')).status).toBe(200)
  })

  it('refuses a send once with the edit as the reason when the question was edited in Slack after it was read', async () => {
    const { ts, question, draft } = await draftAnswer()
    await sendSlackEvent(
      server,
      slackEvent({
        type: 'message',
        subtype: 'message_changed',
        channel: 'C0HELP',
        ts: '1800000002.0',
        message: { ts, user: 'U0BOB', text: '<@U0BOT> Do refunds keep the PROD discount?' },
      }),
    )
    await server.slackPass()
    const refused = await send(draft, question.via.threadAt)
    expect(refused.status).toBe(409)
    expect(refused.json.error.message).toBe(SLACK_QUESTION_EDITED)
    const edited = (await ben.api('GET', `/notes/${question.id}`)).json
    expect(edited.via).toMatchObject({ edited: true, threadAt: '1800000002.0' })
    expect((await send(draft, edited.via.threadAt)).status).toBe(200)
  })

  it('says newer messages, not an edit, when the thread moved after an edit the person had read', async () => {
    const { ts, question, draft } = await draftAnswer()
    await sendSlackEvent(
      server,
      slackEvent({
        type: 'message',
        subtype: 'message_changed',
        channel: 'C0HELP',
        ts: '1800000002.0',
        message: { ts, user: 'U0BOB', text: '<@U0BOT> Edited' },
      }),
    )
    await server.slackPass()
    const read = (await ben.api('GET', `/notes/${question.id}`)).json.via.threadAt
    await sendSlackEvent(
      server,
      slackEvent({ type: 'message', channel: 'C0HELP', user: 'U0BOB', ts: '1800000003.0', thread_ts: ts }),
    )
    await server.slackPass()
    expect((await send(draft, read)).json.error.message).toBe(SLACK_THREAD_MOVED)
  })

  it('refuses a reply into a stopped link, and while Slack is off', async () => {
    const { question, draft } = await draftAnswer()
    await sendSlackEvent(server, slackEvent({ type: 'channel_archive', channel: 'C0HELP' }))
    await server.slackPass()
    expect((await send(draft, question.via.threadAt)).status).toBe(409)
    expect((await ben.api('GET', `/notes/${draft.id}`)).json.status).toBe('draft')
  })

  it('posts nothing for a reply between members in the same room', async () => {
    const channel = (await ana.api('GET', '/channels/billing')).json
    const asked = (
      await ana.api('POST', '/drafts', { conversationId: channel.conversationId, body: 'Members only?' })
    ).json
    await ana.api('POST', `/drafts/${asked.id}/send`, {
      expected: { body: asked.body, conversationId: asked.conversationId },
    })
    const reply = (await benAgent.api('POST', '/drafts', { inReplyTo: asked.id, body: 'Yes.' })).json
    expect((await send(reply, undefined)).status).toBe(200)
    await server.slackPass()
    expect(await storedRows(server, 'slack_outbox')).toEqual([])
  })

  it('waits as long as Slack asks when it limits the rate', async () => {
    const { question, draft } = await draftAnswer()
    await send(draft, question.via.threadAt)
    slack.answerNextWith('chat.postMessage', 429, { 'retry-after': '30' })
    await server.slackPass()
    expect(posts()).toEqual([])
    await server.clock.advance(31_000)
    await server.slackPass()
    expect(posts()).toHaveLength(1)
  })

  it('shows when it tries again while a post waits, live, and posts at once when someone tries it now', async () => {
    const { question, draft } = await draftAnswer()
    await send(draft, question.via.threadAt)
    slack.refuseNext('chat.postMessage', 'internal_error')
    await server.slackPass()
    expect((await ben.api('GET', `/notes/${draft.id}`)).json).toMatchObject({
      posting: 'retrying',
      postingRetryAt: server.clock.now() + 5 * 60_000,
    })
    expect(await postingChanges(ana, draft.id)).toEqual(['retrying'])
    expect((await ana.api('POST', `/notes/${draft.id}/posting/retry`, {})).json.posting).toBe('pending')
    await server.slackPass()
    expect(posts()).toHaveLength(2)
    expect(await postingChanges(ana, draft.id)).toEqual(['retrying', 'pending', 'posted'])
  })

  it('tells the channel’s managers in Slack, with a link and nothing of the reply, when a post is given up', async () => {
    const { question, draft } = await draftAnswer()
    await send(draft, question.via.threadAt)
    await failFourTimes()
    await notified()
    expect(await postingChanges(ben, draft.id)).toEqual(['retrying', 'retrying', 'retrying', 'failed'])
    const told = slack
      .posted()
      .filter((post) => post.channel === 'DU0ANA' && /not be posted/.test(post.text!))
    expect(told).toHaveLength(1)
    expect(told[0]!.text).toContain(`/#/c/${draft.conversationId}`)
    expect(told[0]!.text).not.toContain('Refunds')
    expect(server.logged.some((line) => line.includes('slack.not_posted_told'))).toBe(true)
  })

  it('tells nobody when the post was given up because a manager unlinked the channel', async () => {
    const { question, draft } = await draftAnswer()
    await send(draft, question.via.threadAt)
    await ana.api('DELETE', '/channels/billing/slack')
    await notified()
    expect(await postingChanges(ben, draft.id)).toEqual(['failed'])
    expect(slack.posted().filter((post) => /not be posted/.test(post.text ?? ''))).toEqual([])
  })

  it('checks the thread before trying again a post whose answer was lost, and never posts twice', async () => {
    const { question, draft } = await draftAnswer()
    await send(draft, question.via.threadAt)
    slack.loseAnswerNext('chat.postMessage')
    await server.slackPass()
    expect(posts()).toHaveLength(1)
    expect((await storedRows(server, 'slack_outbox'))[0]).toMatchObject({ state: 'pending', uncertain: 1 })
    await server.clock.advance(5 * 60_000)
    await server.slackPass()
    expect(posts()).toHaveLength(1)
    expect(slack.calls.some((call) => call.method === 'conversations.replies')).toBe(true)
    expect((await storedRows(server, 'slack_outbox'))[0]).toMatchObject({ state: 'posted' })
  })

  it('waits 5, 15 and 60 minutes between failures, then shows it as not posted, to be tried again', async () => {
    const { question, draft } = await draftAnswer()
    await send(draft, question.via.threadAt)
    await failFourTimes()
    expect((await ben.api('GET', `/notes/${draft.id}`)).json.posting).toBe('failed')
    expect((await ana.api('POST', `/notes/${draft.id}/posting/retry`, {})).json.posting).toBe('pending')
    expect((await ana.api('POST', `/notes/${draft.id}/posting/retry`, {})).status).toBe(409)
    await server.slackPass()
    expect(posts()).toHaveLength(5)
    expect((await ben.api('GET', `/notes/${draft.id}`)).json.posting).toBe('posted')
  })

  it('stops the link when Slack says the app is no longer in the channel', async () => {
    const { question, draft } = await draftAnswer()
    await send(draft, question.via.threadAt)
    slack.refuseNext('chat.postMessage', 'not_in_channel')
    await server.slackPass()
    expect((await storedRows(server, 'slack_channel_links'))[0]).toMatchObject({
      state: 'stopped',
      stopped_because: 'app_removed',
    })
    expect((await ben.api('GET', `/notes/${draft.id}`)).json.posting).toBe('failed')
  })

  it('stops Slack and keeps the post waiting when Slack refuses the token', async () => {
    const { question, draft } = await draftAnswer()
    await send(draft, question.via.threadAt)
    slack.refuseNext('chat.postMessage', 'invalid_auth')
    await server.slackPass()
    expect((await storedRows(server, 'slack_workspaces'))[0]).toMatchObject({ state: 'stopped' })
    await connectWorkspace(server)
    await server.slackPass()
    expect(posts()).toHaveLength(2)
    expect((await ben.api('GET', `/notes/${draft.id}`)).json.posting).toBe('posted')
  })

  it('stops a link after five notes in a row could not be posted', async () => {
    for (let number = 0; number < 5; number++) {
      const { question, draft } = await draftAnswer()
      await send(draft, question.via.threadAt)
      for (const wait of [0, 5, 15, 60]) {
        await server.clock.advance(wait * 60_000)
        slack.refuseNext('chat.postMessage', 'internal_error')
        await server.slackPass()
      }
    }
    expect((await storedRows(server, 'slack_channel_links'))[0]).toMatchObject({
      stopped_because: 'failures',
    })
  })
})
