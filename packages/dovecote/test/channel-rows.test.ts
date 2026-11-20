import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type ChannelRow,
  existingChannel,
  requireManagerRemains,
  visibilityOf,
  visibleChannel,
} from '../src/domain/channel-rows.ts'
import { type Session, type TestServer, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let cy: Session

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
  await ben.api('POST', '/channels', { slug: 'payroll', description: 'Salaries', visibility: 'private' })
})

afterEach(() => server.close())

const running = <A>(task: T.Task<A, unknown, any>) => T.runPromise(T.result(task), server.env)

describe('channel rows', () => {
  it('reads a channel stored before visibility existed as open', () => {
    const row = { visibility: null } as unknown as ChannelRow
    expect(visibilityOf(row)).toBe('open')
  })

  it('resolves a private channel for its members and administrators, and as missing for everyone else', async () => {
    const as = (session: Session) => ({ id: session.me.member.id, role: session.me.member.role })
    expect((await running(visibleChannel(as(ben), 'payroll')))._tag).toBe('Ok')
    expect((await running(visibleChannel(as(ana), 'payroll')))._tag).toBe('Ok')
    expect(await running(visibleChannel(as(cy), 'payroll'))).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'NotFound', message: 'No such channel: payroll.' },
    })
  })

  it('lets the last manager go only when nobody else is left in the room', async () => {
    const row = (await running(existingChannel('payroll'))) as { value: ChannelRow }
    expect((await running(requireManagerRemains(row.value, { leaving: ben.me.member.id })))._tag).toBe('Ok')
    await ben.api('PUT', `/channels/payroll/members/${cy.me.member.id}`)
    expect(await running(requireManagerRemains(row.value, { leaving: ben.me.member.id }))).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'Conflict' },
    })
    expect((await running(requireManagerRemains(row.value, { leaving: cy.me.member.id })))._tag).toBe('Ok')
  })
})
