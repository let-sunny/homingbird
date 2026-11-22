import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { slackFactsOf } from '../src/slack/slack-note-facts.ts'
import { type Session, type TestServer, storedRows } from './harness.ts'
import { askInSlack, fakeSlack, linkChannel, linkPerson, startSlackServer } from './slack-support.ts'

let server: TestServer
let ana: Session

beforeEach(async () => {
  const slack = fakeSlack([
    { id: 'U0ANA', name: 'Ana Silva', email: 'ana@example.com' },
    { id: 'U0BOB', name: 'Bob' },
  ])
  server = await startSlackServer(slack)
  ana = await server.signIn('ana@example.com', 'Ana')
  await ana.api('POST', '/channels', { slug: 'billing', description: 'Billing' })
  await linkPerson(server, slack, ana)
  await linkChannel(server, slack, ana, 'U0ANA', 'billing')
})

afterEach(() => server.close())

describe('what a note’s readers see of Slack', () => {
  it('reads nothing for notes that never touched Slack', async () => {
    const facts = await T.runPromise(slackFactsOf([]), server.env)
    expect(facts.via.size).toBe(0)
    expect(facts.posting.size).toBe(0)
  })

  it('counts newer messages on the thread’s newest question only', async () => {
    const ts = await askInSlack(server, 'U0BOB', 'First?')
    await askInSlack(server, 'U0BOB', 'Second?', { threadTs: ts })
    const rows = (await storedRows(server, 'notes')).filter((row) => row.origin === 'outside')
    const facts = await T.runPromise(slackFactsOf(rows as never), server.env)
    const [first, second] = rows.map((row) => facts.via.get(row.id as never)!)
    expect(first).toMatchObject({ askerName: 'Bob', channelName: 'billing-help', newerMessages: 0 })
    expect(second!.threadAt).toBe(first!.threadAt)
  })
})
