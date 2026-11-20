import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { debateView } from '../../src/views/debate-room.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, CY, channel, credential, debate, entry, me } from '../support/fixtures.ts'

usingFakeDom()

const participant = (memberId: typeof ANA, takingPart = true) => ({
  memberId,
  agentId: null,
  agentName: 'Desk',
  joinedAt: 1,
  takingPart,
})

const conclusion = {
  kind: 'conclusion' as const,
  conclusion: 'Ship.',
  reasons: ['Tests pass.'],
  nextSteps: [{ step: 'Tag it', owner: BEN, proposedBy: ANA }],
  contributions: [{ memberId: BEN, summary: 'Checked.', credits: ['gap_filled' as const] }],
}

describe('debateView', () => {
  it('loads the room, and says when the person may not see it', () => {
    const { context, called } = testContext()
    const shown = debateView(context, lifetime(), me(), 'debate_1')
    expect(called('loadDebate')[0]!.args).toEqual(['debate_1'])
    expect(textOf(shown)).toContain(strings.loading)
    context.state.shownDebate.set('missing')
    expect(getByRole(shown, 'link', { name: strings.debates.allRooms }).getAttribute('href')).toBe(
      '#/debates',
    )
  })

  it('lets its opener change the limits before the first turn, and opts an agent in', () => {
    const { context, called } = testContext()
    const other = debateView(context, lifetime(), me(), 'debate_2')
    context.state.shownDebate.set(debate({ createdBy: BEN }))
    expect(textOf(other)).toContain(strings.debates.noAgent)
    const shown = debateView(context, lifetime(), me(), 'debate_1')
    context.state.agentCredentials.set([credential('cred_desk')])
    context.state.shownDebate.set(debate({ visibility: 'private' }))
    expect(textOf(shown)).toContain(strings.debates.privateSeenBy)
    fire.submit(shown.querySelector('form.debate-limits-form')!)
    expect(called('changeLimits')[0]!.args[0]).toBe('debate_000000000000')
    fire.type(shown.querySelector('form.debate-limits-form input[name="turnsPerAgent"]')!, '20')
    fire.type(shown.querySelector('form.debate-limits-form input[name="totalTurns"]')!, '2')
    fire.submit(shown.querySelector('form.debate-limits-form')!)
    expect(context.state.notice.get()?.kind).toBe('error')
    fire.submit(shown.querySelector('form.debate-opt-in-form')!)
    expect(called('optInAgent')[0]!.args).toEqual(['debate_000000000000', 'cred_desk'])
    fire.select(getByRole(shown, 'combobox', { name: strings.debates.chooseAgent }), 'nobody')
    fire.submit(shown.querySelector('form.debate-opt-in-form')!)
    expect(called('optInAgent')).toHaveLength(1)
  })

  it('shows the agents, their turns, and who dropped out', () => {
    const { context } = testContext()
    const shown = debateView(context, lifetime(), me(), 'debate_1')
    context.state.shownDebate.set(
      debate({
        createdBy: BEN,
        participants: [participant(ANA), participant(BEN, false)],
        turns: [{ position: 1, memberId: BEN, agentName: 'Desk', body: 'See https://example.com', at: 3 }],
      }),
    )
    expect(textOf(shown)).toContain(strings.debates.droppedOut)
    expect(getByRole(shown, 'link', { name: 'https://example.com' })).toBeTruthy()
    context.state.shownDebate.set(debate({ status: 'ended', endedBecause: 'no_turns' }))
    expect(textOf(shown)).toContain(strings.debates.ended.no_turns)
    expect(textOf(shown)).toContain(strings.debates.noParticipants)
  })

  it('waits for the result while the agents vote', () => {
    const { context } = testContext()
    const shown = debateView(context, lifetime(), me(), 'debate_1')
    context.state.shownDebate.set(debate({ status: 'concluding', draftsCloseAt: 3, votingClosesAt: 4 }))
    expect(textOf(shown)).toContain(strings.debates.waitingForResult)
    expect(shown.querySelector('.debate-collecting')).not.toBeNull()
    expect(shown.querySelector('.debate-voting')).not.toBeNull()
  })

  it('shows a closed room’s result and drafts, exports it, and posts it to a channel or a person', () => {
    const { context, called, page } = testContext()
    context.state.session.set(me())
    context.state.channels.set([channel('billing', { joined: true })])
    context.state.directory.set([entry(BEN, 'Ben'), entry(CY, 'Cy')])
    const shown = debateView(context, lifetime(), me(), 'debate_1')
    context.state.shownDebate.set(
      debate({
        status: 'closed',
        participants: [participant(ANA), participant(BEN)],
        turns: [{ position: 1, memberId: ANA, agentName: 'Desk', body: 'Yes.', at: 3 }],
        result: { result: conclusion, draftedBy: BEN, draftedAt: 4 },
        drafts: [
          { draftedBy: BEN, draftedAt: 4, result: conclusion, votes: 1 },
          {
            draftedBy: ANA,
            draftedAt: 5,
            result: {
              kind: 'no_conclusion',
              summary: 'Split.',
              points: [{ point: 'Risk', category: 'goals', explanation: 'Why' }],
              nextSteps: [],
              contributions: [],
            } as never,
            votes: 0,
          },
          { draftedBy: CY, draftedAt: 6, result: { kind: 'unknown' } as never, votes: null },
        ],
        voteRecord: { votes: [{ voterId: ANA, draftBy: BEN }], droppedOut: [] },
      }),
    )
    expect(textOf(shown)).toContain('Ship.')
    expect(textOf(shown)).toContain(strings.debates.chosen)
    expect(textOf(shown)).toContain(strings.debates.unknownResult)
    expect(textOf(shown)).toContain(strings.debates.noNextSteps)
    expect(textOf(shown)).toContain(strings.debates.votedFor({ voter: 'Ana', author: 'Ben' }))
    getByRole(shown, 'button', { name: strings.debates.exportMarkdown }).click()
    const [exported] = called('exportDebate')
    expect(exported!.args).toEqual(['debate_000000000000', 'markdown', 'en'])
    exported!.then!.done!({ filename: 'debate.md', mediaType: 'text/markdown', text: '#' })
    expect(page.downloads).toEqual([{ filename: 'debate.md', mediaType: 'text/markdown', text: '#' }])
    const form = shown.querySelector('form.debate-post-form')!
    fire.submit(form)
    expect(called('postResult')).toHaveLength(0)
    fire.select(getByRole(shown, 'combobox', { name: strings.debates.postToPerson }), BEN)
    fire.submit(form)
    expect(called('postResult')[0]!.args).toEqual(['debate_000000000000', { to: BEN }])
    called('postResult')[0]!.then!.done!({ conversationId: 'conv_x' })
    expect(page.visited).toEqual(['go #/c/conv_x'])
  })

  it('opens the details of who wrote a turn or a draft, with the model its agent stated', () => {
    const { context } = testContext()
    context.state.directory.set([entry(BEN, 'Ben')])
    const shown = debateView(context, lifetime(), me(), 'debate_1')
    context.state.shownDebate.set(
      debate({
        status: 'closed',
        participants: [participant(ANA), participant(BEN)],
        turns: [{ position: 1, memberId: BEN, agentName: 'Desk', body: 'Yes.', at: 3, agentModel: 'gpt-6' }],
        result: { result: conclusion, draftedBy: BEN, draftedAt: 4 },
        drafts: [{ draftedBy: BEN, draftedAt: 4, result: conclusion, votes: 1 }],
        voteRecord: {
          votes: [{ voterId: ANA, draftBy: BEN, agentModel: 'claude-opus-5-5' }],
          droppedOut: [],
        },
      }),
    )
    const line = strings.authorship.agent({ name: 'Ben' })
    const buttons = shown.querySelectorAll(
      '.debate-turn-head .author-button, .debate-draft-author .author-button',
    )
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.getAttribute('aria-label')).toBe(strings.debates.authorWho({ authorship: line }))
    const turnDetails = shown.querySelector('.debate-turn-head .author-details')!
    expect(textOf(turnDetails)).toContain(strings.authorship.model({ model: 'gpt-6' }))
    expect(textOf(turnDetails)).toContain(strings.authorship.connection({ name: 'Desk' }))
    expect(textOf(shown.querySelector('.debate-draft-author')!)).toContain(strings.authorship.modelNotStated)
    expect(textOf(shown.querySelector('.debate-vote-record')!)).toContain(
      strings.authorship.model({ model: 'claude-opus-5-5' }),
    )
    context.state.shownDebate.set(debate({ status: 'ended', endedBecause: 'no_turns' }))
    expect(shown.querySelector('.author-button')).toBeNull()
  })

  it('shows a vote record without votes', () => {
    const { context } = testContext()
    const shown = debateView(context, lifetime(), me(), 'debate_1')
    context.state.shownDebate.set(
      debate({
        status: 'closed',
        createdBy: BEN,
        result: { result: conclusion, draftedBy: BEN, draftedAt: 4 },
        voteRecord: { votes: [], droppedOut: [] },
      }),
    )
    expect(textOf(shown)).toContain(strings.debates.noVote)
    expect(shown.querySelector('form.debate-post-form')).toBeNull()
  })
})
