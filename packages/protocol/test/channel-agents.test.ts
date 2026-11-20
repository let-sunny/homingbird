import type { Schema as S } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  AGENT_OPEN_DRAFTS_MAX,
  AgentListing,
  CHANNEL_AGENT_NAME_MAX,
  ChannelAgent,
  ChannelAgentName,
  NO_REVIEWER_MESSAGE,
  Review,
  possibleReviewers,
  reviewerStanding,
} from '../src/channel-agents.ts'
import { MemberId } from '../src/ids.ts'
import { refinements } from './contract-refinements.ts'

const ana = 'mem_ana000000000' as MemberId
const ben = 'mem_ben000000000' as MemberId
const cy = 'mem_cy0000000000' as MemberId
const roundTrips = <A>(schema: S.Schema<A>) =>
  fc.assert(
    fc.property(arbitrary(schema, refinements), (value) => {
      expect(schema.decode(JSON.parse(JSON.stringify(value)))._tag).toBe('Ok')
    }),
    { numRuns: 20 },
  )
const memberIds = fc.uniqueArray(arbitrary(MemberId), { maxLength: 8 })

describe('who may send a channel agent’s draft', () => {
  it('lets a current manager send an answer to someone else’s question', () => {
    expect(reviewerStanding({ reviewerId: ana, isPerson: true, managers: [ana, ben], askerId: cy })).toBe(
      'reviewer',
    )
  })

  it('refuses an agent credential, even of a manager', () => {
    expect(reviewerStanding({ reviewerId: ana, isPerson: false, managers: [ana], askerId: cy })).toBe(
      'not_a_person',
    )
  })

  it('refuses a person who does not manage the channel', () => {
    expect(reviewerStanding({ reviewerId: cy, isPerson: true, managers: [ana, ben], askerId: null })).toBe(
      'not_a_manager',
    )
  })

  it('refuses the manager who asked the question the draft answers', () => {
    expect(reviewerStanding({ reviewerId: ana, isPerson: true, managers: [ana, ben], askerId: ana })).toBe(
      'asked_it',
    )
  })

  it('makes a reviewer exactly a person among the managers who did not ask', () => {
    fc.assert(
      fc.property(
        arbitrary(MemberId),
        fc.boolean(),
        memberIds,
        fc.option(arbitrary(MemberId), { nil: null }),
        (reviewerId, isPerson, managers, askerId) => {
          const standing = reviewerStanding({ reviewerId, isPerson, managers, askerId })
          expect(standing === 'reviewer').toBe(
            isPerson && possibleReviewers(managers, askerId).includes(reviewerId),
          )
        },
      ),
    )
  })

  it('finds no possible reviewer when the asker is the only manager', () => {
    expect(possibleReviewers([ana], ana)).toEqual([])
    expect(possibleReviewers([ana, ben], ana)).toEqual([ben])
    expect(possibleReviewers([ana, ben], null)).toEqual([ana, ben])
    expect(NO_REVIEWER_MESSAGE).toMatch(/another manager/)
  })
})

describe('a channel agent on the wire', () => {
  it('takes a one-line printable name', () => {
    expect(ChannelAgentName.is('Payments wiki')).toBe(true)
    expect(ChannelAgentName.is(' ')).toBe(false)
    expect(ChannelAgentName.is('two\nlines')).toBe(false)
    expect(ChannelAgentName.is('x'.repeat(CHANNEL_AGENT_NAME_MAX + 1))).toBe(false)
  })

  it('round-trips generated agents, reviews and listings through JSON', () => {
    roundTrips(ChannelAgent)
    roundTrips(Review)
    roundTrips(AgentListing)
  })

  it('bounds how many drafts an agent keeps waiting', () => {
    expect(AGENT_OPEN_DRAFTS_MAX).toBe(50)
  })
})
