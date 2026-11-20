import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type Agent,
  type Session,
  type TestServer,
  asShown,
  connectAgent,
  startTestServer,
} from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let anaAgent: Agent

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
})

afterEach(() => server.close())

const applying = async (body: string) =>
  (
    await anaAgent.api('POST', '/drafts', {
      to: [ben.me.member.id],
      body,
      basis: 'Principles applied: Release dates',
    })
  ).json

describe('a principle as the server keeps it', () => {
  it('counts what became of each draft that applied it: sent as written, edited, discarded, or marked wrong', async () => {
    await ana.api('POST', '/principles', { topic: 'Release dates', rule: 'give the weekday', place: null })
    const asWritten = await applying('Tuesday.')
    const edited = await applying('Wednesday.')
    const discarded = await applying('Thursday.')
    const undecided = await applying('Friday.')
    await ana.api('POST', `/drafts/${asWritten.id}/send`, await asShown(ana, asWritten.id))
    await ana.api(
      'POST',
      `/drafts/${edited.id}/send`,
      await asShown(ana, edited.id, { body: 'Wednesday at noon.' }),
    )
    await ana.api('POST', `/drafts/${discarded.id}/discard`)
    const [principle] = (await ana.api('GET', '/principles')).json.principles
    await ana.api('POST', `/principles/${principle.id}/misses`, { noteId: undecided.id })
    expect((await ana.api('GET', '/principles')).json.principles[0].counts).toEqual({
      applied: 4,
      sentAsWritten: 1,
      edited: 1,
      discarded: 1,
      missed: 1,
    })
  })

  it('belongs to its person: another member’s id finds nothing', async () => {
    const saved = (
      await ana.api('POST', '/principles', { topic: 'Release dates', rule: 'give the weekday', place: null })
    ).json
    expect((await ben.api('PATCH', `/principles/${saved.id}`, { enabled: false })).status).toBe(404)
    expect((await ben.api('DELETE', `/principles/${saved.id}`)).status).toBe(404)
    expect((await ana.api('GET', '/principles')).json.principles[0].enabled).toBe(true)
  })
})
