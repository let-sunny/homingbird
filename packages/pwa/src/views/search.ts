import type { AsRead } from '@homingbird/protocol'
import { type Lifetime, h, later, region, signal } from '@homingbird/ui'
import { type SearchModel, searchModel } from '../models/search.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { empty, emptyWithPip, loading, page, timeLabel } from './parts.ts'

/** Search: a field, and the notes found for what was typed, searched again once the person pauses. */
export const searchView = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
  initialQuery: string,
): HTMLElement => {
  const { state, actions } = context
  const results = signal<ReadonlyArray<AsRead.Note> | 'searching' | null>(null)
  const searched = signal('')
  const run = (query: string): void => {
    searched.set(query)
    if (query === '') {
      results.set(null)
      return
    }
    results.set('searching')
    actions.searchNotes(query, { done: (notes) => results.set(notes), failed: () => results.set(null) })
  }
  run(initialQuery)
  const input = h('input', {
    type: 'search',
    name: 'q',
    placeholder: strings.searchPlaceholder,
    'aria-label': strings.search,
    value: initialQuery,
  })
  if (initialQuery === '') context.page.nextFrame(() => input.focus())
  let cancelPause = (): void => {}
  const submit = (): void => {
    cancelPause()
    const query = input.value.trim()
    context.page.replaceAddress(hrefFor({ name: 'search', query }))
    run(query)
  }
  input.addEventListener('input', () => {
    cancelPause()
    cancelPause = later(context.clock, TYPING_PAUSE_MS, () => {
      if (input.value.trim() !== searched.get()) submit()
    })
  })
  life.add(() => cancelPause())
  return page(
    strings.search,
    h(
      'form',
      {
        class: 'search-form',
        role: 'search',
        on: {
          submit: (event) => {
            event.preventDefault()
            submit()
          },
        },
      },
      input,
      h('button', { type: 'submit', class: 'primary' }, strings.navSearch),
    ),
    region(life, [results, searched, state.members, state.conversations], () =>
      renderResults(
        searchModel({
          results: results.get(),
          conversations: state.conversations.get(),
          members: state.members.get(),
          viewerId: me.member.id,
          now: context.clock.now(),
          query: searched.get(),
        }),
      ),
    ),
  )
}

const renderResults = (model: SearchModel): HTMLElement => {
  switch (model.kind) {
    case 'prompt':
      return emptyWithPip('searching', model.text)
    case 'searching':
      return loading()
    case 'empty':
      return empty(model.text)
    case 'results':
      return h(
        'ul',
        { class: 'results' },
        model.rows.map((row) =>
          h(
            'li',
            {},
            h(
              'a',
              { class: 'result', href: row.href },
              h(
                'span',
                { class: 'result-head' },
                h('strong', {}, row.author),
                row.title !== null && h('span', {}, row.title),
                timeLabel(row.time),
              ),
              h(
                'span',
                { class: 'note-body' },
                row.excerpt.map((part) => (part.isMatch ? h('mark', {}, part.text) : part.text)),
              ),
            ),
          ),
        ),
      )
  }
}

const TYPING_PAUSE_MS = 400
