import { h } from '@homingbird/ui'
import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it, vi } from 'vitest'
import { type GroupStartModel, groupStartModel } from '../../src/models/group-start.ts'
import { strings } from '../../src/strings.ts'
import { choiceToggle, groupStartPanel, reflectChoices } from '../../src/views/group-start.ts'
import { usingFakeDom } from '../support/dom.ts'
import { ANA, BEN, CY, conversation, entry } from '../support/fixtures.ts'

usingFakeDom()

const modelWith = (chosen: GroupStartModel['chips'][number]['memberId'][], starting = false) =>
  groupStartModel({
    directory: [entry(BEN, 'Ben'), entry(CY, 'Cy')],
    conversations: [],
    viewerId: ANA,
    chosen,
    starting,
    draftRequests: true,
  })!

const handlers = () => ({ remove: vi.fn(), clear: vi.fn(), start: vi.fn() })

describe('groupStartPanel', () => {
  it('draws nothing when there is nobody to choose', () => {
    expect(groupStartPanel(null, handlers())).toBeNull()
  })

  it('keeps the panel to one named line until someone is added', () => {
    const panel = groupStartPanel(modelWith([]), handlers())!
    const heading = getByRole(panel, 'heading', { name: strings.groupStart.title })
    expect(panel.getAttribute('aria-labelledby')).toBe(heading.id)
    expect(panel.classList.contains('is-collapsed')).toBe(true)
    expect(textOf(panel)).toContain(strings.groupStart.collapsed)
    expect(textOf(panel)).not.toContain(strings.groupStart.intro)
    expect(panel.querySelectorAll('button')).toHaveLength(0)
  })

  it('says how many are chosen and holds the start until two are', () => {
    const panel = groupStartPanel(modelWith([BEN]), handlers())!
    expect(panel.classList.contains('is-collapsed')).toBe(false)
    expect(textOf(panel)).toContain('1 person chosen')
    expect(textOf(panel)).toContain(strings.groupStart.intro)
    expect(textOf(panel)).toContain(strings.groupStart.needMore)
    expect(getByRole(panel, 'button', { name: strings.groupStart.start }).hasAttribute('disabled')).toBe(true)
  })

  it('shows each person chosen as a chip that takes them out, and starts or clears on request', () => {
    const asked = handlers()
    const panel = groupStartPanel(modelWith([CY, BEN]), asked)!
    expect([...panel.querySelectorAll('.group-start-chip span')].map((chip) => chip.textContent)).toEqual([
      'Cy',
      'Ben',
    ])
    getByRole(panel, 'button', { name: 'Remove Cy' }).click()
    expect(asked.remove).toHaveBeenCalledWith(CY)
    expect(getByRole(panel, 'status').textContent).toBe('A group message with Cy and Ben.')
    getByRole(panel, 'button', { name: strings.groupStart.start }).click()
    getByRole(panel, 'button', { name: strings.groupStart.clear }).click()
    expect(asked.start).toHaveBeenCalledTimes(1)
    expect(asked.clear).toHaveBeenCalledTimes(1)
  })

  it('links to the group room there already is instead of starting another', () => {
    const room = conversation({ kind: 'group', participantIds: [ANA, BEN, CY] })
    const model = groupStartModel({
      directory: [entry(BEN, 'Ben'), entry(CY, 'Cy')],
      conversations: [room],
      viewerId: ANA,
      chosen: [BEN, CY],
      starting: false,
      draftRequests: true,
    })
    const panel = groupStartPanel(model, handlers())!
    expect(getByRole(panel, 'link', { name: strings.groupStart.open }).getAttribute('href')).toBe(
      `#/c/${room.id}`,
    )
    expect(textOf(panel)).toContain(strings.groupStart.existing)
    expect(panel.querySelector('button.primary')).toBeNull()
  })

  it('says when a conversation is full', () => {
    const model = { ...modelWith([BEN, CY]), full: 'Full.' }
    expect(getByRole(groupStartPanel(model, handlers())!, 'note').textContent).toBe('Full.')
  })
})

describe('choiceToggle', () => {
  it('is a toggle named for the person, kept up to date without drawing it again', () => {
    const choose = vi.fn()
    const toggle = choiceToggle(BEN, modelWith([]).toggles.get(BEN)!, choose)
    const host = h(
      'div',
      {},
      toggle,
      h('button', { class: 'choose-toggle', data: { chooses: 'mem_gone00000000' } }),
    )
    expect(toggle.getAttribute('aria-label')).toBe('Add Ben to the group message')
    expect(toggle.textContent).toBe(strings.groupStart.choose)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    toggle.click()
    expect(choose).toHaveBeenCalledTimes(1)
    reflectChoices(host, modelWith([BEN]).toggles)
    expect(host.querySelector('.choose-toggle')).toBe(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    reflectChoices(host, modelWith([BEN, CY], true).toggles)
    expect(toggle.hasAttribute('disabled')).toBe(true)
  })
})
