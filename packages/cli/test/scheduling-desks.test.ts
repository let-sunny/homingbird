import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Session, type TestServer, startTestServer } from '../../dovecote/test/harness.ts'
import type { AgentRun } from '../src/environment.ts'
import { SERVER_URL, fetchThrough } from './server-fetch.ts'
import { INTERRUPTED, type World, world } from './support.ts'

let server: TestServer
let ana: Session
let ben: Session

beforeEach(async () => {
  server = await startTestServer({ HB_FEATURES: 'schedulingRooms=on' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
})

afterEach(() => server.close())

const HOUR = 60 * 60_000

const settle = async (condition: () => Promise<boolean> | boolean): Promise<void> => {
  for (let turn = 0; turn < 600 && !(await condition()); turn++)
    await new Promise((resolve) => setTimeout(resolve, 5))
  if (!(await condition())) throw new Error('the awaited condition never came true')
}

/**
 * A person's agent with a calendar tool, as a fake: free throughout the window it is asked about, and it
 * sends or accepts the invitation it is asked to. It records what it was asked.
 */
const calendarAgent =
  (asked: string[]) =>
  (prompt: string): AgentRun => {
    if (prompt.includes('"cannotReadCalendar"')) {
      asked.push('slots')
      const [, startsAt, endsAt] = /\((\S+Z) to (\S+Z)\)/.exec(prompt)!
      return { exitCode: 0, output: JSON.stringify({ free: [{ startsAt, endsAt }] }) }
    }
    if (prompt.includes('Send ONE invitation')) {
      asked.push('send_invite')
      return {
        exitCode: 0,
        output:
          '{"outcome":"sent","inviteUid":"evt-1@calendar.test","meetingUrl":"https://meet.example.com/x"}',
      }
    }
    if (prompt.includes('and accept it')) {
      asked.push('accept_invite')
      return { exitCode: 0, output: '{"outcome":"accepted"}' }
    }
    asked.push('other')
    return { exitCode: 0, output: 'SKIP: nothing for me.' }
  }

const deskFor = async (
  owner: Session,
  asked: string[],
): Promise<{ cli: World; running: Promise<number> }> => {
  const cli = world({
    signedIn: 'none',
    fetch: fetchThrough(server),
    clock: server.clock,
    agent: calendarAgent(asked),
  })
  const login = cli.run('login', '--server', SERVER_URL, '--name', 'Laptop', '--json')
  await settle(() => cli.lines.length > 0)
  const { userCode } = JSON.parse(cli.lines[0]!)
  await owner.api('POST', `/device/${userCode}`, { approve: true, name: 'Laptop' })
  await server.clock.advance(5_000)
  expect(await login).toBe(0)
  return { cli, running: cli.run('run', '--agent', 'claude -p') }
}

describe('a scheduling room with every person’s desk running', () => {
  it('needs nothing of anyone but its opening: free times, the time, the invitation and each calendar follow', async () => {
    const anaAsked: string[] = []
    const benAsked: string[] = []
    const anaDesk = await deskFor(ana, anaAsked)
    const benDesk = await deskFor(ben, benAsked)
    await settle(async () => {
      const entries = (await ana.api('GET', '/directory')).json.entries as Array<{
        member: { id: string }
        presence: { agentOnline: boolean }
      }>
      return entries.filter((entry) => entry.presence.agentOnline).length === 2
    })
    const startsAt = Math.ceil((server.clock.now() + 24 * HOUR) / (15 * 60_000)) * 15 * 60_000
    const opened = await ana.api('POST', '/scheduling-rooms', {
      title: 'Plan the launch',
      minutes: 60,
      window: { startsAt, endsAt: startsAt + 7 * 24 * HOUR },
      attendees: [{ memberId: ben.me.member.id, required: true }],
    })
    expect(opened.status).toBe(200)
    const id: string = opened.json.id
    expect(opened.json.deadlineAt - opened.json.createdAt).toBe(24 * HOUR)

    const partsOf = async () =>
      Object.fromEntries(
        (
          (await ana.api('GET', `/debates/${id}`)).json.schedule.attendees as Array<{
            memberId: string
            attendance?: string
          }>
        ).map((attendee) => [attendee.memberId, attendee.attendance]),
      )
    await settle(async () => {
      const parts = await partsOf()
      return parts[ana.me.member.id] === 'added' && parts[ben.me.member.id] === 'added'
    })

    const room = (await ben.api('GET', `/debates/${id}`)).json
    expect(room).toMatchObject({
      status: 'closed',
      result: { result: { kind: 'slot', startsAt, endsAt: startsAt + HOUR } },
      schedule: { invite: { uid: 'evt-1@calendar.test', meetingUrl: 'https://meet.example.com/x' } },
    })
    expect(anaAsked).toEqual(['slots', 'send_invite'])
    expect(benAsked).toEqual(['slots', 'accept_invite'])

    for (const desk of [anaDesk, benDesk]) {
      desk.cli.stop.abort()
      expect(await desk.running).toBe(INTERRUPTED)
      expect(desk.cli.problems).toEqual([])
    }
  })
})
