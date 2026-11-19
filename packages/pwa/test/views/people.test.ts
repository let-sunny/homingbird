import { lifetime } from '@homingbird/ui'
import { allByRole, fire, getByRole, getByText, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { peopleView } from '../../src/views/people.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, CY, channel, entry, me } from '../support/fixtures.ts'

usingFakeDom()

const loaded = (
  context: ReturnType<typeof testContext>['context'],
  directory: ReturnType<typeof entry>[],
) => {
  context.state.directory.set(directory)
  context.state.directoryLoaded.set(true)
}

describe('peopleView', () => {
  it('loads people and channels, and offers a retry when people could not load', () => {
    const { context, called } = testContext()
    const shown = peopleView(context, lifetime(), me())
    expect(called('loadKnownChannels')).toHaveLength(1)
    expect(textOf(shown)).toContain(strings.loading)
    called('loadPeople')[0]!.then!.failed!({ _tag: 'Unavailable', message: 'down' })
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(called('loadPeople')).toHaveLength(2)
    expect(textOf(shown)).toContain(strings.loading)
  })

  it('lists people, agents awake first, and filters them by what is typed and the channel chosen', () => {
    const { context } = testContext()
    const shown = peopleView(context, lifetime(), me({ contactMode: 'contacts' }))
    expect(textOf(shown)).toContain(strings.contactsModeNotice)
    context.state.channels.set([channel('billing')])
    loaded(context, [
      entry(CY, 'Cy'),
      entry(BEN, 'Ben', { presence: { humanOnline: false, agentOnline: true }, channels: ['billing'] }),
    ])
    expect(
      allByRole(shown, 'listitem')
        .filter((item) => item.classList.contains('person'))
        .map((item) => item.querySelector('strong')!.textContent),
    ).toEqual(['Ben', 'Cy'])
    fire.select(getByRole(shown, 'combobox', { name: strings.peopleChannelFilter }), 'billing')
    expect(shown.querySelectorAll('.person')).toHaveLength(1)
    fire.select(getByRole(shown, 'combobox', { name: strings.peopleChannelFilter }), '')
    fire.type(getByRole(shown, 'searchbox'), 'nobody')
    expect(textOf(shown)).toContain(strings.noPeople)
  })

  it('offers what each relation allows, and asks for it', () => {
    const { context, called } = testContext()
    const shown = peopleView(context, lifetime(), me({ contactMode: 'contacts' }))
    loaded(context, [
      entry(ANA, 'Ana', { relation: 'self' }),
      entry(BEN, 'Ben', { relation: 'request_received', agentIntroduction: ['Answers billing.'] }),
      entry(CY, 'Cy', { relation: 'blocked' }),
    ])
    const ben = shown.querySelector(`[data-member-id="${BEN}"]`)!
    expect(getByText(ben, 'Answers billing.')).toBeTruthy()
    for (const label of [strings.message, strings.acceptContact, strings.declineRequest, strings.block])
      getByRole(ben, 'button', { name: label }).click()
    getByRole(shown.querySelector(`[data-member-id="${CY}"]`)!, 'button', { name: strings.unblock }).click()
    expect(shown.querySelector(`[data-member-id="${ANA}"] .person-actions`)!.children).toHaveLength(0)
    const asked = [
      'openConversationWith',
      'acceptContact',
      'removeContact',
      'blockMember',
      'unblockMember',
    ].map((name) => called(name).map((call) => call.args[0]))
    expect(asked).toEqual([[BEN], [BEN], [BEN], [BEN], [CY]])
  })

  it('offers to add, cancel or remove a contact, each for the right person', () => {
    const { context, called } = testContext()
    const shown = peopleView(context, lifetime(), me({ contactMode: 'contacts' }))
    loaded(context, [
      entry(ANA, 'Ana', { relation: 'none' }),
      entry(BEN, 'Ben', { relation: 'request_sent' }),
      entry(CY, 'Cy', { relation: 'contact' }),
    ])
    getByRole(shown, 'button', { name: strings.addContact }).click()
    getByRole(shown, 'button', { name: strings.cancelRequest }).click()
    getByRole(shown, 'button', { name: strings.removeContact }).click()
    expect(called('requestContact').map((call) => call.args[0])).toEqual([ANA])
    expect(called('removeContact').map((call) => call.args[0])).toEqual([BEN, CY])
  })
})
