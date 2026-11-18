import { Task as T } from '@homingbird/kernel'
import { CHARACTER_BYTES_MAX, characterProblems } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/sql/database.ts'
import { raw } from '../src/sql/query.ts'
import {
  type Agent,
  type Session,
  type TestServer,
  connectAgent,
  everyStoredValue,
  startTestServer,
  storedRows,
} from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let benAgent: Agent

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
})

afterEach(() => server.close())

const OTTER = {
  version: 1,
  base: 'bubble-16',
  id: 'my-otter',
  name: 'Otter',
  palette: { B: '#8A6A52', D: '#6E523F', O: '#E7D3BF', F: '#6E523F' },
  noFeet: false,
  marks: [
    [5, 1, 1, 1, 'B'],
    [10, 1, 1, 1, 'B'],
    [15, 6, 1, 1, '#2E2018'],
  ],
}

const PIGEON = { version: 1, base: 'bubble-16', id: 'pigeon', name: 'Pigeon', palette: {}, marks: [] }

const CAT = {
  version: 1,
  base: 'bubble-16',
  id: 'cat',
  name: 'Cat',
  palette: { B: '#F2B46E', D: '#D88F45', O: '#FAD9AE', F: '#D88F45' },
  marks: [
    [5, 0, 1, 2, 'B'],
    [6, 1, 1, 1, 'B'],
    [10, 0, 1, 2, 'B'],
    [9, 1, 1, 1, 'B'],
    [6, 3, 1, 1, '#D88F45'],
    [8, 3, 1, 2, '#D88F45'],
    [15, 6, 1, 1, '#E97C8B'],
  ],
}

const storedCharacterOf = async (memberId: string): Promise<unknown> =>
  (await storedRows(server, 'members')).find((row) => row.id === memberId)!.character_spec

const directoryCharacterOf = async (viewer: Session, memberId: string): Promise<unknown> =>
  (await viewer.api('GET', '/directory')).json.entries.find(
    (entry: { member: { id: string } }) => entry.member.id === memberId,
  ).member.character

describe('a member with no saved character', () => {
  it('is shown as the pigeon: null on the profile, in the directory and in the members list', async () => {
    expect((await ben.api('GET', '/me')).json.member.character).toBeNull()
    expect(await directoryCharacterOf(ana, ben.me.member.id)).toBeNull()
    const listed = (await ana.api('GET', '/admin/members')).json.members
    expect(listed.every((member: { character: unknown }) => member.character === null)).toBe(true)
  })
})

describe('saving a character', () => {
  it('saves a character that passes every rule and shows it to everyone', async () => {
    const saved = await ben.api('PUT', '/me/character', OTTER)
    expect(saved.status).toBe(200)
    expect(saved.json.character).toEqual(OTTER)
    expect((await ben.api('GET', '/me')).json.member.character).toEqual(OTTER)
    expect(await directoryCharacterOf(ana, ben.me.member.id)).toEqual(OTTER)
  })

  it('stores exactly the spec it validated, and nothing a client added around it', async () => {
    await ben.api('PUT', '/me/character', { ...OTTER, palette: { ...OTTER.palette, X: '#000000' }, extra: 1 })
    const stored = await storedCharacterOf(ben.me.member.id)
    expect(stored).toBe(JSON.stringify(OTTER))
    expect(characterProblems(JSON.parse(stored as string))).toEqual([])
  })

  it('saves a built-in character exactly as it ships, the pigeon included', async () => {
    expect((await ben.api('PUT', '/me/character', CAT)).json.character).toEqual(CAT)
    expect((await ben.api('PUT', '/me/character', PIGEON)).json.character).toEqual(PIGEON)
  })

  it('refuses a character that breaks a rule, listing every problem, and keeps the one saved before', async () => {
    await ben.api('PUT', '/me/character', OTTER)
    const refused = await ben.api('PUT', '/me/character', {
      ...OTTER,
      name: 'Claude',
      marks: [[12, 9, 1, 1, 'B']],
    })
    expect(refused.status).toBe(400)
    expect(refused.json.error).toEqual({
      code: 'Invalid',
      message:
        'This character cannot be used: name: may not contain Claude, Anthropic, Homingbird or Pip; marks may not go below the beak (x 11-15, y 8-11): characters have no mouths',
    })
    expect(await storedCharacterOf(ben.me.member.id)).toBe(JSON.stringify(OTTER))
  })

  it('refuses a made character that takes a built-in character’s id', async () => {
    const refused = await ben.api('PUT', '/me/character', { ...OTTER, id: 'cat' })
    expect(refused.status).toBe(400)
    expect(refused.json.error.message).toContain('"cat" belongs to a built-in character')
    expect(await storedCharacterOf(ben.me.member.id)).toBeNull()
  })

  it('refuses a copy of the pigeon, under its own id or another', async () => {
    const renamed = await ben.api('PUT', '/me/character', { ...PIGEON, id: 'my-pigeon', name: 'Pidge' })
    expect(renamed.json.error.message).toContain('Pip is the brand')
    const changed = await ben.api('PUT', '/me/character', { ...PIGEON, marks: [[6, 3, 1, 1, '#6D86B0']] })
    expect(changed.json.error.message).toContain('"pigeon" belongs to a built-in character')
    expect(await storedCharacterOf(ben.me.member.id)).toBeNull()
  })

  it('refuses a body that is not a character before looking at the rules', async () => {
    const refused = await ben.api('PUT', '/me/character', { ...OTTER, version: 2 })
    expect(refused.status).toBe(400)
    expect((await ben.api('PUT', '/me/character', 'otter')).status).toBe(400)
    expect(await storedCharacterOf(ben.me.member.id)).toBeNull()
  })

  it('refuses a body larger than a character can be, without reading it', async () => {
    const padded = { ...OTTER, padding: 'x'.repeat(CHARACTER_BYTES_MAX) }
    const refused = await ben.api('PUT', '/me/character', padded)
    expect(refused.status).toBe(400)
    expect(refused.json.error.message).toBe(`The request body is larger than ${CHARACTER_BYTES_MAX} bytes.`)
    expect(await storedCharacterOf(ben.me.member.id)).toBeNull()
  })

  it('shows a stored character that no longer decodes as the pigeon', async () => {
    await T.runPromise(
      run(raw(`UPDATE members SET character_spec = '{"version":0}' WHERE id = '${ben.me.member.id}'`)),
      server.env,
    )
    expect((await ben.api('GET', '/me')).json.member.character).toBeNull()
  })
})

