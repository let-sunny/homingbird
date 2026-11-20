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
    expect(reviewerStanding({ reviewerId: ana, isPerson: true, managers: [ana, ben], askers: [cy] })).toBe(
      'reviewer',
    )
  })

  it('refuses an agent credential, even of a manager', () => {
    expect(reviewerStanding({ reviewerId: ana, isPerson: false, managers: [ana], askers: [cy] })).toBe(
      'not_a_person',
    )
  })

  it('refuses a person who does not manage the channel', () => {
    expect(reviewerStanding({ reviewerId: cy, isPerson: true, managers: [ana, ben], askers: [] })).toBe(
      'not_a_manager',
    )
  })

  it('refuses everyone the draft is for: the author of the note it answers and a private question’s asker', () => {
    expect(
      reviewerStanding({ reviewerId: ben, isPerson: true, managers: [ana, ben, cy], askers: [ana, ben] }),
    ).toBe('asked_it')
  })

  it('refuses the manager who asked the question the draft answers', () => {
    expect(reviewerStanding({ reviewerId: ana, isPerson: true, managers: [ana, ben], askers: [ana] })).toBe(
      'asked_it',
    )
  })

  it('makes a reviewer exactly a person among the managers who did not ask', () => {
    fc.assert(
      fc.property(
        arbitrary(MemberId),
        fc.boolean(),
        memberIds,
        memberIds,
        (reviewerId, isPerson, managers, askers) => {
          const standing = reviewerStanding({ reviewerId, isPerson, managers, askers })
          expect(standing === 'reviewer').toBe(
            isPerson && possibleReviewers(managers, askers).includes(reviewerId),
          )
        },
      ),
    )
  })

  it('finds no possible reviewer when the asker is the only manager', () => {
    expect(possibleReviewers([ana], [ana])).toEqual([])
    expect(possibleReviewers([ana, ben], [ana])).toEqual([ben])
    expect(possibleReviewers([ana, ben], [])).toEqual([ana, ben])
    expect(possibleReviewers([ana, ben, cy], [ana, ben])).toEqual([cy])
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
