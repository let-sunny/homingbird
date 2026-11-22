import { lifetime } from '@homingbird/ui'
import { fire, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { searchView } from '../../src/views/search.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { BEN, CY, channel, entry, me, note } from '../support/fixtures.ts'

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

  it('searches again once the person pauses typing, not for every key, and not twice for one query', async () => {
    const { context, called, page, clock } = testContext()
    const life = lifetime()
    const shown = searchView(context, life, me(), '')
    const field = getByRole(shown, 'searchbox')
    fire.type(field, 'rel')
    await clock.advance(200)
    fire.type(field, 'release')
    await clock.advance(399)
    expect(called('searchNotes')).toHaveLength(0)
    await clock.advance(1)
    expect(called('searchNotes').map((call) => call.args)).toEqual([['release']])
    expect(page.visited).toEqual(['address #/search?q=release'])
    fire.type(field, 'release ')
    await clock.advance(400)
    expect(called('searchNotes')).toHaveLength(1)
    fire.type(field, 'releases')
    fire.submit(getByRole(shown, 'search'))
    await clock.advance(400)
    expect(called('searchNotes')).toHaveLength(2)
    fire.type(field, 'tone')
    life.end()
    await clock.advance(400)
    expect(called('searchNotes')).toHaveLength(2)
  })

  it('puts the focus in the field once it is on the page', () => {
    const { context, page } = testContext()
    const shown = searchView(context, lifetime(), me(), '')
    page.runFrames()
    expect(document.activeElement).not.toBe(getByRole(shown, 'searchbox'))
    const again = mount(searchView(context, lifetime(), me(), ''))
    page.runFrames()
    expect(document.activeElement).toBe(getByRole(again, 'searchbox'))
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

  it('shows the people and channels whose name holds what was searched for, above the notes', () => {
    const { context, called } = testContext()
    context.state.directory.set([entry(BEN, 'Ben Rivers'), entry(CY, 'Cy')])
    context.state.channels.set([
      channel('river-ops', { joined: true }),
      channel('river-secret', { visibility: 'private' }),
    ])
    const shown = searchView(context, lifetime(), me(), 'river')
    const people = shown.querySelector('.search-names[data-kind="people"]')!
    expect(textOf(people)).toContain(strings.navPeople)
    getByRole(people, 'button', { name: /Ben Rivers/ }).click()
    expect(called('openConversationWith').map((call) => call.args)).toEqual([[BEN]])
    const channels = shown.querySelector('.search-names[data-kind="channels"]')!
    expect(getByRole(channels, 'link', { name: /#river-ops/ }).getAttribute('href')).toBe(
      `#/c/${channel('river-ops').conversationId}`,
    )
    expect(textOf(shown)).not.toContain('#river-secret')
    expect(searchView(context, lifetime(), me(), '').querySelector('.search-names')).toBeNull()
  })
})
