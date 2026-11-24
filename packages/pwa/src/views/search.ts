import type { AsRead } from '@homingbird/protocol'
import { type Child, type Lifetime, h, later, region, signal } from '@homingbird/ui'
import { type NameMatch, type NameMatches, nameMatches } from '../models/name-matches.ts'
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
    region(life, [searched, state.directory, state.channels, state.conversations], () =>
      renderNames(
        context,
        nameMatches({
          query: searched.get(),
          viewerId: me.member.id,
          directory: state.directory.get(),
          channels: state.channels.get(),
          conversations: state.conversations.get(),
          members: state.members.get(),
        }),
      ),
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

/** People and channels whose name holds what was searched for, above the notes that contain it. */
const renderNames = (context: ViewContext, found: NameMatches): Child =>
  [
    { key: 'people', title: strings.navPeople, matches: found.people },
    { key: 'channels', title: strings.channels, matches: found.channels },
  ]
    .filter((group) => group.matches.length > 0)
    .map((group) =>
      h(
        'section',
        { class: 'search-names', data: { kind: group.key } },
        h('h2', {}, group.title),
        h(
          'ul',
          { class: 'results' },
          group.matches.map((match) => h('li', {}, nameLink(context, match))),
        ),
      ),
    )

const nameLink = (context: ViewContext, match: NameMatch): HTMLElement => {
  const line = [
    h('span', { class: 'result-head' }, h('strong', {}, match.label)),
    match.detail !== null && h('span', { class: 'result-detail' }, match.detail),
  ]
  const { target } = match
  return target.kind === 'href'
    ? h('a', { class: 'result', href: target.href }, line)
    : h(
        'button',
        {
          type: 'button',
          class: 'result',
          on: { click: () => context.actions.openConversationWith(target.memberId) },
        },
        line,
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
