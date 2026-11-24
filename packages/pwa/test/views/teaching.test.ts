import type { AsRead } from '@homingbird/protocol'
import { h, lifetime } from '@homingbird/ui'
import { fire, getByRole, queryByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import type { ViewContext } from '../../src/views/context.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { pageData } from '../../src/views/page-data.ts'
import { appliedMarkers, chancesIn, taughtSection } from '../../src/views/teaching.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ROOM, channel, draft, principle, serverInfo, taught } from '../support/fixtures.ts'
import { setLoad, setWorkspace } from '../support/resource-load.ts'

usingFakeDom()

const sectionOf = (context: ViewContext) =>
  taughtSection(context, lifetime(), pageData(context.state, context.state.taught).wait)

const offer = {
  id: 'offer_aaaaaaaaaaaa',
  kind: 'edit',
  noteId: 'note_aaaaaaaaaaaa',
  conversationId: ROOM,
  place: null,
  suggestion: null,
  createdAt: 1,
} as AsRead.PrincipleOffer

describe('taughtSection', () => {
  it('loads the principles, and says once when they could not load, with a way to try again', () => {
    const { context, called } = testContext()
    const shown = sectionOf(context)
    expect(called('refreshPrinciples')).toHaveLength(1)
    expect(textOf(shown)).toBe(strings.loading)
    setLoad(context.state.taught, { step: 'failed' })
    expect(textOf(shown)).toContain(strings.loadFailed)
    getByRole(shown, 'button', { name: strings.tryAgain }).click()
    expect(called('askAgain')).toHaveLength(1)
  })

  it('leaves it to the line above the lists to say a failure it already tells', () => {
    const { context } = testContext()
    const shown = sectionOf(context)
    setWorkspace(context.state, 'failed')
    setLoad(context.state.taught, { step: 'failed' })
    expect(textOf(shown)).toBe('')
  })

  it('keeps the principles shown when asking for them again fails for a moment', () => {
    const { context } = testContext()
    const shown = sectionOf(context)
    context.state.taught.set(taught({ achievements: ['first_principle'] }))
    setLoad(context.state.taught, { loaded: true, step: 'failed' })
    expect(textOf(shown)).toContain(strings.teach.achievements.first_principle)
    expect(textOf(shown)).not.toContain(strings.loadFailed)
  })

  it('keeps the principle being typed, and the place chosen for it, while the channels change', () => {
    const { context } = testContext()
    context.state.channels.set([channel('billing', { joined: true })])
    const shown = mount(sectionOf(context))
    context.state.taught.set(taught())
    const topic = getByRole(shown, 'textbox', { name: strings.teach.topic }) as HTMLInputElement
    const place = shown.querySelector<HTMLSelectElement>('.todo-add select[name="place"]')!
    fire.type(topic, 'Refunds')
    place.value = 'billing'
    context.state.channels.set([
      channel('billing', { joined: true, memberCount: 9 }),
      channel('ops', { joined: true }),
    ])
    expect(getByRole(shown, 'textbox', { name: strings.teach.topic })).toBe(topic)
    expect(topic.value).toBe('Refunds')
    expect(place.value).toBe('billing')
    expect([...place.querySelectorAll('option')].map((option) => option.value)).toEqual([
      '',
      'billing',
      'ops',
    ])
  })

  it('invites a first principle, and adds one from the list with the place chosen', () => {
    const { context, called } = testContext()
    context.state.channels.set([channel('billing', { joined: true })])
    const shown = mount(sectionOf(context))
    context.state.taught.set(taught({ achievements: ['first_principle'] }))
    expect(textOf(shown)).toContain(strings.teach.empty)
    expect(textOf(shown)).toContain(strings.teach.achievements.first_principle)
    const add = getByRole(shown, 'group', { name: strings.teach.addLabel })
    fire.type(getByRole(add, 'textbox', { name: strings.teach.topic }), 'Dates')
    fire.type(getByRole(add, 'textbox', { name: strings.teach.rule }), 'Check RELEASES.md first.')
    fire.select(
      getByRole(shown, 'combobox', { name: `${strings.teach.place} ${strings.teach.placeHint}` }),
      'billing',
    )
    getByRole(add, 'button', { name: strings.teach.addLabel }).click()
    const [save] = called('savePrinciple')
    expect(save!.args).toEqual([
      { kind: 'rule', topic: 'Dates', rule: 'Check RELEASES.md first.', source: null, place: 'billing' },
    ])
    save!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.teach.saved })
  })

  it('saves an answer from the list once the person chooses Answer, and warns as for an answer', () => {
    const { context, called } = testContext()
    const shown = mount(sectionOf(context))
    context.state.taught.set(taught())
    const add = getByRole(shown, 'group', { name: strings.teach.addLabel })
    fire.type(getByRole(add, 'textbox', { name: strings.teach.topic }), 'Release calendar')
    fire.type(getByRole(add, 'textbox', { name: strings.teach.rule }), 'The calendar is the infra wiki page')
    expect(textOf(add)).toContain(strings.teach.advice.stored_answer)
    const answer = getByRole(add, 'radio', { name: strings.teach.kindBadge.answer }) as HTMLInputElement
    answer.checked = true
    fire.event(answer, 'change')
    expect(textOf(add)).not.toContain(strings.teach.advice.stored_answer)
    const text = getByRole(add, 'textbox', { name: strings.teach.answer }) as HTMLTextAreaElement
    expect(text.placeholder).toBe(strings.teach.answer)
    getByRole(add, 'button', { name: strings.teach.addLabel }).click()
    expect(called('savePrinciple')[0]!.args).toEqual([
      {
        kind: 'answer',
        topic: 'Release calendar',
        rule: 'The calendar is the infra wiki page',
        source: null,
        place: null,
      },
    ])
  })

  it('switches, edits, moves, deletes and makes public or private each principle', () => {
    const { context, called } = testContext()
    mount(dialogHost())
    const shown = mount(sectionOf(context))
    const tone = principle('Tone', { publicText: 'Friendly.' })
    const dates = principle('Dates')
    context.state.taught.set(taught({ principles: [tone, dates], offers: [offer] }))
    getByRole(shown, 'switch', { name: strings.todo.use({ name: 'Tone' }) }).click()
    fire.change(shown.querySelector(`[data-key="${tone.id}"] .todo-field.is-topic`)!, 'Voice')
    getByRole(shown, 'button', { name: strings.todo.moveDown({ name: 'Tone' }) }).click()
    getByRole(shown, 'button', { name: strings.teach.makePrivate({ name: 'Tone' }) }).click()
    called('changePrinciple').at(-1)!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.teach.madePrivate })
    getByRole(shown, 'button', { name: strings.todo.more({ name: 'Dates' }) }).click()
    getByRole(shown, 'button', { name: strings.todo.delete }).click()
    expect(called('changePrinciple').map((call) => call.args)).toEqual([
      [tone.id, { enabled: false }],
      [tone.id, { topic: 'Voice' }],
      [tone.id, { publicText: null }],
    ])
    expect(called('reorderPrinciples')[0]!.args).toEqual([[dates.id, tone.id]])
    expect(called('deletePrinciple')[0]!.args).toEqual([dates.id])
    getByRole(shown, 'button', { name: strings.teach.makePublic({ name: 'Dates' }) }).click()
    expect(
      getByRole(document.getElementById('dialog')!, 'heading', { name: strings.teach.dialogTitle }),
    ).toBeTruthy()
    getByRole(shown, 'button', { name: strings.teach.notNow }).click()
    getByRole(shown, 'button', { name: strings.teach.stopAsking }).click()
    expect(called('dismissOffer').map((call) => call.args)).toEqual([
      ['offer_aaaaaaaaaaaa', false],
      ['offer_aaaaaaaaaaaa', true],
    ])
  })
})

