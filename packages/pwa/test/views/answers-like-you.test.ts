import type { AsRead } from '@homingbird/protocol'
import { lifetime } from '@homingbird/ui'
import { allByRole, getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { answersLikeYouSection } from '../../src/views/answers-like-you.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ROOM, everything, figures, report, serverInfo, taught } from '../support/fixtures.ts'
import { setLoad } from '../support/resource-load.ts'

usingFakeDom()

const words = strings.answersLikeYou
const DAY = 24 * 60 * 60_000

const place = (name: string | null, asWritten: number, edited: number, verdict: string) =>
  ({
    place: name,
    written: asWritten + edited,
    sentAsWritten: asWritten,
    sentAfterEdits: edited,
    discarded: 0,
    skipped: 0,
    verdict,
  }) as AsRead.AgentFigures['places'][number]

const month = (places: ReadonlyArray<AsRead.AgentFigures['places'][number]>) =>
  report({
    generatedAt: 40 * DAY,
    periods: [
      { days: 7, current: figures(), previous: figures() },
      { days: 30, current: figures({ places }), previous: figures() },
    ],
    misses: [
      {
        outcome: 'skipped',
        noteId: 'note_skipped' as AsRead.AgentMiss['noteId'],
        conversationId: ROOM,
        place: 'deploys',
        at: 39 * DAY,
      },
    ],
  })

const ROUTES = [
  { place: 'billing', drafted: 33, principles: 2, heldUp: 3, chances: 2 },
  { place: 'deploys', drafted: 12, principles: 1, heldUp: 4, chances: 0 },
  { place: 'design', drafted: 3, principles: 0, heldUp: 0, chances: 0 },
]

describe('answersLikeYouSection', () => {
  it('shows each place’s count and sentence alone when the principles are given up on, rather than nothing', () => {
    const { context } = testContext()
    context.state.serverInfo.set(everything())
    mount(dialogHost())
    const shown = mount(answersLikeYouSection(context, lifetime()))
    context.state.agentReport.set(month([place('billing', 21, 12, 'mixed')]))
    expect(shown.childNodes).toHaveLength(0)
    setLoad(context.state.taught, { step: 'failed' })
    expect(getByRole(shown, 'heading', { name: words.title })).toBeTruthy()
    expect(shown.querySelector('[data-place="billing"] [aria-current]')).toBeNull()
  })

  it('loads the principles, then draws each place on its track with a tooltip per step and its next action', () => {
    const { context, called } = testContext()
    context.state.serverInfo.set(everything())
    mount(dialogHost())
    const shown = mount(answersLikeYouSection(context, lifetime()))
    expect(called('refreshPrinciples')).toHaveLength(1)
    context.state.agentReport.set(
      month([place('billing', 21, 12, 'mixed'), place('deploys', 9, 3, 'usually_as_written')]),
    )
    expect(shown.childNodes).toHaveLength(0)
    context.state.taught.set(taught({ routes: ROUTES }))
    expect(getByRole(shown, 'heading', { name: words.title })).toBeTruthy()
    const billing = shown.querySelector<HTMLElement>('[data-place="billing"]')!
    const track = getByRole(billing, 'list', { name: words.trackLabel({ place: '#billing' }) })
    const steps = allByRole(track, 'listitem')
    expect(steps.map((step) => step.getAttribute('aria-current'))).toEqual([null, null, 'step', null])
    expect(steps.map((step) => step.classList.contains('is-reached'))).toEqual([true, true, true, false])
    expect(steps[3]!.classList.contains('is-last')).toBe(true)
    expect(steps[2]!.getAttribute('tabindex')).toBe('0')
    const tip = document.getElementById(steps[2]!.getAttribute('aria-describedby')!)!
    expect(tip.getAttribute('role')).toBe('tooltip')
    expect(textOf(tip)).toContain(words.meaning.holding)
    expect(textOf(tip)).toContain(words.toReach.holding({ minimum: 10 }))
    expect(textOf(billing)).toContain(words.next.holding({ now: 6 }))
    expect(billing.querySelector('.answers-step-now')!.textContent).toBe(
      words.stepOf({ step: 3, name: words.steps.holding }),
    )
    expect(
      getByRole(billing, 'link', { name: words.teachFromChances({ count: 2 }) }).getAttribute('href'),
    ).toBe('#/agent/teaching')
    const deploys = shown.querySelector<HTMLElement>('[data-place="deploys"]')!
    expect(textOf(deploys.querySelector('summary')!)).toBe(words.reviewSkipped({ count: 1 }))
    deploys.querySelector('details')!.setAttribute('open', '')
    expect(getByRole(deploys, 'link', { name: strings.teach.openConversation }).getAttribute('href')).toBe(
      `#/c/${ROOM}?note=note_skipped`,
    )
    const design = shown.querySelector<HTMLElement>('[data-place="design"]')!
    getByRole(design, 'button', { name: words.teachFirst({ place: '#design' }) }).click()
    expect(document.querySelector<HTMLSelectElement>('dialog select[name="place"]')?.value).toBe('design')
    expect(textOf(shown.querySelector('.answers-steps summary')!)).toBe(words.stepsTitle)
    expect(shown.querySelectorAll('.answers-steps li')).toHaveLength(4)
    expect(textOf(shown)).toContain(words.footnote)
  })

  it('marks a place whose last step slipped, so its sentence reads as a chance to teach', () => {
    const { context } = testContext()
    context.state.serverInfo.set(everything())
    const shown = mount(answersLikeYouSection(context, lifetime()))
    context.state.taught.set(taught({ routes: [{ ...ROUTES[0]!, chances: 0 }] }))
    context.state.agentReport.set(
      report({
        periods: [
          { days: 7, current: figures(), previous: figures() },
          {
            days: 30,
            current: figures({ places: [place('billing', 6, 4, 'mixed')] }),
            previous: figures({ places: [place('billing', 9, 1, 'usually_as_written')] }),
          },
        ],
      }),
    )
    const billing = shown.querySelector<HTMLElement>('[data-place="billing"]')!
    expect(billing.classList.contains('is-slipped')).toBe(true)
    expect(textOf(billing)).toContain(words.next.slipped)
  })

  it('shows each place’s count and sentence alone, without loading principles, while teaching is off', () => {
    const { context, called } = testContext()
    context.state.serverInfo.set(serverInfo({ agentFigures: true }))
    const shown = mount(answersLikeYouSection(context, lifetime()))
    context.state.agentReport.set(month([place('billing', 9, 1, 'usually_as_written')]))
    expect(called('refreshPrinciples')).toHaveLength(0)
    expect(textOf(shown)).toContain(words.next.likeYou)
    expect(shown.querySelector('.answers-track')).toBeNull()
    expect(shown.querySelector('.answers-action')).toBeNull()
    expect(shown.querySelector('.answers-steps')).toBeNull()
  })
})
