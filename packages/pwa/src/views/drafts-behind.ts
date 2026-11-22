import { h } from '@homingbird/ui'
import type { DraftsBehind } from '../models/drafts-behind.ts'
import type { ViewContext } from './context.ts'
import { timeLabel } from './parts.ts'
import { teachFromMiss } from './teaching.ts'

/** The drafts behind the figures, one folded list per count, each row opening its conversation or teaching. */
export const renderDraftsBehind = (context: ViewContext, model: DraftsBehind | null): HTMLElement | null =>
  model === null
    ? null
    : h(
        'section',
        { class: 'trust-section drafts-behind', 'aria-labelledby': 'drafts-behind' },
        h('h3', { id: 'drafts-behind' }, model.title),
        h('p', { class: 'trust-footnote' }, model.intro),
        model.groups.map((group) =>
          h(
            'details',
            { class: 'drafts-behind-group', data: { outcome: group.outcome } },
            h('summary', {}, group.title),
            h(
              'ul',
              { class: 'drafts-behind-list' },
              group.rows.map((row) =>
                h(
                  'li',
                  { class: 'drafts-behind-row', data: { key: row.key } },
                  h('span', { class: 'drafts-behind-place' }, row.place),
                  timeLabel(row.time),
                  h('a', { href: row.href }, row.open),
                  teachFromMiss(context, row.teach, row.seed, 'link teach-from-miss'),
                ),
              ),
            ),
          ),
        ),
      )
