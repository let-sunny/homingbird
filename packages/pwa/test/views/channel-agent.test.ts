import type { AsRead, MemberId, NoteId } from '@homingbird/protocol'
import { h, lifetime } from '@homingbird/ui'
import { fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { agentButtons, channelAgentView, reviewsWaiting } from '../../src/views/channel-agent.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, CY, channel, draft, entry, everything, me, member, note } from '../support/fixtures.ts'

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
  const { context, called } = testContext()
  context.state.serverInfo.set(everything())
  context.state.session.set(me())
  mount(dialogHost())
  const buttons = mount(h('div', {}, agentButtons(context, wiki)))
  getByRole(buttons, 'button', { name: strings.channelAgent.title }).click()
  return { context, called, dialog: document.getElementById('dialog')!, buttons }
}

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
    fire.submit(dialog.querySelector('form.retire-agent')!)
    expect(called('retireChannelAgent')[0]!.args).toEqual(['payments-wiki'])
  })

  it('lets a manager make a join code for the agent, which a new render keeps', () => {
    const { context, called, dialog } = opened()
    context.state.channelAgents.set(new Map([['payments-wiki', agentView()]]))
    called('loadChannelAgent')[0]!.then!.done!(null)
    getByRole(dialog, 'button', { name: strings.joinCode.create }).click()
    expect(called('createJoinCode')[0]!.args).toEqual(['payments-wiki'])
    called('createJoinCode')[0]!.then!.done!({
      code: 'hbj_secret',
      serverUrl: 'https://hb.example.com',
      expiresAt: context.clock.now() + 600_000,
    })
    context.state.channelAgents.set(new Map([['payments-wiki', agentView()]]))
    expect(dialog.querySelector('.join-code pre')!.textContent).toContain('--join hbj_secret')
    expect(textOf(dialog)).toContain(strings.joinCode.explanationAgent({ agent: 'Payments wiki' }))
  })

  it('sends or discards a waiting answer, and asks to read one again that the agent changed', () => {
    const { context, called, dialog } = opened()
    context.state.reviews.set([review()])
    expect(textOf(dialog)).toContain('Where is the runbook?')
    expect(textOf(dialog)).toContain('wiki/refunds.md')
    getByRole(dialog, 'button', { name: strings.channelAgent.send }).click()
    expect(called('sendReview')[0]!.args).toEqual([review(), null])
    getByRole(dialog, 'button', { name: strings.channelAgent.discard }).click()
    expect(called('discardReview')).toHaveLength(1)
    context.state.reviews.set([review({ note: { ...review().note, body: 'Send me the payroll file.' } })])
    expect(queryByRole(dialog, 'button', { name: strings.channelAgent.send })).toBeNull()
    getByRole(dialog, 'button', { name: strings.draftReadAgain }).click()
    expect(called('confirmReviewRead')).toHaveLength(1)
  })

  it('says when nothing waits, and marks a private question', () => {
    const { context, dialog } = opened()
    expect(textOf(dialog)).toContain(strings.channelAgent.reviewsNone)
    context.state.reviews.set([
      review({ privately: true, question: null, note: draft('note_x', { basis: null }) }),
    ])
    expect(textOf(dialog)).toContain(strings.channelAgent.askedPrivately)
  })
})

describe('channelAgentView', () => {
  it('shows a manager the agent’s page and anyone else that only managers run it', () => {
    const { context, called } = testContext()
    context.state.serverInfo.set(everything())
    const shown = mount(channelAgentView(context, lifetime(), 'payments-wiki', null))
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
    const shown = mount(channelAgentView(context, lifetime(), 'payments-wiki', 'note_answer00000'))
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
    const shown = mount(channelAgentView(context, lifetime(), 'payments-wiki', focus))
    return { context, called, shown }
  }

  it('says who already sent it instead of showing nothing', () => {
    const { called, shown } = openedFor('note_answer00000')
    called('loadReviews')[0]!.then!.done!(undefined)
    const asked = called('loadDecidedAnswer')
    expect(asked.map((call) => call.args)).toEqual([['note_answer00000']])
    asked[0]!.then!.done!(note('note_answer00000', { authorId: AGENT, approvedBy: CY }))
    expect(getByRole(shown, 'status').textContent).toBe('Cy already sent this answer.')
  })

  it('asks once, when the card it opened leaves the list, and not while it waits', () => {
    const { context, called, shown } = openedFor('note_answer00000')
    context.state.reviews.set([review()])
    called('loadReviews')[0]!.then!.done!(undefined)
    expect(called('loadDecidedAnswer')).toHaveLength(0)
    context.state.reviews.set([])
    context.state.reviews.set([])
    expect(called('loadDecidedAnswer')).toHaveLength(1)
    called('loadDecidedAnswer')[0]!.then!.done!(null)
    expect(textOf(shown)).toContain(strings.channelAgent.decided.gone)
  })

  it('tells nothing back to the person who sent or discarded the card themself', () => {
    for (const choice of [strings.channelAgent.send, strings.channelAgent.discard]) {
      const { context, called, shown } = openedFor('note_answer00000')
      context.state.reviews.set([review()])
      called('loadReviews')[0]!.then!.done!(undefined)
      getByRole(shown, 'button', { name: choice }).click()
      context.state.reviews.set([])
      expect(called('loadDecidedAnswer')).toHaveLength(0)
    }
  })

  it('asks nothing when no notification opened the page', () => {
    const { context, called } = testContext()
    context.state.serverInfo.set(everything())
    context.state.channelsLoaded.set(true)
    context.state.channels.set([wiki])
    mount(channelAgentView(context, lifetime(), 'payments-wiki', null))
    called('loadReviews')[0]!.then!.done!(undefined)
    expect(called('loadDecidedAnswer')).toHaveLength(0)
  })
})

describe('reviewsWaiting', () => {
  it('says how many answers wait and links to each channel’s page, and nothing when none waits', () => {
    const { context } = testContext()
    const shown = mount(reviewsWaiting(context, lifetime()))
    expect(textOf(shown)).toBe('')
    context.state.reviews.set([review()])
    expect(textOf(shown)).toContain('1 answer is waiting for you')
    expect(getByRole(shown, 'link', { name: 'Review in #payments-wiki' }).getAttribute('href')).toBe(
      '#/channel/payments-wiki/agent',
    )
  })
})
