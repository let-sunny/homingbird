import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OFFICE_HOURS, allowAutoSend, directRoom } from './auto-send-support.ts'
import { type Session, type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let room: string

beforeEach(async () => {
  server = await startTestServer({ HB_CHANNELS: 'lobby' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  await allowAutoSend(ana, true)
  room = await directRoom(ana, ben)
})

afterEach(() => server?.close())

const save = async (item: Readonly<Record<string, unknown>> = OFFICE_HOURS) =>
  (await ana.api('POST', '/principles', item)).json

const setTo = (id: string, enabled: boolean, places: ReadonlyArray<string>) =>
  ana.api('PUT', `/principles/${id}/auto-send`, { enabled, places })

describe('switching a saved answer to send itself', () => {
  it('keeps the switch and each place once, and shows them with the answer', async () => {
    const saved = await save()
    const lobby = (await ana.api('PUT', '/channels/lobby/membership', {})).json.conversationId
    const switched = await setTo(saved.id, true, [room, lobby, room])
    expect(switched.json.autoSend).toEqual({ enabled: true, places: [room, lobby].sort() })
    expect((await ana.api('GET', '/principles')).json.principles[0].autoSend).toEqual(switched.json.autoSend)
    expect(await storedRows(server, 'principle_auto_send_places')).toHaveLength(2)
    const off = await setTo(saved.id, false, [])
    expect(off.json.autoSend).toEqual({ enabled: false, places: [] })
  })

  it('starts off for every new item, with nowhere to send', async () => {
    expect((await save()).autoSend).toEqual({ enabled: false, places: [] })
  })

  it('refuses a rule, an answer taken only from a source, and a switch with nowhere to send', async () => {
    const rule = await save({ topic: 'Releases', rule: 'check RELEASES.md and give the date', place: null })
    const sourced = await save({
      kind: 'answer',
      topic: 'Holidays',
      rule: '',
      source: 'https://wiki.example/holidays',
      place: null,
    })
    const answer = await save()
    expect((await setTo(rule.id, true, [room])).status).toBe(400)
    expect((await setTo(sourced.id, true, [room])).status).toBe(400)
    expect((await setTo(answer.id, true, [])).status).toBe(400)
    expect((await setTo(rule.id, false, [])).status).toBe(200)
  })

  it('refuses another person’s answer and a conversation the person is not in', async () => {
    const saved = await save()
    expect(
      (await ben.api('PUT', `/principles/${saved.id}/auto-send`, { enabled: true, places: [room] })).status,
    ).toBe(404)
    expect((await setTo(saved.id, true, ['conv_000000000000'])).status).toBe(400)
    expect(await storedRows(server, 'principle_auto_send_places')).toEqual([])
  })

  it('records who switched it, whether on, and how many places, never the answer or the places', async () => {
    const saved = await save()
    await setTo(saved.id, true, [room])
    const [entry] = (await storedRows(server, 'audit_events')).filter(
      (row) => row.event === 'principle.auto_send_changed',
    )
    expect(entry).toMatchObject({ actor_id: ana.me.member.id, target_id: saved.id, credential_kind: 'human' })
    expect(JSON.parse(String(entry!.detail))).toEqual({ enabled: true, places: 1 })
  })
})