describe('a principle switched on or off', () => {
  it('stays focused and in place while the list is drawn again around it', () => {
    const { context } = testContext()
    const tone = principle('Tone')
    const dates = principle('Dates')
    const stage = mount(h('main', { class: 'stage' }, h('h2', {}, 'My agent')))
    const shown = sectionOf(context)
    stage.append(shown)
    context.state.taught.set(taught({ principles: [tone, dates] }))
    Object.assign(stage, { scrollHeight: 1200, clientHeight: 700, scrollTop: 430 })
    const used = shown.querySelector<HTMLElement>(`[data-key="${dates.id}"] .todo-switch`)!
    used.focus()
    used.click()
    context.state.taught.set(taught({ principles: [tone, { ...dates, enabled: false }] }))
    const drawn = shown.querySelector<HTMLElement>(`[data-key="${dates.id}"] .todo-switch`)!
    expect(drawn.getAttribute('aria-checked')).toBe('false')
    expect(document.activeElement).toBe(drawn)
    expect([stage.firstChild?.textContent, shown.parentElement, stage.scrollTop]).toEqual([
      'My agent',
      stage,
      430,
    ])
  })
})

describe('taughtSection hints', () => {
  it('says what the public switch and the kind of a principle do, as their descriptions', () => {
    const { context } = testContext()
    const shown = mount(sectionOf(context))
    const tone = principle('Tone', { publicText: 'Friendly.' })
    const dates = principle('Dates', { kind: 'answer' })
    context.state.taught.set(taught({ principles: [tone, dates] }))
    const hintOf = (element: Element) => {
      const siblings = [...element.parentElement!.children]
      const hint = siblings[siblings.indexOf(element) + 1]!
      expect(element.getAttribute('aria-describedby')).toBe(hint.id)
      return hint.textContent
    }
    expect(hintOf(getByRole(shown, 'button', { name: strings.teach.makePrivate({ name: 'Tone' }) }))).toBe(
      strings.hints.makePrivate,
    )
    expect(hintOf(getByRole(shown, 'button', { name: strings.teach.makePublic({ name: 'Dates' }) }))).toBe(
      strings.hints.makePublic,
    )
    const badges = [...shown.querySelectorAll('.principle-kind-badge')]
    expect(badges.map(hintOf)).toEqual([strings.hints.kindRule, strings.hints.kindAnswer])
  })
})

