import type { AsRead, MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { channelAgentFiguresModel } from '../../src/models/channel-agent-figures.ts'
import { durationOf, strings } from '../../src/strings.ts'
import { CHECKING } from '../support/resource-load.ts'

const figures = (fields: Partial<AsRead.ChannelAgentFigures> = {}): AsRead.ChannelAgentFigures => ({
  written: 6,
  sentAsWritten: 3,
  sentAfterEdits: 1,
  discarded: 1,
  medianDecisionMs: 90_000,
  quickApprovals: 2,
  approvals: [
    { memberId: 'mem_ana' as MemberId, name: 'Ana', approved: 3 },
    { memberId: 'mem_ben' as MemberId, name: 'Ben', approved: 1 },
  ],
  ...fields,
})

const report: AsRead.ChannelAgentReport = {
  generatedAt: 1,
  channel: 'payments-wiki',
  quickApprovalSeconds: 3,
  minimumGroupSize: 5,
  waiting: 1,
  periods: [
    { days: 7, current: figures({ written: 2 }), previous: figures() },
    { days: 30, current: figures(), previous: figures({ medianDecisionMs: null, written: 0 }) },
  ],
}

describe('channelAgentFiguresModel', () => {
  it('leaves the section out for someone who does not manage the channel, once that is known', () => {
    expect(channelAgentFiguresModel(null, null, 'payments-wiki', 30)).toEqual({ kind: 'hidden' })
  })

  it('waits rather than leave the section out while the answer has not come', () => {
    expect(channelAgentFiguresModel(null, CHECKING, 'payments-wiki', 30)).toEqual({
      kind: 'waiting',
      title: strings.channelAgent.figuresTitle({ channel: '#payments-wiki' }),
      wait: CHECKING,
    })
    expect(channelAgentFiguresModel(report, CHECKING, 'payments-wiki', 30).kind).toBe('waiting')
  })

  it('gives each figure of the period beside the period before, and every manager’s count in order', () => {
    const model = channelAgentFiguresModel(report, null, 'payments-wiki', 30)
    expect(model).toEqual({
      kind: 'figures',
      title: 'How the agent of #payments-wiki is doing',
      intro: strings.channelAgent.figuresIntro({ channel: '#payments-wiki' }),
      headings: [
        strings.trust.what,
        strings.trust.lastDays({ days: 30 }),
        strings.trust.before({ days: 30 }),
      ],
      rows: [
        [strings.channelAgent.figuresWritten, '6', '0'],
        [strings.channelAgent.figuresAsWritten, '3', '3'],
        [strings.channelAgent.figuresEdited, '1', '1'],
        [strings.channelAgent.figuresDiscarded, '1', '1'],
        [strings.channelAgent.figuresMedian, durationOf(90_000), strings.trust.noneYet],
        [strings.channelAgent.figuresQuick, '2', '2'],
      ],
      waiting: '1 answer is waiting now.',
      approvalsTitle: strings.channelAgent.figuresApprovalsTitle({ days: 30 }),
      approvalsHint: strings.channelAgent.figuresApprovalsHint,
      approvals: ['Ana: 3 answers', 'Ben: 1 answer'],
      footnote: strings.channelAgent.figuresQuickExplained({ seconds: 3 }),
    })
  })

  it('says each manager’s count waits for the minimum of managers when the server leaves it out', () => {
    const small = {
      ...report,
      periods: [{ days: 30, current: figures({ approvals: null }), previous: figures() }],
    }
    const model = channelAgentFiguresModel(small, null, 'payments-wiki', 30)
    expect(model.kind === 'figures' && [model.approvals, model.approvalsHint]).toEqual([
      [],
      strings.channelAgent.figuresApprovalsHidden({ minimum: 5 }),
    ])
  })

  it('adds one line for the answers people who no longer manage the channel sent', () => {
    const former = {
      ...report,
      periods: [
        { days: 30, current: figures({ approvals: null, approvedByFormerManagers: 2 }), previous: figures() },
      ],
    }
    const model = channelAgentFiguresModel(former, null, 'payments-wiki', 30)
    expect(model.kind === 'figures' && model.approvals).toEqual([
      'People who no longer manage the channel: 2 answers',
    ])
  })

  it('falls back to the first period when the one asked for is not there', () => {
    const model = channelAgentFiguresModel(report, null, 'payments-wiki', 90)
    expect(model.kind === 'figures' && model.rows[0]).toEqual([strings.channelAgent.figuresWritten, '2', '6'])
  })
})
