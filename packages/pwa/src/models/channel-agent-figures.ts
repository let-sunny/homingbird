import type { AsRead } from '@homingbird/protocol'
import { channelLabel } from '../channels.ts'
import { durationOf, formats, strings } from '../strings.ts'

/** How a channel's agent is doing, for its managers: its answers beside the period before, and who sent them. */
export const channelAgentFiguresModel = (
  report: ChannelAgentFiguresState,
  slug: string,
  days: number,
): ChannelAgentFiguresModel => {
  if (report === null) return { kind: 'hidden' }
  if (report === 'loading') return { kind: 'loading' }
  if (report === 'failed') return { kind: 'failed', text: strings.channelAgent.figuresLoadFailed }
  const period = report.periods.find((each) => each.days === days) ?? report.periods[0]!
  const channel = channelLabel(slug)
  const count = (value: number): string => formats.decimal.format(value)
  const time = (ms: number | null): string => (ms === null ? strings.trust.noneYet : durationOf(ms))
  const row = (label: string, value: (figures: AsRead.ChannelAgentFigures) => string) =>
    [label, value(period.current), value(period.previous)] as const
  const labels = strings.channelAgent
  return {
    kind: 'figures',
    title: labels.figuresTitle({ channel }),
    intro: labels.figuresIntro({ channel }),
    headings: [
      strings.trust.what,
      strings.trust.lastDays({ days: period.days }),
      strings.trust.before({ days: period.days }),
    ],
    rows: [
      row(labels.figuresWritten, (figures) => count(figures.written)),
      row(labels.figuresAsWritten, (figures) => count(figures.sentAsWritten)),
      row(labels.figuresEdited, (figures) => count(figures.sentAfterEdits)),
      row(labels.figuresDiscarded, (figures) => count(figures.discarded)),
      row(labels.figuresMedian, (figures) => time(figures.medianDecisionMs)),
      row(labels.figuresQuick, (figures) => count(figures.quickApprovals)),
    ],
    waiting: labels.figuresWaiting({ count: report.waiting }),
    approvalsTitle: labels.figuresApprovalsTitle({ days: period.days }),
    approvalsHint: labels.figuresApprovalsHint,
    approvals: period.current.approvals.map((manager) =>
      labels.figuresApproved({ name: manager.name, count: manager.approved }),
    ),
    footnote: labels.figuresQuickExplained({ seconds: report.quickApprovalSeconds }),
  }
}

/** Null when the person does not manage the channel, so the section is not there at all. */
export type ChannelAgentFiguresState = AsRead.ChannelAgentReport | 'loading' | 'failed' | null

export type ChannelAgentFiguresModel =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly text: string }
  | {
      readonly kind: 'figures'
      readonly title: string
      readonly intro: string
      readonly headings: readonly [string, string, string]
      readonly rows: ReadonlyArray<readonly [string, string, string]>
      readonly waiting: string
      readonly approvalsTitle: string
      readonly approvalsHint: string
      readonly approvals: ReadonlyArray<string>
      readonly footnote: string
    }
