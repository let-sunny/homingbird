import { WRAPPER_TAG } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type Session,
  type TestServer,
  asShown,
  startTestServer,
  storedRows,
} from '../../dovecote/test/harness.ts'
import { EXIT } from '../src/failure.ts'
import { SERVER_URL, fetchThrough } from './server-fetch.ts'
import { INTERRUPTED, type World, agentFileFor, world } from './support.ts'

const AGENT_FILE = agentFileFor(SERVER_URL)

let server: TestServer
let ana: Session
let ben: Session

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
})

afterEach(() => server.close())

const device = (): World => world({ signedIn: 'none', fetch: fetchThrough(server), clock: server.clock })

const settle = async (condition: () => boolean): Promise<void> => {
  for (let turn = 0; turn < 400 && !condition(); turn++)
    await new Promise((resolve) => setTimeout(resolve, 5))
  if (!condition()) throw new Error('the awaited condition never came true')
}

const signIn = async (cli: World, owner: Session): Promise<number> => {
  const running = cli.run('login', '--server', SERVER_URL, '--name', 'Laptop', '--json')
  await settle(() => cli.lines.length > 0)
  const { userCode } = JSON.parse(cli.lines[0]!)
  await owner.api('POST', `/device/${userCode}`, { approve: true, name: 'Laptop' })
  await server.clock.advance(5_000)
  return running
}

const tokensIn = (cli: World): string[] =>
  cli.files.has(AGENT_FILE) ? [JSON.parse(cli.files.get(AGENT_FILE)!).token] : []

describe('the homingbird command against a running server', () => {
  it('signs in with the device flow and can then say who it is', async () => {
    const cli = device()
    expect(await signIn(cli, ana)).toBe(0)
    expect(cli.json()).toMatchObject({ step: 'signed_in', member: { email: 'ana@example.com' } })
    expect(cli.privateWrites).toEqual([AGENT_FILE])
    await cli.run('status', '--json')
    expect(cli.json()).toMatchObject({ signedIn: true, credential: { kind: 'agent', name: 'Laptop' } })
    const printed = [...cli.lines, ...cli.problems].join('\n')
    for (const token of tokensIn(cli)) expect(printed).not.toContain(token)
  })

  it('carries a question and its answer between two people’s devices, each person approving in the web client', async () => {
    const anaCli = device()
    const benCli = device()
    await signIn(anaCli, ana)
    await signIn(benCli, ben)
    expect(anaCli.privateWrites).toEqual([AGENT_FILE])

    await anaCli.run('directory', 'ben', '--json')
    expect(anaCli.json().entries[0]).toMatchObject({ member: { email: 'ben@example.com' }, canMessage: true })

    await anaCli.run('draft', '--to', 'ben@example.com', 'Is the migration safe?', '--json')
    const draftId: string = anaCli.json().draft.id
    await benCli.run('inbox', '--json')
    expect(benCli.json().items).toEqual([])

    expect((await ana.api('POST', `/drafts/${draftId}/send`, await asShown(ana, draftId))).json.status).toBe(
      'sent',
    )
    await benCli.run('inbox', '--json')
    const [waiting] = benCli.json().items
    expect(waiting.wrapped).toContain(`<${WRAPPER_TAG} id="${draftId}" from="Ana &lt;ana@example.com&gt;"`)

    await benCli.run('pickup', waiting.noteId)
    await benCli.run('draft', '--reply', waiting.noteId, 'Yes, after the nightly export.', '--json')
    const replyId: string = benCli.json().draft.id
    await anaCli.run('conversation', waiting.conversationId, '--json')
    expect(anaCli.json().notes).toHaveLength(1)
    expect(anaCli.json().notes[0].status).toBe('Drafting reply')

    await ben.api(
      'POST',
      `/drafts/${replyId}/send`,
      await asShown(ben, replyId, { body: 'Yes. Run it after the nightly export.' }),
    )
    await anaCli.run('conversation', waiting.conversationId)
    expect(anaCli.lines.at(-1)).toContain('Yes. Run it after the nightly export.')
    expect(anaCli.lines.at(-1)).toContain('(Replied)')
    const audit = await storedRows(server, 'audit_events')
    expect(
      audit.find((row) => row.event === 'note.approved' && row.target_id === replyId)?.credential_kind,
    ).toBe('human')
  })

  it('cannot approve or discard: there is no such command, and the stored credential is refused', async () => {
    const cli = device()
    await signIn(cli, ana)
    await cli.run('draft', '--to', 'ben@example.com', 'hello', '--json')
    const draftId: string = cli.json().draft.id
    expect(await cli.run('approve', draftId)).toBe(EXIT.usage)
    expect(await cli.run('discard', draftId)).toBe(EXIT.usage)
    const [token] = tokensIn(cli)
    for (const action of ['send', 'discard'])
      expect(
        (await server.request('POST', `/api/v1/drafts/${draftId}/${action}`, { token: token!, body: {} }))
          .status,
      ).toBe(403)
    expect((await ana.api('GET', `/notes/${draftId}`)).json.status).toBe('draft')
  })

  it('streams a note the moment it is sent, wrapped, and shows the member as having an agent online', async () => {
    const benCli = device()
    await signIn(benCli, ben)
    benCli.lines.length = 0
    const streaming = benCli.run('stream', '--json')
    const benIsOnline = async (): Promise<boolean> =>
      (await ana.api('GET', '/directory?q=ben')).json.entries[0].presence.agentOnline
    await settle(() => server.env.hub.presenceOf(ben.me.member.id).agentOnline)
    expect(await benIsOnline()).toBe(true)

    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Lunch at noon?' })).json
    await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))
    await settle(() => benCli.lines.length > 0)
    const line = JSON.parse(benCli.lines[0]!)
    expect(line.event.body.type).toBe('note.sent')
    expect(line.wrapped).toContain('Lunch at noon?')
    expect(line.wrapped.startsWith(`<${WRAPPER_TAG} id="${draft.id}"`)).toBe(true)

    benCli.stop.abort()
    expect(await streaming).toBe(INTERRUPTED)
    await settle(() => !server.env.hub.presenceOf(ben.me.member.id).agentOnline)
  })

  it('gathers an overview and signs out, revoking its credentials on the server', async () => {
    const cli = device()
    await signIn(cli, ana)
    await cli.run('overview', '--json')
    expect(cli.json()).toMatchObject({ signedIn: true, conversations: [], drafts: [] })
    const tokens = tokensIn(cli)
    expect(tokens).toHaveLength(1)
    expect(await cli.run('logout')).toBe(0)
    expect(cli.files.size).toBe(0)
    for (const token of tokens)
      expect((await server.request('GET', '/api/v1/me', { token })).status).toBe(401)
    expect(await cli.run('inbox')).toBe(EXIT.signedOut)
  })
})
