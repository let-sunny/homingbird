import type { Clock } from '@homingbird/kernel'
import { type Lifetime, h, later, replaceChildren } from '@homingbird/ui'
import type { Page } from '../browser-page.ts'
import type { Recording } from '../inspector/recording.ts'
import type { InspectorWords } from '../inspector/words.ts'
import {
  type InspectorModel,
  LIST_COLUMNS,
  type ListShown,
  TIMELINE_KINDS,
  type TimelineFilter,
  type TimelineKind,
  inspectorModel,
} from '../models/inspector.ts'
import { button, field } from './parts.ts'

/**
 * The developers' panel. The rows of its table are drawn once, since a page's lists are always the same
 * ones, and only their words follow the recording, so the focus stays where it is.
 */
export const inspectorPanel = (life: Lifetime, parts: InspectorParts): HTMLDetailsElement => {
  const { recording, words, page, clock } = parts
  let filter: TimelineFilter = { kind: 'all', name: '', failuresOnly: false }
  let isWaiting = false
  let stopTicking = (): void => {}
  const model = (): InspectorModel => inspectorModel(recording.snapshot(), filter, words, parts.locale)
  const draw = (): void => {
    isWaiting = false
    const shown = model()
    summary.textContent = shown.summary
    if (!panel.hasAttribute('open')) return
    shown.lists.forEach((list, at) => rows[at]!.show(list))
    replaceChildren(timeline, timelineLines(shown, words))
  }
  const drawSoon = (): void => {
    if (isWaiting) return
    isWaiting = true
    page.nextFrame(draw)
  }
  const follow = (): void => {
    stopTicking()
    draw()
    if (panel.hasAttribute('open')) stopTicking = later(clock, AGE_TICK_MS, follow)
  }
  const show = (change: Partial<TimelineFilter>): void => {
    filter = { ...filter, ...change }
    draw()
  }
  const first = model()
  const summary = h('summary', {}, first.summary)
  const rows = first.lists.map((list) => listRow(parts, list.path))
  const timeline = h('ol', { class: 'inspector-timeline', tabindex: '0', 'aria-label': words.timelineTitle })
  const panel = h(
    'details',
    { class: 'inspector', on: { toggle: follow } },
    summary,
    h(
      'div',
      { class: 'inspector-body' },
      listsTable(
        words,
        rows.map((row) => row.element),
      ),
      filterControls(words, show),
      timeline,
      h(
        'div',
        { class: 'inspector-actions' },
        button(words.exportIt, () => exportRecording(parts)),
        button(words.clear, () => recording.clear()),
        button(words.turnOff, () => parts.turnOff()),
      ),
    ),
  )
  life.add(recording.changes.subscribe(drawSoon))
  life.add(() => stopTicking())
  return panel
}

export interface InspectorParts {
  readonly recording: Recording
  readonly words: InspectorWords
  readonly locale: string
  readonly page: Pick<Page, 'nextFrame' | 'download'>
  readonly clock: Clock
  /** Whether the list can be asked for from here. */
  readonly canAsk: (path: string) => boolean
  readonly again: (path: string) => void
  readonly invalidate: (path: string) => void
  readonly turnOff: () => void
}

const listRow = (parts: InspectorParts, path: string) => {
  const { words } = parts
  const disabled = !parts.canAsk(path)
  const cells = LIST_COLUMNS.map((column) => ({ column, cell: h('td') }))
  const element = h(
    'tr',
    {},
    h('th', { scope: 'row' }, path),
    h(
      'td',
      { class: 'inspector-row-actions' },
      button(words.again, () => parts.again(path), {
        disabled,
        'aria-label': words.againFor({ list: path }),
      }),
      button(words.invalidate, () => parts.invalidate(path), {
        disabled,
        'aria-label': words.invalidateFor({ list: path }),
      }),
    ),
    cells.map(({ cell }) => cell),
  )
  const show = (list: ListShown): void => {
    element.classList.toggle('is-failed', list.isFailed)
    for (const { column, cell } of cells) cell.textContent = list.cells[column]
  }
  return { element, show }
}

const listsTable = (words: InspectorWords, rows: ReadonlyArray<HTMLElement>): HTMLElement => {
  const { list, actions } = words.columns
  const titles = [list, actions, ...LIST_COLUMNS.map((column) => words.columns[column])]
  return h(
    'div',
    { class: 'inspector-lists', role: 'region', tabindex: '0', 'aria-label': words.listsTitle },
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          titles.map((title) => h('th', { scope: 'col' }, title)),
        ),
      ),
      h('tbody', {}, rows),
    ),
  )
}

const timelineLines = ({ timeline }: InspectorModel, words: InspectorWords): HTMLElement[] =>
  timeline.length === 0
    ? [h('li', {}, words.nothing)]
    : timeline.map((line) =>
        h(
          'li',
          { class: line.isFailed ? 'is-failed' : '' },
          h('span', { class: 'inspector-at' }, line.at),
          h('span', { class: 'inspector-name' }, line.name),
          h('span', {}, line.what),
        ),
      )

const filterControls = (
  words: InspectorWords,
  show: (change: Partial<TimelineFilter>) => void,
): HTMLElement => {
  const kind = h(
    'select',
    { on: { change: () => show({ kind: kind.value as TimelineKind }) } },
    TIMELINE_KINDS.map((one) => h('option', { value: one }, words.kinds[one])),
  )
  const name = h('input', {
    type: 'search',
    autocomplete: 'off',
    on: { input: () => show({ name: name.value }) },
  })
  const failures = h('input', {
    type: 'checkbox',
    on: { change: () => show({ failuresOnly: failures.checked }) },
  })
  return h(
    'div',
    { class: 'inspector-filters' },
    field(words.kindFilter, kind),
    field(words.nameFilter, name),
    h('label', { class: 'inspector-check' }, failures, h('span', {}, words.failuresOnly)),
  )
}

const exportRecording = ({ recording, page }: InspectorParts): void =>
  page.download({
    text: JSON.stringify(recording.snapshot(), null, 2),
    mediaType: 'application/json',
    filename: 'homingbird-loads.json',
  })

/** How often the ages are counted on while the panel is open. */
const AGE_TICK_MS = 1000
