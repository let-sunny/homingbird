import { DEFAULT_DEBATE_LIMITS } from '@homingbird/protocol'
import { lifetime } from '@homingbird/ui'
import { fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { debatesView, limitFields, limitsTypedIn } from '../../src/views/debates.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, entry, me, summary } from '../support/fixtures.ts'
import { setLoad, setWorkspace } from '../support/resource-load.ts'

usingFakeDom()

describe('debatesView', () => {
  it('loads the flocks, says when there are none, and lists them with their stage', () => {
    const { context, called } = testContext()
    const shown = debatesView(context, lifetime(), me())
    expect(called('openDebateList')).toHaveLength(1)
    expect(textOf(shown)).toContain(strings.checking.flocks)
    expect(textOf(shown)).not.toContain(strings.debates.empty)
    setLoad(context.state.debates, { loaded: true })
    expect(textOf(shown)).toContain(strings.debates.empty)
    context.state.debates.set([summary({ participantIds: [ANA, BEN], turnCount: 2, visibility: 'private' })])
    expect(textOf(shown)).toContain(strings.debates.stage['waiting-for-agent'])
    expect(textOf(shown)).toContain(strings.debates.private)
    context.state.directory.set([entry(BEN, 'Ben', { presence: { humanOnline: false, agentOnline: true } })])
    expect(textOf(shown)).toContain(strings.debates.stage.debating)
  })

  it('says it is taking too long or failed in place of the list, and Try again loads the list again', () => {
    const { context, called } = testContext()
    const shown = mount(debatesView(context, lifetime(), me()))
    setLoad(context.state.debates, { step: 'long' })
    expect(textOf(shown)).toContain(strings.firstLoad.tooLong)
    expect(textOf(shown)).not.toContain(strings.checking.flocks)
    expect(textOf(shown)).not.toContain(strings.debates.empty)
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(called('askDebateListAgain')).toHaveLength(1)
    setLoad(context.state.debates, { step: 'failed' })
    expect(textOf(shown)).toContain(strings.loadFailed)
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(called('askDebateListAgain')).toHaveLength(2)
    setLoad(context.state.debates, { loaded: true })
    expect(textOf(shown)).toContain(strings.debates.empty)
    expect(queryByRole(shown, 'button', { name: strings.tryAgain })).toBeNull()
  })

  it('says nothing of its own while the line above offers to try again', () => {
    const { context, called } = testContext()
    const shown = mount(debatesView(context, lifetime(), me()))
    setLoad(context.state.debates, { step: 'failed' })
    for (const workspace of ['long', 'failed'] as const) {
      setWorkspace(context.state, workspace)
      expect(textOf(shown)).not.toContain(strings.loadFailed)
      expect(textOf(shown)).not.toContain(strings.debates.empty)
      expect(queryByRole(shown, 'button', { name: strings.tryAgain })).toBeNull()
    }
  })

  it('opens a flock for a question with the colleagues invited and the limits typed', () => {
    const { context, called, page } = testContext()
    mount(dialogHost())
    context.state.directory.set([entry(ANA, 'Ana'), entry(BEN, 'Ben')])
    const shown = mount(debatesView(context, lifetime(), me()))
    getByRole(shown, 'button', { name: strings.debates.newRoom }).click()
    const dialog = document.getElementById('dialog')!
    fire.type(getByRole(dialog, 'textbox', { name: strings.debates.question }), ' Ship? ')
    getByRole(dialog, 'radio', { name: strings.debates.visibilityPrivate }).click()
    const invite = getByRole(dialog, 'combobox', { name: strings.debates.invite })
    fire.type(invite, 'be')
    fire.key(invite, 'Enter')
    expect(textOf(dialog.querySelector('.people-picker-chips')!)).toContain('Ben')
    const defaults = dialog.querySelector('details.debate-default-limits') as HTMLDetailsElement
    expect([defaults.open, defaults.querySelector('summary')!.textContent]).toEqual([
      false,
      strings.debates.limitsDefaults,
    ])
    fire.submit(dialog.querySelector('form')!)
    const [create] = called('createDebate')
    expect(create!.args[0]).toEqual({
      question: 'Ship?',
      visibility: 'private',
      limits: DEFAULT_DEBATE_LIMITS,
      memberIds: [BEN],
    })
    create!.then!.done!({ id: 'debate_1' })
    expect(page.visited).toEqual(['go #/debate/debate_1'])
  })

  it('refuses limits that cannot work, and invites nobody when there is nobody else', () => {
    const { context, called } = testContext()
    mount(dialogHost())
    const shown = mount(debatesView(context, lifetime(), me()))
    getByRole(shown, 'button', { name: strings.debates.newRoom }).click()
    const dialog = document.getElementById('dialog')!
    expect(dialog.querySelector('.debate-invite')).toBeNull()
    fire.type(dialog.querySelector('input[name="turnsPerAgent"]')!, '20')
    fire.type(dialog.querySelector('input[name="totalTurns"]')!, '2')
    fire.submit(dialog.querySelector('form')!)
    expect(context.state.notice.get()?.kind).toBe('error')
    expect(called('createDebate')).toHaveLength(0)
  })
})

describe('the limit fields', () => {
  it('read back what they show, and an empty form gives the defaults', () => {
    const form = document.createElement('form')
    form.append(limitFields(DEFAULT_DEBATE_LIMITS))
    expect(limitsTypedIn(form)).toEqual({ limits: DEFAULT_DEBATE_LIMITS })
    expect(limitsTypedIn(document.createElement('form'))).toEqual({ limits: DEFAULT_DEBATE_LIMITS })
  })
})
