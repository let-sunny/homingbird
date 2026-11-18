import { Task as T } from '@homingbird/kernel'
import type { Me, Note } from '@homingbird/protocol'
import { type Lifetime, h, region, signal } from '@homingbird/ui'
import { api, launch } from '../actions.ts'
import { hrefFor } from '../routes.ts'
import { conversations, members } from '../state.ts'
import { strings } from '../strings.ts'
import { conversationTitle, excerpt } from '../thread.ts'
import { emptyWithPip, field, page, timeLabel } from './parts.ts'

export const searchView = (life: Lifetime, me: Me, initialQuery: string): HTMLElement => {
  const results = signal<ReadonlyArray<Note> | null>(null)
  const run = (query: string): void => {
    if (query === '') {
      results.set(null)
      return
    }
    launch(
      T.map((found: { notes: ReadonlyArray<Note> }) => results.set(found.notes))(
        api['search.notes']({ query: { q: query } }),
      ),
    )
  }
  const input = h('input', {
    type: 'search',
    name: 'q',
    placeholder: strings.searchPlaceholder,
    value: initialQuery,
  })
  run(initialQuery)
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
            history.replaceState(null, '', hrefFor({ name: 'search', query: input.value.trim() }))
            run(input.value.trim())
          },
        },
      },
      field(strings.search, input),
      h('button', { type: 'submit', class: 'primary' }, strings.navSearch),
    ),
    region(life, [results, members], () => {
      const found = results.get()
      if (found === null) return emptyWithPip('searching', 4, strings.searchPrompt)
      if (found.length === 0) return emptyWithPip('searching', 4, strings.searchEmpty)
      return h(
        'ul',
        { class: 'results' },
        found.map((note) => resultRow(note, me)),
      )
    }),
  )
}

const resultRow = (note: Note, me: Me): HTMLElement => {
  const conversation = conversations.get().find((candidate) => candidate.id === note.conversationId)
  const title =
    conversation === undefined
      ? ''
      : conversationTitle(conversation, members.get(), me.member.id, strings.formerMember)
  return h(
    'li',
    {},
    h(
      'a',
      { class: 'result', href: hrefFor({ name: 'conversation', id: note.conversationId }) },
      h(
        'span',
        { class: 'result-head' },
        h('strong', {}, members.get().get(note.authorId)?.name ?? strings.formerMember),
        title !== '' && h('span', {}, title),
        timeLabel(note.sentAt ?? note.createdAt),
      ),
      h('span', { class: 'note-body' }, excerpt(note.body, 240)),
    ),
  )
}
