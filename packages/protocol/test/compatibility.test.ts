import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Schema as S } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { BUILT_IN_CHARACTERS } from '../src/character.ts'
import {
  PROTOCOL_VERSION,
  READABLE_PROTOCOLS,
  UNKNOWN,
  UPGRADE_SENTENCES,
  isFeatureOffered,
  isKnown,
  upgradeNeeded,
} from '../src/compatibility.ts'
import { type RouteName, contract } from '../src/contract.ts'
import { StreamEvent } from '../src/events.ts'
import { ConversationId } from '../src/ids.ts'
import { ChannelSlug } from '../src/model.ts'

/** A response this server could send for the route, the same one every run. */
const latest = (route: RouteName): unknown =>
  fc.sample(arbitrary(contract[route].response as S.Schema<unknown, unknown>), { numRuns: 1, seed: 7 })[0]

const PACKAGES = join(import.meta.dirname, '../..')
/** Where code that an agent or a person's terminal runs lives; bundles are left out, they hold the contract. */
const AGENT_SOURCES = ['cli/src', 'mcp/src', 'a2a/src', 'plugin/hooks'].map((path) => join(PACKAGES, path))
const sourcesIn = (directory: string): string[] =>
  readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(ts|tsx|mts|mjs)$/.test(name))
    .map((name) => join(directory, name))

describe('human routes', () => {
  it('are named by no command line, MCP, A2A or plugin source', () => {
    const human = (Object.keys(contract) as RouteName[]).filter((name) => contract[name].access === 'human')
    const named = AGENT_SOURCES.flatMap(sourcesIn).flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      return human
        .filter((route) => ["'", '"', '`'].some((quote) => text.includes(`${quote}${route}${quote}`)))
        .map((route) => `${relative(PACKAGES, file)}: ${route}`)
    })
    expect(human.length).toBeGreaterThan(0)
    expect(named).toEqual([])
  })
})

describe('reading a newer server', () => {
  it('reads a status it does not know as unknown, and every other field as sent', () => {
    const note = { ...(latest('notes.get') as object), status: 'archived' }
    expect(contract['notes.get'].response.read(note)).toMatchObject({
      _tag: 'Ok',
      value: { status: UNKNOWN },
    })
    expect(contract['notes.get'].response.decode(note)._tag).toBe('Err')
  })

  it('reads an event it does not know as unknown, so that one event never fails a poll', () => {
    const poll = latest('events.poll') as { events: object[]; cursor: number }
    const events = [...poll.events, { seq: 9, at: 1, body: { type: 'note.pinned', noteId: 'note_x' } }]
    const read = contract['events.poll'].response.read({ ...poll, events })
    expect(read._tag).toBe('Ok')
    expect((read as unknown as { value: { events: { body: unknown }[] } }).value.events.at(-1)!.body).toEqual(
      {
        type: UNKNOWN,
      },
    )
  })

  it('reads an achievement it does not know as unknown, and tells it apart', () => {
    const mine = { ...(latest('principles.list') as object), achievements: ['first_principle', 'first_vote'] }
    const read = contract['principles.list'].response.read(mine)
    expect(read).toMatchObject({ _tag: 'Ok', value: { achievements: ['first_principle', UNKNOWN] } })
    expect(['first_principle', UNKNOWN].filter(isKnown)).toEqual(['first_principle'])
  })
})

describe('response enums', () => {
  it('read every literal, and every set of variants, tolerantly', () => {
    const closed = [
      ...Object.entries(contract).flatMap(([name, route]) => closedEnums(route.response.ast, name, false)),
      ...closedEnums(StreamEvent.ast, 'event', false),
    ]
    expect([...new Set(closed)]).toEqual([])
  })

  it('find a closed enum or closed variants wherever they are', () => {
    const Closed = S.struct({
      kind: S.literal('a', 'b'),
      list: S.array(S.nullable(S.literal('x', 'y'))),
      map: S.record(S.variants('type', { one: {}, two: {} })),
      fine: S.tolerant(S.literal('a', 'b'), UNKNOWN),
      open: S.openVariants('type', { one: { inner: S.literal('p', 'q') } }, { type: UNKNOWN }),
      tag: S.literal('only'),
      named: S.refine<string>('short', (text) => text.length < 3)(S.literal('a', 'b')),
      whole: S.nullable(S.tolerant(S.struct({ version: S.literal(1) }), null)),
      known: S.openVariants('type', { one: { inner: S.literal('p') } }, { type: UNKNOWN }),
    })
    expect(closedEnums(Closed.ast, 'r', false)).toEqual([
      'r.kind',
      'r.list[]',
      'r.map{}',
      'r.open.inner',
      'r.tag',
      'r.named',
      'r.known.inner',
    ])
  })
})

