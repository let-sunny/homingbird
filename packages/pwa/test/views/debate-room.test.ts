import { lifetime } from '@homingbird/ui'
import { allByRole, fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { debateView } from '../../src/views/debate-room.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
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
    const shown = debateView(context, lifetime(), me(), 'debate_1', null)
    expect(called('loadDebate')[0]!.args).toEqual(['debate_1'])
    expect(textOf(shown)).toContain(strings.loading)
    context.state.shownDebate.set('missing')
    expect(getByRole(shown, 'link', { name: strings.debates.allRooms }).getAttribute('href')).toBe(
      '#/debates',
    )
  })

  it('lets its opener change the limits before the first turn, and opts an agent in', () => {
    const { context, called } = testContext()
    const other = debateView(context, lifetime(), me(), 'debate_2', null)
    context.state.shownDebate.set(debate({ createdBy: BEN }))
    expect(textOf(other)).toContain(strings.debates.noAgent)
    const shown = debateView(context, lifetime(), me(), 'debate_1', null)
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

  it('leads the opt-in with what the person decides and keeps the advice for whoever runs the agent folded', () => {
    const { context } = testContext()
    const shown = debateView(context, lifetime(), me(), 'debate_1', null)
    context.state.agentCredentials.set([credential('cred_desk')])
    context.state.shownDebate.set(debate())
    const section = shown.querySelector('.debate-opt-in')!
    expect(section.querySelector('.hint')?.textContent).toBe(strings.debates.optInHint)
    expect(strings.debates.optInHint).not.toContain('--split')
    const advice = section.querySelector('details.debate-opt-in-advice')!
    expect(advice.hasAttribute('open')).toBe(false)
    expect(textOf(advice.querySelector('summary')!)).toBe(strings.debates.optInAdviceTitle)
    expect(textOf(advice)).toContain('--split')
  })

  it('shows the agents, their turns, and who dropped out', () => {
    const { context } = testContext()
    const shown = debateView(context, lifetime(), me(), 'debate_1', null)
    context.state.shownDebate.set(
      debate({
        createdBy: BEN,
        participants: [participant(ANA), participant(BEN, false)],
        turns: [{ position: 1, memberId: BEN, agentName: 'Desk', body: 'See https://example.com', at: 3 }],
      }),
    )
    expect(textOf(shown)).toContain(strings.debates.droppedOut)
    expect(getByRole(shown, 'link', { name: 'https://example.com' })).toBeTruthy()
    const count = getByRole(shown, 'button', { name: strings.groupPeople({ count: 2 }) })
    const list = shown.querySelector<HTMLElement>('.people-list')!
    expect(count.getAttribute('popovertarget')).toBe(list.id)
    expect(textOf(list)).toContain(strings.participants.openedRoom)
    context.state.shownDebate.set(debate({ status: 'ended', endedBecause: 'no_turns' }))
    expect(shown.querySelector('.people-open')).toBeNull()
    expect(textOf(shown)).toContain(strings.debates.ended.no_turns)
    expect(textOf(shown)).not.toContain(strings.debates.noParticipants)
    const content = debateView(context, lifetime(), me(), 'debate_000000000000', 'turns')
    expect(textOf(content)).toContain(strings.debates.noParticipants)
    expect(textOf(content)).not.toContain(strings.debates.ended.no_turns)
  })

  it('waits for the result while the agents vote', () => {
    const { context } = testContext()
    const shown = debateView(context, lifetime(), me(), 'debate_1', null)
    context.state.shownDebate.set(debate({ status: 'concluding', draftsCloseAt: 3 }))
    expect(textOf(shown)).toContain(strings.debates.waitingForResult)
    expect(shown.querySelector('.debate-collecting')).not.toBeNull()
    expect(shown.querySelector('.debate-voting')).toBeNull()
    context.state.shownDebate.set(debate({ status: 'concluding', votingClosesAt: 4 }))
    expect(textOf(shown)).toContain(strings.debates.waitingForVotes)
    expect(textOf(shown)).not.toContain(strings.debates.waitingForResult)
    expect(shown.querySelector('.debate-collecting')).toBeNull()
    expect(shown.querySelector('.debate-voting')).not.toBeNull()
  })

  it('shows a closed room’s result and drafts, exports it, and posts it to a channel or a person', () => {
    const { context, called, page } = testContext()
    context.state.session.set(me())
    context.state.channels.set([channel('billing', { joined: true })])
    context.state.directory.set([entry(BEN, 'Ben'), entry(CY, 'Cy')])
    const shown = debateView(context, lifetime(), me(), 'debate_1', null)
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
    expect(textOf(shown)).not.toContain(strings.debates.mine.votedFor({ author: 'Ben' }))
    const votes = debateView(context, lifetime(), me(), 'debate_000000000000', 'votes')
    expect(textOf(votes)).toContain(strings.debates.mine.votedFor({ author: 'Ben' }))
    expect(votes.querySelector('.debate-send')).toBeNull()
    const credit = debateView(context, lifetime(), me(), 'debate_000000000000', 'credit')
    expect(textOf(credit.querySelector(`.debate-credit-list li[data-member="${BEN}"]`)!)).toContain(
      'Checked.',
    )
    expect(credit.querySelector('.debate-credit')!.getAttribute('title')).toBe(
      strings.debates.creditHint.gap_filled,
    )
    expect(textOf(credit.querySelector(`.debate-credit-list li[data-member="${ANA}"]`)!)).toContain('Tag it')
    expect(credit.querySelector('.debate-vote-record')).toBeNull()
    expect(shown.querySelector('.debate-credit')!.getAttribute('title')).toBe(
      strings.debates.creditHint.gap_filled,
    )
    expect(
      [...shown.querySelectorAll('.debate-send h2, .debate-export h2')].map((heading) => heading.textContent),
    ).toEqual([strings.debates.sendTitle, strings.debates.exportTitle])
    expect(shown.querySelector('.debate-export form.debate-post-form')).toBeNull()
    getByRole(shown, 'button', { name: strings.debates.exportMarkdown }).click()
    const [exported] = called('exportDebate')
    expect(exported!.args).toEqual(['debate_000000000000', 'markdown', 'en'])
    exported!.then!.done!({ filename: 'debate.md', mediaType: 'text/markdown', text: '#' })
    expect(page.downloads).toEqual([{ filename: 'debate.md', mediaType: 'text/markdown', text: '#' }])
    const form = shown.querySelector('form.debate-post-form')!
    fire.submit(form)
    expect(called('postResult')).toHaveLength(0)
    expect(textOf(form.querySelector('[role="alert"]')!)).toBe(strings.debates.chooseDestination)
    fire.select(getByRole(shown, 'combobox', { name: strings.debates.postToPerson }), BEN)
    fire.submit(form)
    expect(called('postResult')[0]!.args).toEqual(['debate_000000000000', { to: BEN }])
    called('postResult')[0]!.then!.done!({ conversationId: 'conv_x' })
    expect(page.visited).toEqual(['go #/c/conv_x'])
  })

  it('opens the details of who wrote a turn or a draft, with the model its agent stated', () => {
    const { context } = testContext()
    context.state.directory.set([entry(BEN, 'Ben')])
    const shown = debateView(context, lifetime(), me(), 'debate_1', null)
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
    const content = debateView(context, lifetime(), me(), 'debate_000000000000', 'turns')
    const stats = debateView(context, lifetime(), me(), 'debate_000000000000', 'votes')
    const buttons = [content, shown].map((tab) =>
      tab.querySelector('.debate-turn-head .author-button, .debate-draft-author .author-button'),
    )
    expect(buttons[0]!.getAttribute('aria-label')).toBe(strings.debates.authorWho({ authorship: line }))
    expect(buttons[1]).not.toBeNull()
    const turnDetails = content.querySelector('.debate-turn-head .author-details')!
    expect(textOf(turnDetails)).toContain(strings.authorship.model({ model: 'gpt-6' }))
    expect(textOf(turnDetails)).toContain(strings.authorship.connection({ name: 'Desk' }))
    expect(textOf(shown.querySelector('.debate-draft-author')!)).toContain(strings.authorship.modelNotStated)
    expect(textOf(stats.querySelector('.debate-vote-record')!)).toContain(
      strings.authorship.model({ model: 'claude-opus-5-5' }),
    )
    context.state.shownDebate.set(debate({ status: 'ended', endedBecause: 'no_turns' }))
    expect(shown.querySelector('.author-button')).toBeNull()
  })

  it('shows a vote record without votes', () => {
    const { context } = testContext()
    const shown = debateView(context, lifetime(), me(), 'debate_1', null)
    context.state.shownDebate.set(
      debate({
        status: 'closed',
        createdBy: BEN,
        result: { result: conclusion, draftedBy: BEN, draftedAt: 4 },
        voteRecord: { votes: [], droppedOut: [] },
      }),
    )
    expect(textOf(debateView(context, lifetime(), me(), 'debate_000000000000', 'votes'))).toContain(
      strings.debates.noVote,
    )
    expect(shown.querySelector('form.debate-post-form')).toBeNull()
    expect(shown.querySelector('.debate-send')).toBeNull()
    expect(shown.querySelector('.debate-export .export-markdown')).not.toBeNull()
  })

  it('opens an open room on its turns alone and a later one on its result, each tab its own address', () => {
    const { context, page } = testContext()
    context.state.agentCredentials.set([credential('cred_desk')])
    const shown = mount(debateView(context, lifetime(), me(), 'debate_1', null))
    context.state.shownDebate.set(debate({ createdBy: BEN }))
    expect(shown.querySelector('.debate-tabs')).toBeNull()
    expect(
      shown.querySelector('.debate-tab.is-turns > .debate-section')?.classList.contains('debate-opt-in'),
    ).toBe(true)
    page.runFrames()
    expect(document.activeElement).toBe(document.body)
    context.state.shownDebate.set(
      debate({
        status: 'closed',
        createdBy: BEN,
        result: { result: conclusion, draftedBy: BEN, draftedAt: 4 },
        voteRecord: { votes: [], droppedOut: [] },
      }),
    )
    const tabs = getByRole(shown, 'navigation', { name: strings.debates.tabsLabel })
    expect(allByRole(tabs, 'link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      [strings.debates.tabs.result, '#/debate/debate_000000000000/result'],
      [strings.debates.tabs.votes, '#/debate/debate_000000000000/votes'],
      [strings.debates.tabs.credit, '#/debate/debate_000000000000/credit'],
      [strings.debates.tabs.turns, '#/debate/debate_000000000000/turns'],
    ])
    expect(getByRole(tabs, 'link', { name: strings.debates.tabs.result }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(shown.querySelector('.debate-turns')).toBeNull()
    expect(shown.querySelector('.debate-export')).not.toBeNull()
  })

  it('keeps the room drawn when another tab is chosen, and focuses that tab once', () => {
    const { context, page, called } = testContext()
    context.state.shownDebate.set(debate({ status: 'ended', createdBy: BEN }))
    const shown = mount(debateView(context, lifetime(), me(), 'debate_000000000000', 'turns'))
    expect(called('loadDebate')[0]!.args).toEqual(['debate_000000000000'])
    expect(shown.querySelector('.debate-turns')).not.toBeNull()
    page.runFrames()
    const current = getByRole(shown, 'link', { name: strings.debates.tabs.turns })
    expect(document.activeElement).toBe(current)
    current.blur()
    context.state.shownDebate.set(debate({ status: 'ended', createdBy: BEN, turns: [] }))
    page.runFrames()
    expect(document.activeElement).toBe(document.body)
    debateView(context, lifetime(), me(), 'debate_other', null)
    expect(context.state.shownDebate.get()).toBeNull()
  })

  it('numbers every turn, folds a run of turns that add nothing, links cited turns and brings a named turn into view', () => {
    const { context, page } = testContext()
    const bodies = [
      'Ship Thursday.',
      'Friday is safer.',
      'Turn 2 moved me: I now agree with Friday.',
      'Nothing new; ready to vote.',
      'Nothing new from me either; ready to vote.',
    ]
    context.state.shownDebate.set(
      debate({
        createdBy: BEN,
        participants: [participant(ANA), participant(BEN)],
        turns: bodies.map((body, index) => ({
          position: index + 1,
          memberId: index % 2 === 0 ? BEN : ANA,
          agentName: 'Desk',
          body,
          at: index + 3,
        })),
      }),
    )
    const shown = mount(debateView(context, lifetime(), me(), 'debate_000000000000', 'turns', 5))
    expect(textOf(shown.querySelector('.debate-turns-taken')!)).toBe(
      strings.debates.turnsTaken({ count: 5, total: 4 }),
    )
    const list = shown.querySelector('.debate-turns > ol.debate-turn-list')!
    expect(list.getAttribute('aria-live')).toBe('polite')
    expect([...list.querySelectorAll('.debate-turn-number')].map((number) => number.textContent)).toEqual(
      [1, 2, 3, 4, 5].map((position) => strings.debates.turnLabel({ position })),
    )
    const moved = list.querySelector('.debate-turn[data-position="3"]')!
    expect(textOf(moved)).toContain(strings.debates.changedPositionMark)
    expect(moved.querySelector('a.turn-cite')!.getAttribute('href')).toBe(
      '#/debate/debate_000000000000/turns?turn=2',
    )
    const quiet = list.querySelector('.debate-quiet-turns details')!
    expect(quiet.hasAttribute('open')).toBe(true)
    expect(textOf(quiet.querySelector('summary')!)).toBe(
      strings.debates.quietTurns({ count: 2, first: 4, last: 5 }),
    )
    expect(quiet.querySelectorAll('.debate-turn.is-filler')).toHaveLength(2)
    page.runFrames()
    expect(document.activeElement).toBe(shown.querySelector('.debate-turn[data-position="5"]'))
  })

  it('shows who changed position between which turns, and what sets each agent’s contribution apart', () => {
    const { context } = testContext()
    const credited = {
      ...conclusion,
      reasons: ['Turn 3 settled it.'],
      contributions: [
        { memberId: BEN, summary: 'Checked.', credits: ['gap_filled' as const] },
        { memberId: ANA, summary: 'Moved.', credits: ['gap_filled' as const, 'position_changed' as const] },
      ],
    }
    context.state.shownDebate.set(
      debate({
        status: 'closed',
        createdBy: BEN,
        participants: [participant(ANA), participant(BEN)],
        turns: [
          { position: 1, memberId: ANA, agentName: 'Desk', body: 'Thursday.', at: 3 },
          { position: 2, memberId: BEN, agentName: 'Desk', body: 'Friday.', at: 4 },
          { position: 3, memberId: ANA, agentName: 'Desk', body: 'That moved me: Friday.', at: 5 },
        ],
        result: { result: credited, draftedBy: BEN, draftedAt: 6 },
        voteRecord: { votes: [], droppedOut: [] },
      }),
    )
    const result = debateView(context, lifetime(), me(), 'debate_000000000000', 'result')
    const moves = result.querySelector('.debate-moved')!
    expect(textOf(moves)).toContain(
      strings.debates.movedLine({ agent: strings.debates.mine.agent, from: 1, to: 3 }),
    )
    expect([...moves.querySelectorAll('dd')].map((quote) => quote.textContent)).toEqual([
      'Thursday.',
      'That moved me: Friday.',
    ])
    expect(result.querySelector('.debate-reasons a.turn-cite')!.getAttribute('href')).toBe(
      '#/debate/debate_000000000000/turns?turn=3',
    )
    const credit = debateView(context, lifetime(), me(), 'debate_000000000000', 'credit')
    expect(textOf(credit.querySelector('.debate-shared-credits')!)).toBe(
      strings.debates.sharedCredits({ credits: strings.debates.credit.gap_filled }),
    )
    expect(credit.querySelector('.debate-credit')).toBeNull()
    const mine = credit.querySelector(`.debate-credit-row[data-member="${ANA}"]`)!
    expect(textOf(mine.querySelector('.debate-position-change p')!)).toBe(
      strings.debates.positionChange({ from: 1, to: 3 }),
    )
    expect(
      [...mine.querySelectorAll('.debate-credit-turns a.turn-cite')].map((link) => link.textContent),
    ).toEqual(['1', '3'])
    expect(
      credit.querySelector(`.debate-credit-row[data-member="${BEN}"] .debate-position-change`),
    ).toBeNull()
  })
})
