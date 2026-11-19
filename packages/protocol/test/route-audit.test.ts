import { describe, expect, it } from 'vitest'
import { AUDIT_EVENTS } from '../src/audit-events.ts'
import { type RouteName, contract } from '../src/contract.ts'
import { ROUTE_AUDIT } from '../src/route-audit.ts'

const names = Object.keys(contract) as RouteName[]

/** Every human or administrator route that changes something and keeps no row, with the reason reviewed. */
const REVIEWED_WITHOUT_AN_EVENT = [
  'analytics.track',
  'conversations.create',
  'draftRequests.cancel',
  'draftRequests.create',
  'drafts.seen',
  'notes.move',
  'notes.read',
  'presence.visibility',
  'principles.miss',
  'principles.offers.dismiss',
  'push.subscribe',
  'push.test',
  'push.unsubscribe',
]

describe('the audit decision of each route', () => {
  it('exists for every route in the contract, and for nothing else', () => {
    expect(Object.keys(ROUTE_AUDIT).sort()).toEqual([...names].sort())
  })

  it('keeps nothing for a read', () => {
    for (const name of names)
      if (contract[name].method === 'GET')
        expect([name, ROUTE_AUDIT[name]]).toEqual([name, { none: 'A read changes nothing.' }])
  })

  it('names an event, or a reviewed reason, for every human or administrator route that changes something', () => {
    const changing = names.filter(
      (name) =>
        contract[name].method !== 'GET' &&
        (contract[name].access === 'human' || contract[name].access === 'admin'),
    )
    expect(changing.filter((name) => 'none' in ROUTE_AUDIT[name]).sort()).toEqual(
      REVIEWED_WITHOUT_AN_EVENT.filter((name) => changing.includes(name as RouteName)),
    )
  })

  it('names catalogue events with the catalogue’s target, and gives every reason a sentence', () => {
    for (const name of names) {
      const decision = ROUTE_AUDIT[name]
      if ('event' in decision) expect(decision.target).toBe(AUDIT_EVENTS[decision.event].target)
      else expect(decision.none).toMatch(/^[A-Z].+\.$/)
    }
  })

  it('keeps activity out: reading, moving, picking up, drafting and debate turns record nothing', () => {
    for (const name of [
      'notes.read',
      'notes.move',
      'notes.pickup',
      'notes.release',
      'drafts.create',
      'drafts.update',
      'drafts.seen',
      'debates.turns.post',
      'debates.result.draft',
      'push.subscribe',
      'presence.visibility',
    ] as const)
      expect('none' in ROUTE_AUDIT[name]).toBe(true)
  })
})