describe('reading the events of a newer server', () => {
  it('reads an event of a kind it does not know as the unknown event', () => {
    expect(StreamEvent.read({ seq: 3, at: 1, body: { type: 'note.pinned', noteId: 'x' } })).toEqual({
      _tag: 'Ok',
      value: { seq: 3, at: 1, body: { type: UNKNOWN } },
    })
  })

  it('fails an event of a known kind that does not read, instead of skipping it', () => {
    expect(StreamEvent.read({ seq: 3, at: 1, body: { type: 'note.sent', note: { id: 7 } } })._tag).toBe('Err')
  })
})

describe('unknown values', () => {
  it('read a role, a status, a relation and a contact mode a newer server added as unknown', () => {
    const me = latest('me.get') as { member: object; contactMode: string }
    expect(
      contract['me.get'].response.read({
        ...me,
        member: { ...me.member, role: 'owner', status: 'suspended' },
        contactMode: 'invite_only',
      }),
    ).toMatchObject({
      _tag: 'Ok',
      value: { member: { role: UNKNOWN, status: UNKNOWN }, contactMode: UNKNOWN },
    })
    const listed = latest('directory.list') as { entries: { relation: string }[] }
    const entries = listed.entries.map((entry) => ({ ...entry, relation: 'muted' }))
    expect(contract['directory.list'].response.read({ ...listed, entries })).toMatchObject({
      _tag: 'Ok',
      value: { entries: entries.map(() => ({ relation: UNKNOWN })) },
    })
  })

  it('read a character of a shape a newer server added as no character, and a longer slug and id as sent', () => {
    const me = latest('me.get') as { member: object }
    const character = { ...BUILT_IN_CHARACTERS[0]!, version: 2, base: 'bubble-32' }
    expect(contract['me.get'].response.read({ ...me, member: { ...me.member, character } })).toMatchObject({
      _tag: 'Ok',
      value: { member: { character: null } },
    })
    expect(contract['me.get'].response.decode({ ...me, member: { ...me.member, character } })._tag).toBe(
      'Err',
    )
    const slug = `a${'b'.repeat(60)}`
    const id = `conv_${'0'.repeat(60)}`
    expect(ChannelSlug.read(slug)).toEqual({ _tag: 'Ok', value: slug })
    expect(ChannelSlug.decode(slug)._tag).toBe('Err')
    expect(ConversationId.read(id)).toEqual({ _tag: 'Ok', value: id })
    expect(ConversationId.decode(id)._tag).toBe('Err')
    expect(ConversationId.decode(`conv_${'0'.repeat(40)}`)._tag).toBe('Ok')
  })

  it('read a server name and a reason for a discarded draft a newer server added as unknown', () => {
    const info = latest('server.info') as object
    expect(contract['server.info'].response.read({ ...info, name: 'roost' })).toMatchObject({
      value: { name: UNKNOWN },
    })
    const body = { type: 'draft.discarded', noteId: 'note_000000000000', conversationId: 'conv_000000000000' }
    expect(StreamEvent.read({ seq: 1, at: 1, body: { ...body, because: 'expired' } })).toMatchObject({
      value: { body: { because: UNKNOWN } },
    })
  })

  it('read a debate result of a kind a newer server added as unknown, and its ask as unknown', () => {
    const waiting = fc.sample(
      arbitrary(contract['debates.waiting'].response).filter(
        (each) => each.asks.length > 0 && each.asks.every((ask) => ask.debate.result !== null),
      ),
      { numRuns: 1, seed: 7 },
    )[0]!
    const asks = waiting.asks.map((ask) => ({
      ask: 'vote',
      debate: { ...ask.debate, result: { ...ask.debate.result, result: { kind: 'poll', options: [] } } },
    }))
    expect(contract['debates.waiting'].response.read({ asks })).toMatchObject({
      _tag: 'Ok',
      value: { asks: asks.map(() => ({ ask: UNKNOWN, debate: { result: { result: { kind: UNKNOWN } } } })) },
    })
  })
})

