import { getByRole, getByText, textOf } from '@homingbird/ui/testing'
import { describe, expect, it, vi } from 'vitest'
import { timeShown } from '../../src/models/time.ts'
import { strings } from '../../src/strings.ts'
import {
  agentDot,
  archivedMark,
  button,
  channelChips,
  channelCounts,
  dialogActions,
  disabledWithReason,
  empty,
  emptyWithPip,
  field,
  humanDot,
  loadFailed,
  loading,
  page,
  presenceBadges,
  privateMarkOf,
  timeLabel,
  youMark,
} from '../../src/views/parts.ts'
import { usingFakeDom } from '../support/dom.ts'

usingFakeDom()

describe('the parts of every page', () => {
  it('makes a page with a back link and its title', () => {
    const shown = page('People', 'body')
    expect(getByRole(shown, 'heading', { name: 'People' })).toBeTruthy()
    expect(getByRole(shown, 'link', { name: strings.back }).getAttribute('href')).toBe('#/')
    expect(textOf(shown)).toContain('body')
  })

  it('makes buttons that act, and labelled fields with a hint', () => {
    const clicked = vi.fn()
    button('Go', clicked, { class: 'primary' }).click()
    expect(clicked).toHaveBeenCalledTimes(1)
    const shown = field('Name', document.createElement('input'), 'Your full name')
    expect(getByRole(shown, 'textbox', { name: 'Name Your full name' })).toBeTruthy()
    expect(field('Name', document.createElement('input')).querySelector('small')).toBeNull()
  })

  it('shows presence in words', () => {
    const words = presenceBadges({ humanOnline: false, agentOnline: true })
    expect(textOf(words)).toContain(strings.humanOffline)
    expect(textOf(words)).toContain(strings.agentOnline)
  })

  it('shows presence as dots: the person beside the name, the agent on the avatar while it is awake', () => {
    const online = humanDot({ humanOnline: true, agentOnline: false })
    expect([online.getAttribute('role'), online.getAttribute('aria-label')]).toEqual([
      'img',
      strings.humanOnline,
    ])
    const awake = agentDot({ humanOnline: false, agentOnline: true })!
    expect(awake.getAttribute('aria-label')).toBe(strings.agentOnline)
    expect(awake.classList.contains('is-on')).toBe(true)
    expect(agentDot({ humanOnline: true, agentOnline: false })).toBeNull()
    const unavailable = agentDot({ humanOnline: true, agentOnline: true, agentUnavailable: { until: null } })!
    expect(unavailable.getAttribute('aria-label')).toBe(strings.agentUnavailable)
    expect(unavailable.classList.contains('is-off')).toBe(true)
  })

  it('shows a time with its full date as a title', () => {
    const shown = timeLabel(timeShown(0, 0))
    expect(shown.getAttribute('datetime')).toBe(new Date(0).toISOString())
  })

  it('shows loading, a failure with a retry, and an empty page with or without Pip', () => {
    expect(textOf(loading())).toBe(strings.loading)
    const retry = vi.fn()
    getByRole(loadFailed(retry), 'button', { name: strings.tryAgain }).click()
    expect(retry).toHaveBeenCalled()
    expect(getByText(empty('Nothing', 'x'), 'Nothing')).toBeTruthy()
    expect(emptyWithPip('waving', 'Hello').querySelector('.pip')).not.toBeNull()
  })

  it('shows channel chips, counts, marks and a disabled control with its reason', () => {
    expect(getByRole(channelChips(['billing']), 'link', { name: '#billing' }).getAttribute('href')).toBe(
      '#/channel/billing',
    )
    expect(textOf(channelCounts({ memberCount: 3, helperCount: 1 }))).toBe(
      `${strings.memberCount({ count: 3 })}${strings.answerCount({ count: 1 })}`,
    )
    expect(textOf(archivedMark())).toBe(strings.archived)
    expect(textOf(youMark())).toBe(strings.youMark)
    expect(privateMarkOf('Private', 'Seen by members').getAttribute('title')).toBe('Seen by members')
    const control = disabledWithReason('Leave', 'You are the last manager.', 'leave')
    const leave = getByRole(control, 'button', { name: 'Leave' })
    expect(leave.hasAttribute('disabled')).toBe(true)
    expect(document.createElement('div').ownerDocument).toBeTruthy()
    expect(control.querySelector(`#${leave.getAttribute('aria-describedby')}`)?.textContent).toBe(
      'You are the last manager.',
    )
    const actions = dialogActions('Save', 'primary')
    expect(getByRole(actions, 'button', { name: strings.cancel }).getAttribute('command')).toBe('close')
  })
})
