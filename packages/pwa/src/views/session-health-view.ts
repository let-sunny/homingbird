import type { AsRead, LatestSession } from '@homingbird/protocol'
import { h } from '@homingbird/ui'
import { type SessionTable, freshSessionLines, sessionsModel } from '../models/sessions.ts'

/** How it is doing, by session, or nothing until a session-age bucket has a decided draft. */
export const sessionSection = (report: AsRead.AgentReport): HTMLElement | null => {
  const model = sessionsModel(report)
  if (model === null) return null
  return h(
    'section',
    { class: 'trust-section', 'aria-labelledby': 'trust-sessions' },
    h('h3', { id: 'trust-sessions' }, model.title),
    h('p', { class: 'trust-footnote' }, model.intro),
    model.tables.map(bucketTable),
    h('p', { class: 'trust-footnote' }, model.footnote),
  )
}

/** On Connection: a suggestion to start afresh for each desk that is due one. */
export const freshSessionSuggestions = (latest: ReadonlyArray<LatestSession>): HTMLElement | null => {
  const lines = freshSessionLines(latest)
  if (lines.length === 0) return null
  return h(
    'div',
    { class: 'flow-warning fresh-session', role: 'note' },
    lines.map((line) => h('p', {}, line)),
  )
}

const bucketTable = (table: SessionTable): HTMLElement =>
  h(
    'div',
    { class: 'table-scroll trust-table-scroll' },
    h(
      'table',
      { class: 'trust-table' },
      h('caption', {}, table.caption),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          table.headings.map((heading) => h('th', { scope: 'col' }, heading)),
        ),
      ),
      h(
        'tbody',
        {},
        table.rows.map(([name, ...cells]) =>
          h(
            'tr',
            {},
            h('th', { scope: 'row' }, name),
            cells.map((cell) => h('td', {}, cell)),
          ),
        ),
      ),
    ),
  )