describe('the protocol version', () => {
  it('is read as 1 from a server that sends none', () => {
    const info = { name: 'dovecote', version: '0.1.0', contactMode: 'open', signInWith: 'Google' }
    expect(contract['server.info'].response.read(info)).toMatchObject({
      _tag: 'Ok',
      value: { protocolVersion: 1 },
    })
  })

  it('names the side to upgrade when a server is outside what this client reads', () => {
    expect(READABLE_PROTOCOLS).toEqual({ oldest: 1, newest: PROTOCOL_VERSION })
    expect(upgradeNeeded({ protocolVersion: PROTOCOL_VERSION })).toBeNull()
    expect(upgradeNeeded({ protocolVersion: PROTOCOL_VERSION + 1 })).toBe('client')
    expect(upgradeNeeded({ protocolVersion: 0 })).toBe('server')
    expect(UPGRADE_SENTENCES.client).toMatch(/^[^.;]+; upgrade the client\.$/)
    expect(UPGRADE_SENTENCES.server).toMatch(/^[^.;]+; upgrade the server\.$/)
  })
})

describe('feature detection', () => {
  it('offers a feature only when the server lists it as on', () => {
    expect(isFeatureOffered({ features: { debateRooms: true } }, 'debateRooms')).toBe(true)
    expect(isFeatureOffered({ features: { debateRooms: false } }, 'debateRooms')).toBe(false)
    expect(isFeatureOffered({ features: { teaching: true } }, 'debateRooms')).toBe(false)
    expect(isFeatureOffered({ features: { toString: true } }, 'channels')).toBe(false)
    expect(isFeatureOffered({}, 'channels')).toBe(false)
  })
})

/**
 * Paths of literals, and of variants, that a newer server's value would fail: a literal or a set of variants
 * is closed unless a `tolerant` above it answers a fallback. A variant's own tag and `null` are not values a
 * server adds to, and a known variant that does not read fails even under `openVariants`.
 */
function closedEnums(ast: S.Ast, path: string, isTolerant: boolean): string[] {
  switch (ast.type) {
    case 'literal':
      return isTolerant || ast.values.every((value) => value === null) ? [] : [path]
    case 'struct':
      return Object.entries(ast.fields).flatMap(([key, field]) =>
        closedEnums(field.ast, `${path}.${key}`, isTolerant),
      )
    case 'array':
      return closedEnums(ast.items, `${path}[]`, isTolerant)
    case 'record':
      return closedEnums(ast.values, `${path}{}`, isTolerant)
    case 'union': {
      const tag = variantTagOf(ast.members)
      if (tag === null) return ast.members.flatMap((member) => closedEnums(member, path, isTolerant))
      return [
        ...(isTolerant ? [] : [path]),
        ...ast.members.flatMap((member) =>
          member.type === 'struct'
            ? Object.entries(member.fields)
                .filter(([key]) => key !== tag)
                .flatMap(([key, field]) => closedEnums(field.ast, `${path}.${key}`, false))
            : [],
        ),
      ]
    }
    case 'refined':
      return closedEnums(ast.inner, path, isTolerant)
    case 'tolerant':
      return closedEnums(ast.inner, path, true)
    default:
      return []
  }
}

/** The field every member of a set of variants names itself by, or null for a union that is not one. */
function variantTagOf(members: ReadonlyArray<S.Ast>): string | null {
  if (members.length === 0 || !members.every((member) => member.type === 'struct')) return null
  const [first, ...rest] = members as ReadonlyArray<Extract<S.Ast, { type: 'struct' }>>
  const isTag = (ast: S.Ast | undefined) => ast?.type === 'literal' && ast.values.length === 1
  return (
    Object.keys(first!.fields).find(
      (key) => isTag(first!.fields[key]!.ast) && rest.every((member) => isTag(member.fields[key]?.ast)),
    ) ?? null
  )
}
