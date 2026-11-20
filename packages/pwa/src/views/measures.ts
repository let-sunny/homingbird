import { h } from '@homingbird/ui'
import { type MeasuresModel, measuresModel } from '../models/measures.ts'
import type { ViewContext } from './context.ts'
import { page } from './parts.ts'

/** "What is measured": a page every member can open. */
export const measuresView = (context: ViewContext): HTMLElement =>
  renderMeasures(measuresModel(context.state.serverInfo.get()))

export const renderMeasures = (model: MeasuresModel): HTMLElement =>
  page(
    model.title,
    h('p', {}, model.intro),
    model.nothing !== null && h('p', {}, model.nothing),
    model.sections.map((section) =>
      h(
        'section',
        { class: 'measured-section', 'aria-labelledby': section.id },
        h('h2', { id: section.id }, section.title),
        h(
          'ul',
          {},
          section.lines.map((line) => h('li', {}, line)),
        ),
        h('p', { class: 'trust-footnote' }, section.privacy),
      ),
    ),
  )