describe('chancesIn', () => {
  it('shows this conversation’s chances to teach as one line each, while teaching is on', () => {
    mount(dialogHost())
    const { context, called } = testContext()
    const shown = mount(chancesIn(context, lifetime(), ROOM))
    context.state.taught.set(
      taught({ offers: [offer, { ...offer, id: 'offer_bbbbbbbbbbbb', kind: 'discard' }] }),
    )
    expect(textOf(shown)).toContain(strings.teach.chanceHereEdit)
    expect(textOf(shown)).toContain(strings.teach.chanceHereDiscard)
    getByRole(shown, 'button', { name: strings.teach.teachFromDiscard })
    const first = shown.querySelector<HTMLElement>(`[data-offer="${offer.id}"]`)!
    getByRole(first, 'button', { name: strings.teach.notNow }).click()
    expect(called('dismissOffer')[0]!.args).toEqual([offer.id, false])
    getByRole(first, 'button', { name: strings.teach.stopAsking }).click()
    expect(called('dismissOffer')[1]!.args).toEqual([offer.id, true])
    getByRole(shown, 'button', { name: strings.teach.teachFromEdit }).click()
    expect(document.querySelector('dialog')?.textContent).toContain(strings.teach.save)
    context.state.serverInfo.set(serverInfo())
    context.state.taught.set(taught({ offers: [offer] }))
    expect(shown.childNodes).toHaveLength(0)
  })
})

describe('appliedMarkers', () => {
  it('names what the agent applied and records when the person says it was wrong here', () => {
    const { context, called } = testContext()
    const tone = principle('Tone')
    context.state.taught.set(taught({ principles: [tone] }))
    const shown = appliedMarkers(context, draft('d1', { basis: 'Principles applied: Gone; Tone' }))!
    expect(textOf(shown)).toContain(strings.teach.applied({ title: 'Gone' }))
    getByRole(shown, 'button', { name: strings.teach.wrongHere }).click()
    expect(called('markPrincipleWrong')[0]!.args).toEqual([tone.id, 'd1'])
    called('markPrincipleWrong')[0]!.then!.done!(undefined)
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.teach.wrongRecorded })
    expect(appliedMarkers(context, draft('d2'))).toBeNull()
    expect(queryByRole(shown, 'alert')).toBeNull()
  })
})