describe('going back to the pigeon', () => {
  it('lets a person clear their own character', async () => {
    await ben.api('PUT', '/me/character', OTTER)
    const cleared = await ben.api('DELETE', '/me/character')
    expect(cleared.status).toBe(200)
    expect(cleared.json.character).toBeNull()
    expect(await storedCharacterOf(ben.me.member.id)).toBeNull()
  })

  it('lets an administrator reset any member’s character to the pigeon', async () => {
    await ben.api('PUT', '/me/character', OTTER)
    const reset = await ana.api('DELETE', `/admin/members/${ben.me.member.id}/character`)
    expect(reset.status).toBe(200)
    expect(reset.json).toMatchObject({ id: ben.me.member.id, character: null })
    expect((await ben.api('GET', '/me')).json.member.character).toBeNull()
  })

  it('refuses a reset from someone who is not an administrator, and for a member who does not exist', async () => {
    await ana.api('PUT', '/me/character', OTTER)
    expect((await ben.api('DELETE', `/admin/members/${ana.me.member.id}/character`)).status).toBe(403)
    expect(await storedCharacterOf(ana.me.member.id)).toBe(JSON.stringify(OTTER))
    expect((await ana.api('DELETE', '/admin/members/mem_nobody000000/character')).status).toBe(404)
    expect((await ana.api('DELETE', '/admin/members/not-an-id/character')).status).toBe(400)
  })
})

describe('agents and characters', () => {
  it('refuses an agent credential on all three character routes, changing nothing', async () => {
    await ben.api('PUT', '/me/character', OTTER)
    const before = await everyStoredValue(server)
    const attempts: ReadonlyArray<readonly [string, string, unknown?]> = [
      ['PUT', '/me/character', { ...OTTER, id: 'agent-otter' }],
      ['DELETE', '/me/character'],
      ['DELETE', `/admin/members/${ben.me.member.id}/character`],
    ]
    for (const [method, path, body] of attempts)
      expect([method, path, (await benAgent.api(method, path, body)).status]).toEqual([method, path, 403])
    const unchanged = (dump: string) =>
      dump
        .split('\n')
        .filter((line) => !line.startsWith('audit_log:'))
        .join('\n')
        .replace(/"last_used_at":(\d+|null)/g, '')
    expect(unchanged(await everyStoredValue(server))).toBe(unchanged(before))
  })
})

describe('the record of character changes', () => {
  it('audits setting, clearing and resetting a character, with who did it', async () => {
    await ben.api('PUT', '/me/character', OTTER)
    await ben.api('DELETE', '/me/character')
    await ana.api('DELETE', `/admin/members/${ben.me.member.id}/character`)
    const entries = (await ana.api('GET', '/admin/audit')).json.entries as ReadonlyArray<{
      action: string
      actorId: string
      target: string | null
      detail: { request?: unknown }
    }>
    const ofCharacters = entries.filter((entry) => entry.action.includes('haracter')).reverse()
    expect(ofCharacters.map((entry) => [entry.action, entry.actorId])).toEqual([
      ['me.character.set', ben.me.member.id],
      ['me.character.clear', ben.me.member.id],
      ['admin.members.resetCharacter', ana.me.member.id],
    ])
    expect(ofCharacters[0]!.detail.request).toEqual(OTTER)
    expect(ofCharacters[2]!.target).toBe(ben.me.member.id)
  })

  it('tells every connected client to redraw the directory when a character changes', async () => {
    const hangUp = new AbortController()
    const stream = await server.request('GET', '/api/v1/events/stream', {
      token: benAgent.token,
      signal: hangUp.signal,
    })
    const iterator = (stream.raw.body as AsyncIterable<string>)[Symbol.asyncIterator]()
    const next = async () => {
      const event = JSON.parse(((await iterator.next()).value as string).split('data: ')[1]!)
      return [event.body.type, event.body.memberId]
    }
    await ana.api('PUT', '/me/character', OTTER)
    expect(await next()).toEqual(['directory.changed', ana.me.member.id])
    await ana.api('DELETE', '/me/character')
    expect(await next()).toEqual(['directory.changed', ana.me.member.id])
    await ana.api('DELETE', `/admin/members/${ben.me.member.id}/character`)
    expect(await next()).toEqual(['directory.changed', ben.me.member.id])
    hangUp.abort()
  })
})
