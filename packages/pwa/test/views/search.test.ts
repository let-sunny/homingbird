import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { searchView } from '../../src/views/search.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { me, note } from '../support/fixtures.ts'

usingFakeDom()

describe('searchView', () => {
  it('prompts until the person searches, then shows what was found', () => {
    const { context, called, page } = testContext()
    const shown = searchView(context, lifetime(), me(), '')
    expect(textOf(shown)).toContain(strings.searchPrompt)
    fire.type(getByRole(shown, 'searchbox'), ' release ')
    fire.submit(getByRole(shown, 'search'))
    expect(page.visited).toEqual(['address #/search?q=release'])
    expect(textOf(shown)).toContain(strings.loading)
    const [search] = called('searchNotes')
    expect(search!.args).toEqual(['release'])
    search!.then!.done!([note('n1', { body: 'The release is Friday.' })])
    expect(getByRole(shown, 'link', { name: /The release is Friday/ }).getAttribute('href')).toContain('#/c/')
    expect([...shown.querySelectorAll('.result mark')].map((mark) => mark.textContent)).toEqual(['release'])
    expect(getByRole(shown, 'searchbox').getAttribute('aria-label')).toBe(strings.search)
    expect(shown.querySelector('.search-form label')).toBeNull()
  })

  it('searches what the address asked for at once, and shows nothing found or a failure as a prompt', () => {
    const { context, called } = testContext()
    const shown = searchView(context, lifetime(), me(), 'tone')
    called('searchNotes')[0]!.then!.done!([])
    expect(textOf(shown)).toContain(strings.searchEmpty)
    fire.submit(getByRole(shown, 'search'))
    called('searchNotes')[1]!.then!.failed!({ _tag: 'Unavailable', message: 'down' })
    expect(textOf(shown)).toContain(strings.searchPrompt)
    fire.type(getByRole(shown, 'searchbox'), '')
    fire.submit(getByRole(shown, 'search'))
    expect(called('searchNotes')).toHaveLength(2)
  })

  it('puts the cursor in the field on arriving with nothing searched yet', () => {
    const empty = testContext()
    const shown = searchView(empty.context, lifetime(), me(), '')
    document.body.append(shown)
    empty.page.runFrames()
    expect(document.activeElement).toBe(getByRole(shown, 'searchbox'))
    const asked = testContext()
    const answered = searchView(asked.context, lifetime(), me(), 'tone')
    document.body.append(answered)
    asked.page.runFrames()
    expect(document.activeElement).not.toBe(getByRole(answered, 'searchbox'))
  })
})
