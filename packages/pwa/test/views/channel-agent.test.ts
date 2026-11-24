import type { AsRead, MemberId, NoteId } from '@homingbird/protocol'
import { h, lifetime } from '@homingbird/ui'
import { fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { heldWordsFor } from '../../src/held-decisions.ts'
import { strings } from '../../src/strings.ts'
import { agentButtons, channelAgentView } from '../../src/views/channel-agent.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, CY, channel, draft, entry, everything, me, member, note } from '../support/fixtures.ts'
import { setLoad } from '../support/resource-load.ts'

usingFakeDom()

const AGENT = 'mem_agent0000000' as MemberId
const wiki = channel('payments-wiki', {
  joined: true,
  managing: true,
  runsAgent: true,
  agent: { id: AGENT, name: 'Payments wiki' },
})

const review = (fields: Partial<AsRead.Review> = {}): AsRead.Review => ({
  note: draft('note_answer00000', {
    authorId: AGENT,
    inReplyTo: 'note_question000' as NoteId,
    basis: 'wiki/refunds.md',
  }),
  question: note('note_question000', { authorId: CY, body: 'Where is the runbook?' }),
  channel: 'payments-wiki',
  agent: member(AGENT, 'Payments wiki', { kind: 'channel_agent' }),
  privately: false,
  ...fields,
})

const agentView = (credentials: AsRead.ChannelAgent['credentials'] = []): AsRead.ChannelAgent => ({
  agent: member(AGENT, 'Payments wiki', { kind: 'channel_agent' }),
  channel: 'payments-wiki',
  credentials,
})

const opened = () => {
  const { context, called, page } = testContext()
  context.state.serverInfo.set(everything())
  context.state.session.set(me())
  mount(dialogHost())
  const buttons = mount(h('div', {}, agentButtons(context, wiki)))
  getByRole(buttons, 'button', { name: strings.channelAgent.title }).click()
  return { context, called, page, dialog: document.getElementById('dialog')!, buttons }
}

const onPage = () => {
  const { context, called, page } = testContext()
  context.state.serverInfo.set(everything())
  context.state.session.set(me())
  context.state.channelsLoaded.set(true)
  context.state.channels.set([wiki])
  const shown = mount(channelAgentView(context, lifetime(), 'payments-wiki', null, 'answers'))
  return { context, called, page, dialog: shown }
}

describe('channelAgentView', () => {
  it('shows the agent’s state on its page, as a person’s agent is shown', () => {
    const { context } = testContext()
    context.state.serverInfo.set(everything())
    context.state.session.set(me())
    context.state.channelsLoaded.set(true)
    context.state.channels.set([
      {
        ...wiki,
        agent: { id: AGENT, name: 'Payments wiki', presence: { humanOnline: false, agentOnline: false } },
      },
    ])
    const shown = mount(channelAgentView(context, lifetime(), 'payments-wiki', null, 'answers'))
    expect(textOf(shown.querySelector('.channel-agent-state')!)).toBe(
      strings.channelAgentState.notConnected({ agent: 'Payments wiki' }),
    )
  })
})

describe('agentButtons', () => {
  it('asks the agent privately from the room', () => {
    const { called, buttons } = opened()
    getByRole(buttons, 'button', { name: 'Ask Payments wiki privately' }).click()
    expect(called('askPrivately')[0]!.args).toEqual(['payments-wiki'])
  })

  it('shows nothing to a member while channel agents are off', () => {
    const { context } = testContext()
    const shown = mount(h('div', {}, agentButtons(context, wiki)))
    expect(queryByRole(shown, 'button', { name: strings.channelAgent.title })).toBeNull()
  })
})

describe('the agent panel', () => {
  it('makes an agent under the name typed', () => {
    const { called, dialog } = opened()
    called('loadChannelAgent')[0]!.then!.done!(null)
    expect(textOf(dialog)).toContain(strings.channelAgent.none)
    const name = dialog.querySelector<HTMLInputElement>('input[name="name"]')!
    name.value = '  Payments wiki  '
    fire.submit(dialog.querySelector('form.agent-name')!)
    expect(called('createChannelAgent')[0]!.args).toEqual(['payments-wiki', 'Payments wiki'])
  })

  it('renames the agent, disconnects a desk and retires the agent', () => {
    const { context, called, dialog } = opened()
    context.state.channelAgents.set(
      new Map([
        [
          'payments-wiki',
          agentView([
            {
              id: 'cred_desk00000000' as never,
              name: 'Wiki desk',
              client: 'homingbird',
              createdAt: 1,
              expiresAt: 2,
              lastUsedAt: null,
              revokedAt: null,
              issuedBy: ANA,
            },
          ]),
        ],
      ]),
    )
    called('loadChannelAgent')[0]!.then!.done!(null)
    expect(textOf(dialog)).toContain('Wiki desk')
    const name = dialog.querySelector<HTMLInputElement>('input[name="name"]')!
    name.value = 'Refunds wiki'
    fire.submit(dialog.querySelector('form.agent-name')!)
    expect(called('renameChannelAgent')[0]!.args).toEqual(['payments-wiki', 'Refunds wiki'])
    getByRole(dialog, 'button', { name: strings.channelAgent.revoke }).click()
    expect(called('disconnectAgentDesk')[0]!.args).toEqual(['payments-wiki', 'cred_desk00000000'])
    const retire = dialog.querySelector<HTMLDetailsElement>('details.retire-agent-step')!
    expect(retire.open).toBe(false)
    retire.open = true
    fire.event(retire, 'toggle')
    context.state.channelAgents.set(new Map(context.state.channelAgents.get()))
    expect(dialog.querySelector<HTMLDetailsElement>('details.retire-agent-step')!.open).toBe(true)
    expect(called('retireChannelAgent')).toEqual([])
    fire.submit(retire.querySelector('form.retire-agent')!)
    expect(called('retireChannelAgent')[0]!.args).toEqual(['payments-wiki'])
  })

  it('keeps the dialog to the agent’s setup, with rename secondary and a way to its page', () => {
    const { context, called, dialog } = opened()
    context.state.channelAgents.set(new Map([['payments-wiki', agentView()]]))
    called('loadChannelAgent')[0]!.then!.done!(null)
    context.state.reviews.set([review()])
    expect(called('refreshReviews')).toEqual([])
    expect(called('loadChannelAgentFigures')).toEqual([])
    expect(dialog.querySelector('.reviews, .channel-agent-figures')).toBeNull()
    expect(getByRole(dialog, 'button', { name: strings.channelAgent.rename }).className).not.toContain(
      'primary',
    )
    expect(dialog.querySelector('details.retire-agent-step summary')!.textContent).toBe(
      strings.channelAgent.retireTitle,
    )
    const link = getByRole(dialog, 'link', { name: strings.channelAgent.openPage })
    expect(link.getAttribute('href')).toBe('#/channel/payments-wiki/agent')
    const host = document.getElementById('dialog') as HTMLDialogElement
    host.showModal()
    link.click()
    expect(host.open).toBe(false)
  })

  it('makes a new agent with a primary button', () => {
    const { called, dialog } = opened()
    called('loadChannelAgent')[0]!.then!.done!(null)
    expect(getByRole(dialog, 'button', { name: strings.channelAgent.create }).className).toContain('primary')
  })

  it('lets a manager make a join code for the agent, which a new render keeps', () => {
    const { context, called, dialog } = opened()
    context.state.channelAgents.set(new Map([['payments-wiki', agentView()]]))
    called('loadChannelAgent')[0]!.then!.done!(null)
    getByRole(dialog, 'button', { name: strings.joinCode.create }).click()
    expect(called('createJoinCode')[0]!.args).toEqual(['payments-wiki'])
    called('createJoinCode')[0]!.then!.done!({
      code: 'hbj_secret',
      id: 'join_1',
      serverUrl: 'https://hb.example.com',
      expiresAt: context.clock.now() + 600_000,
    })
    context.state.channelAgents.set(new Map([['payments-wiki', agentView()]]))
    expect(dialog.querySelector('.join-code pre')!.textContent).toContain('--join hbj_secret')
    expect(textOf(dialog)).toContain(strings.joinCode.explanationAgent({ agent: 'Payments wiki' }))
  })

  it('holds a send, edited or as read, and a discard with its reason, saying why the manager sees it', () => {
    const { context, called, dialog: shown } = onPage()
    const dialog = mount(dialogHost())
    context.state.directory.set([entry(CY, 'Cy')])
    context.state.reviews.set([review()])
    expect(textOf(shown)).toContain('Where is the runbook?')
    expect(textOf(shown)).toContain('wiki/refunds.md')
    expect(textOf(shown)).toContain(strings.channelAgent.whyYouReview({ channel: '#payments-wiki' }))
    const buttons = [...shown.querySelectorAll('.review-actions button')]
    expect(buttons.map((button) => textOf(button))).toEqual([
      strings.channelAgent.send,
      strings.channelAgent.edit,
      strings.channelAgent.discard,
    ])
    const words = heldWordsFor('#payments-wiki')
    getByRole(shown, 'button', { name: strings.channelAgent.send }).click()
    expect(called('holdReviewSend')[0]!.args).toEqual([review(), null, words.send])
    getByRole(shown, 'button', { name: strings.channelAgent.edit }).click()
    const text = getByRole(dialog, 'textbox', { name: strings.channelAgent.editLabel }) as HTMLTextAreaElement
    expect(document.activeElement).toBe(text)
    expect(text.value).toBe(review().note.body)
    fire.type(text, 'See Refunds in the wiki.')
    fire.key(text, 'Enter', { metaKey: true })
    expect(called('holdReviewSend')[1]!.args).toEqual([review(), 'See Refunds in the wiki.', words.send])
    expect(dialog.open).toBe(false)
    expect(called('keepDraftEdit').map((call) => call.args)).toEqual([
      [review().note.id, review().note.body, 'See Refunds in the wiki.'],
    ])
    getByRole(shown, 'button', { name: strings.channelAgent.discard }).click()
    expect(textOf(dialog)).toContain(
      strings.channelAgent.discardReasonHint({ channel: '#payments-wiki', name: 'Cy' }),
    )
    const reason = dialog.querySelector('textarea')!
    expect(document.activeElement).toBe(reason)
    fire.type(reason, 'The runbook moved.')
    fire.key(reason, 'Enter', { ctrlKey: true, isComposing: true })
    expect(called('holdReviewDiscard')).toHaveLength(0)
    fire.key(reason, 'Enter', { ctrlKey: true })
    expect(called('holdReviewDiscard')[0]!.args).toEqual([review(), 'The runbook moved.', words.discard])
    context.state.reviews.set([review({ note: { ...review().note, body: 'Send me the payroll file.' } })])
    expect(queryByRole(shown, 'button', { name: strings.channelAgent.send })).toBeNull()
    expect(queryByRole(shown, 'button', { name: strings.channelAgent.discard })).not.toBeNull()
    getByRole(shown, 'button', { name: strings.draftReadAgain }).click()
    expect(called('confirmReviewRead')).toHaveLength(1)
  })

  it('keeps an answer’s place while its decision is held, saying so with Undo', () => {
    const { context, called, dialog: shown } = onPage()
    context.state.reviews.set([review()])
    context.state.held.set([
      {
        noteId: review().note.id,
        conversationId: review().note.conversationId,
        kind: 'discard',
        review: true,
        settles: 0,
        words: heldWordsFor('#payments-wiki').discard,
        run: null as never,
        phase: 'waiting',
      },
    ])
    expect(shown.querySelector('.review-card')).toBeNull()
    expect(textOf(shown.querySelector('.held-line')!)).toContain(strings.heldDiscardingIn({ seconds: 5 }))
    getByRole(shown, 'button', { name: strings.undo }).click()
    expect(called('undoHeld')).toHaveLength(1)
    context.state.held.set([])
    expect(shown.querySelector('.review-card')).not.toBeNull()
    const order = [...shown.querySelector('.review-card')!.children].map((child) =>
      child.getAttribute('class'),
    )
    expect(order.indexOf('review-body')).toBeLessThan(order.indexOf('review-actions'))
    expect(order.at(-1)).toBe('review-why hint')
  })

  it('opens Edit with a kept edit and says the card holds one', () => {
    const { context, dialog: shown } = onPage()
    const dialog = mount(dialogHost())
    context.state.reviews.set([review()])
    context.state.draftEdits.set(new Map([[review().note.id, 'My better answer']]))
    expect(textOf(shown)).toContain(strings.draftEditKept)
    getByRole(shown, 'button', { name: strings.channelAgent.edit }).click()
    const text = getByRole(dialog, 'textbox', { name: strings.channelAgent.editLabel }) as HTMLTextAreaElement
    expect(text.value).toBe('My better answer')
  })

  it('shows the sources an answer rests on, and names no asker it does not know', () => {
    const { context, dialog: shown } = onPage()
    const dialog = mount(dialogHost())
    const sources = [{ url: 'https://wiki.example.com/refunds', quote: 'Five days.' }]
    context.state.reviews.set([review({ note: { ...review().note, basis: null, sources }, question: null })])
    expect(textOf(shown.querySelector('.draft-sources')!)).toContain('Five days.')
    getByRole(shown, 'button', { name: strings.channelAgent.discard }).click()
    expect(textOf(dialog)).toContain(
      strings.channelAgent.discardReasonHintPrivately({ channel: '#payments-wiki' }),
    )
  })

  it('lists the answers waiting on the agent’s page before its setup', () => {
    const { context, called, dialog } = onPage()
    called('loadChannelAgent')[0]!.then!.done!(undefined)
    context.state.channelAgents.set(new Map([['payments-wiki', agentView()]]))
    context.state.reviews.set([review()])
    const sections = [...dialog.querySelectorAll('.reviews, .agent-name, .agent-desks')]
    expect(sections.map((element) => element.className.split(' ').at(-1))).toEqual([
      'reviews',
      'agent-name',
      'agent-desks',
    ])
  })

  it('says when nothing waits, and marks a private question', () => {
    const { context, dialog } = onPage()
    setLoad(context.state.reviews, { loaded: true })
    expect(textOf(dialog)).toContain(strings.channelAgent.reviewsNone)
    context.state.reviews.set([
      review({ privately: true, question: null, note: draft('note_x', { basis: null }) }),
    ])
    expect(textOf(dialog)).toContain(strings.channelAgent.askedPrivately)
  })
})

describe('how the agent is doing', () => {
  const report = (): AsRead.ChannelAgentReport => {
    const figures = (written: number): AsRead.ChannelAgentFigures => ({
      written,
      sentAsWritten: 2,
      sentAfterEdits: 1,
      discarded: 0,
      medianDecisionMs: null,
      quickApprovals: 1,
      approvals: [{ memberId: ANA, name: 'Ana', approved: 3 }],
    })
    return {
      generatedAt: 1,
      channel: 'payments-wiki',
      quickApprovalSeconds: 3,
      minimumGroupSize: 5,
      waiting: 2,
      periods: [{ days: 30, current: figures(4), previous: figures(1) }],
    }
  }

  it('puts the recent decisions on the agent’s page, right after the answers waiting', () => {
    const { called, dialog } = onPage()
    expect(called('loadChannelDecisions')[0]!.args).toEqual(['payments-wiki'])
    called('loadChannelDecisions')[0]!.then!.done!({ channel: 'payments-wiki', days: 30, decisions: [] })
    const panel = dialog.querySelector('.channel-agent-panel')!
    expect([...panel.children].map((child) => child.className).slice(0, 2)).toEqual([
      'region',
      'channel-decisions-region',
    ])
  })

  it('shows the figures and each manager’s count beside the panel, once loaded', () => {
    const { called, dialog } = onPage()
    expect(called('loadChannelAgentFigures')[0]!.args).toEqual(['payments-wiki'])
    expect(dialog.querySelector('.channel-agent-figures')).toBeNull()
    called('loadChannelAgentFigures')[0]!.then!.done!(report())
    const section = dialog.querySelector<HTMLElement>('.channel-agent-figures')!
    expect(getByRole(section, 'heading', { name: 'How the agent of #payments-wiki is doing' })).toBeTruthy()
    expect(getByRole(section, 'table')).toBeTruthy()
    expect(textOf(section)).toContain('Ana: 3 answers')
    expect(textOf(section)).toContain('2 answers are waiting now.')
  })

  it('reads the figures again when an answer is sent or discarded, so the counts stay current', () => {
    const { context, called } = onPage()
    expect(called('loadChannelAgentFigures')).toHaveLength(1)
    context.state.reviews.set([review()])
    context.state.reviews.set([])
    expect(called('loadChannelAgentFigures')).toHaveLength(3)
    context.state.reviews.set([])
    context.state.reviews.set([{ ...review(), channel: 'other-wiki' }])
    expect(called('loadChannelAgentFigures')).toHaveLength(3)
  })

  it('keeps the figures of the latest request when an earlier one answers late', () => {
    const { context, called, dialog } = onPage()
    context.state.reviews.set([review()])
    const [first, second] = called('loadChannelAgentFigures')
    second!.then!.done!(report())
    first!.then!.done!(null)
    first!.then!.failed!(new Error('late') as never)
    expect(dialog.querySelector('.channel-agent-figures')).not.toBeNull()
  })

  it('shows nothing to someone who does not manage the channel, and says when loading failed', () => {
    const first = onPage()
    first.called('loadChannelAgentFigures')[0]!.then!.done!(null)
    expect(first.dialog.querySelector('.channel-agent-figures')).toBeNull()
    expect(textOf(first.dialog)).not.toContain(strings.channelAgent.figuresLoadFailed)
    first.called('loadChannelAgentFigures')[0]!.then!.failed!(new Error('down') as never)
    expect(textOf(first.dialog)).toContain(strings.channelAgent.figuresLoadFailed)
  })

  it('reports a waiting answer as seen once its card is on a visible page', () => {
    const { context, called, page } = onPage()
    context.state.reviews.set([review()])
    page.runFrames()
    context.state.reviews.set([review()])
    page.runFrames()
    expect(called('reportDraftSeen').map((call) => call.args)).toEqual([['note_answer00000']])
  })
})

describe('channelAgentView', () => {
  it('offers the answers and Teach as tabs, and shows what the agent was taught on Teach', () => {
    const { context, called } = testContext()
    context.state.serverInfo.set(everything())
    context.state.channelsLoaded.set(true)
    context.state.channels.set([wiki])
    const shown = mount(channelAgentView(context, lifetime(), 'payments-wiki', null, 'teach'))
    const tabs = getByRole(shown, 'navigation', {
      name: strings.channelTeach.tabsLabel({ channel: '#payments-wiki' }),
    })
    expect(
      getByRole(tabs, 'link', { name: strings.channelTeach.tabs.teach }).getAttribute('aria-current'),
    ).toBe('page')
    expect(getByRole(tabs, 'link', { name: strings.channelTeach.tabs.answers }).getAttribute('href')).toBe(
      '#/channel/payments-wiki/agent',
    )
    expect(called('loadChannelTeaching')[0]!.args).toEqual(['payments-wiki'])
    expect(called('refreshReviews')).toHaveLength(0)
  })

  it('has no tabs while the organization has teaching off', () => {
    const { context } = testContext()
    context.state.serverInfo.set(everything())
    context.state.serverInfo.set({ ...everything(), features: { ...everything().features, teaching: false } })
    context.state.channelsLoaded.set(true)
    context.state.channels.set([wiki])
    const shown = mount(channelAgentView(context, lifetime(), 'payments-wiki', null, 'teach'))
    expect(queryByRole(shown, 'navigation')).toBeNull()
  })

  it('shows a manager the agent’s page and anyone else that only managers run it', () => {
    const { context, called } = testContext()
    context.state.serverInfo.set(everything())
    const shown = mount(channelAgentView(context, lifetime(), 'payments-wiki', null, 'answers'))
    expect(called('loadKnownChannels')).toHaveLength(1)
    expect(shown.querySelector('.loading')).not.toBeNull()
    context.state.channelsLoaded.set(true)
    expect(textOf(shown)).toContain(strings.channelAgent.notYours)
    context.state.channels.set([wiki])
    expect(textOf(shown)).toContain('The agent of #payments-wiki')
    called('loadChannelAgent')[0]!.then!.failed!(new Error('down'))
    expect(textOf(shown)).toContain(strings.channelAgent.loadFailed)
  })

  it('brings the answer a notification opened into view, once', () => {
    const { context, page } = testContext()
    context.state.serverInfo.set(everything())
    context.state.channelsLoaded.set(true)
    context.state.channels.set([wiki])
    const shown = mount(channelAgentView(context, lifetime(), 'payments-wiki', 'note_answer00000', 'answers'))
    context.state.reviews.set([review(), review({ note: draft('note_other000000', { authorId: AGENT }) })])
    const focused = shown.querySelector('.review-card[aria-current="true"]')
    expect(focused?.getAttribute('data-note')).toBe('note_answer00000')
    expect(shown.querySelectorAll('.review-card[aria-current]')).toHaveLength(1)
    page.runFrames()
    expect(document.activeElement).toBe(focused)
    ;(document.activeElement as HTMLElement).blur()
    context.state.reviews.set([review()])
    page.runFrames()
    expect(document.activeElement).toBe(document.body)
  })
})

describe('the answer a stale notification opened', () => {
  const openedFor = (focus: string) => {
    const { context, called } = testContext()
    context.state.session.set(me())
    context.state.serverInfo.set(everything())
    context.state.channelsLoaded.set(true)
    context.state.channels.set([wiki])
    context.state.directory.set([entry(CY, 'Cy')])
    const shown = mount(channelAgentView(context, lifetime(), 'payments-wiki', focus, 'answers'))
    return { context, called, shown }
  }

  it('says who already sent it instead of showing nothing', () => {
    const { called, shown } = openedFor('note_answer00000')
    called('refreshReviews')[0]!.then!.done!(true)
    const asked = called('loadDecidedAnswer')
    expect(asked.map((call) => call.args)).toEqual([['note_answer00000']])
    asked[0]!.then!.done!(note('note_answer00000', { authorId: AGENT, approvedBy: CY }))
    expect(getByRole(shown, 'status').textContent).toBe('Cy already sent this answer.')
  })

  it('never says that none waits before the list came: it is checked, or failed with the way to try again', () => {
    const { context, called, shown } = openedFor('note_answer00000')
    context.state.workspace.set('loaded')
    expect(textOf(shown)).toContain(strings.checking.waiting)
    expect(textOf(shown)).not.toContain(strings.channelAgent.reviewsNone)
    setLoad(context.state.reviews, { step: 'failed' })
    expect(textOf(shown)).toContain(strings.loadFailed)
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(called('askActivityAgain')).toHaveLength(1)
    setLoad(context.state.reviews, { loaded: true })
    expect(textOf(shown)).toContain(strings.channelAgent.reviewsNone)
  })

  it('asks nothing while the list could not be read, until it was', () => {
    const { context, called } = openedFor('note_answer00000')
    called('refreshReviews')[0]!.then!.done!(false)
    expect(called('loadDecidedAnswer')).toHaveLength(0)
    context.state.reviews.set([])
    context.state.reviews.set([])
    expect(called('loadDecidedAnswer')).toHaveLength(1)
  })

  it('asks once, when the card it opened leaves the list, and not while it waits', () => {
    const { context, called, shown } = openedFor('note_answer00000')
    context.state.reviews.set([review()])
    called('refreshReviews')[0]!.then!.done!(true)
    expect(called('loadDecidedAnswer')).toHaveLength(0)
    context.state.reviews.set([])
    context.state.reviews.set([])
    expect(called('loadDecidedAnswer')).toHaveLength(1)
    called('loadDecidedAnswer')[0]!.then!.done!(null)
    expect(textOf(shown)).toContain(strings.channelAgent.decided.gone)
  })

  it('tells nothing back to the person who sent or discarded the card themself', () => {
    const dialog = mount(dialogHost())
    for (const decide of ['send', 'discard'] as const) {
      const { context, called, shown } = openedFor('note_answer00000')
      context.state.reviews.set([review()])
      called('refreshReviews')[0]!.then!.done!(true)
      if (decide === 'send') getByRole(shown, 'button', { name: strings.channelAgent.send }).click()
      else {
        getByRole(shown, 'button', { name: strings.channelAgent.discard }).click()
        fire.submit(dialog.querySelector('form')!)
      }
      context.state.reviews.set([])
      expect(called('loadDecidedAnswer')).toHaveLength(0)
    }
  })

  it('asks nothing when no notification opened the page', () => {
    const { context, called } = testContext()
    context.state.serverInfo.set(everything())
    context.state.channelsLoaded.set(true)
    context.state.channels.set([wiki])
    mount(channelAgentView(context, lifetime(), 'payments-wiki', null, 'answers'))
    called('refreshReviews')[0]!.then!.done!(true)
    expect(called('loadDecidedAnswer')).toHaveLength(0)
  })
})
