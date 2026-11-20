import { h } from '@homingbird/ui'
import type { YourWeekModel } from '../models/your-week.ts'

/** The person's own week of notes, at the top of How it is doing. */
export const renderYourWeek = (model: YourWeekModel | null): HTMLElement | null =>
  model === null
    ? null
    : h(
        'section',
        { class: 'your-week', 'aria-labelledby': 'your-week' },
        h('h3', { id: 'your-week' }, model.title),
        h('p', { class: 'trust-footnote' }, model.intro),
        h(
          'dl',
          { class: 'your-week-figures' },
          model.rows.map((row) => h('div', {}, h('dt', {}, row.label), h('dd', {}, row.value))),
        ),
        h('p', { class: 'trust-footnote' }, model.footnote),
      )
