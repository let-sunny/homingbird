import type { AsRead } from '@homingbird/protocol'
import { lifetime, signal } from '@homingbird/ui'
import { fire, getByRole, getByText, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { cloudDeskSection } from '../../src/views/cloud-desk.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { credential } from '../support/fixtures.ts'

usingFakeDom()

const WAKE: AsRead.DeskWake = {
  host: 'api.anthropic.com',
  headerNames: ['Authorization', 'anthropic-version'],
  credentialId: 'cred_cloud0000000' as never,
  enabled: true,
  lastWakeAt: null,
  lastStatus: 'never',
  failures: 0,
  stoppedBecause: null,
  createdAt: 1,
  updatedAt: 1,
}

const shownWith = (
  listed: ReadonlyArray<AsRead.Credential> | null = [credential('cred_cloud0000000', { name: 'Cloud desk' })],
) => {
  const test = testContext()
  mount(dialogHost())
  const credentials = signal(listed)
  const shown = mount(cloudDeskSection(test.context, lifetime(), credentials))
  return { ...test, shown, credentials }
}

const field = (shown: HTMLElement, name: string) =>
  shown.querySelector(`[name="${name}"]`) as HTMLInputElement

describe('cloudDeskSection', () => {
  it('loads the wake, then offers the routine preset with its prompt and the grace advice', () => {
    const { shown, called } = shownWith()
    expect(textOf(shown)).toContain(strings.loading)
    called('loadDeskWake')[0]!.then!.done!(null)
    expect(textOf(shown)).toContain(strings.cloudDesk.intro)
    expect(textOf(shown)).toContain(strings.cloudDesk.routineNote)
    expect(field(shown, 'url').getAttribute('placeholder')).toBe(
      'https://api.anthropic.com/v1/claude_code/routines/trig_…/fire',
    )
    expect(field(shown, 'header-name-1').value).toBe('anthropic-version')
    expect((shown.querySelector('.cloud-desk-prompt') as HTMLTextAreaElement).value).toBe(
      strings.cloudDesk.promptText,
    )
    expect(textOf(shown)).toContain(strings.cloudDesk.graceAdvice)
    expect(shown.querySelector('.cloud-desk-status')).toBeNull()
  })

  it('stops saying it is loading once the connections arrive after the wake', () => {
    const { shown, called, credentials } = shownWith(null)
    called('loadDeskWake')[0]!.then!.done!(WAKE)
    expect(shown.querySelector('.cloud-desk-state')!.textContent).toContain(strings.loading)
    credentials.set([credential('cred_cloud0000000', { name: 'Cloud desk' })])
    expect(shown.querySelector('.cloud-desk-state')!.textContent).not.toContain(strings.loading)
    expect(shown.querySelector('.cloud-desk-status')).not.toBeNull()
  })

  it('switches to the generic preset', () => {
    const { shown, called } = shownWith()
    called('loadDeskWake')[0]!.then!.done!(null)
    const generic = getByRole(shown, 'radio', { name: strings.cloudDesk.generic })
    fire.event(generic, 'change')
    expect(textOf(shown)).toContain(strings.cloudDesk.genericNote)
    expect(field(shown, 'header-name-1').value).toBe('')
  })

  it('saves the whole setup from the form and shows how the wake stands', () => {
    const { shown, called } = shownWith()
    called('loadDeskWake')[0]!.then!.done!(null)
    fire.type(field(shown, 'url'), 'https://api.anthropic.com/v1/claude_code/routines/trig_1/fire')
    fire.type(field(shown, 'header-value-0'), 'Bearer secret')
    fire.select(field(shown, 'credential'), 'cred_cloud0000000')
    fire.submit(shown.querySelector('form')!)
    expect(called('saveDeskWake')[0]!.args).toEqual([
      {
        url: 'https://api.anthropic.com/v1/claude_code/routines/trig_1/fire',
        headers: [
          { name: 'Authorization', value: 'Bearer secret' },
          { name: 'anthropic-version', value: '2023-06-01' },
          { name: 'anthropic-beta', value: 'experimental-cc-routine-2026-04-01' },
        ],
        credentialId: 'cred_cloud0000000',
        enabled: true,
      },
    ])
    called('saveDeskWake')[0]!.then!.done!(WAKE)
    expect(getByText(shown, strings.cloudDesk.status.never)).toBeTruthy()
    expect(textOf(shown)).toContain(strings.cloudDesk.replaceHint)
    expect(field(shown, 'header-value-0').value).toBe('')
  })

  it('sends a test wake and says what came of it', () => {
    const { shown, called } = shownWith()
    called('loadDeskWake')[0]!.then!.done!(WAKE)
    getByRole(shown, 'button', { name: strings.cloudDesk.test }).click()
    called('testDeskWake')[0]!.then!.done!({ status: 401, outcome: 'refused' })
    expect(textOf(shown)).toContain(strings.cloudDesk.tested.refused({ status: '401' }))
  })

  it('removes the wake after asking', () => {
    const { shown, called } = shownWith()
    called('loadDeskWake')[0]!.then!.done!({ ...WAKE, stoppedBecause: 'credential_gone' })
    expect(textOf(shown)).toContain(strings.cloudDesk.stopped.credentialGone)
    getByRole(shown, 'button', { name: strings.cloudDesk.remove }).click()
    const dialog = document.getElementById('dialog')!
    expect(textOf(dialog)).toContain(strings.cloudDesk.removeBody)
    getByRole(dialog, 'button', { name: strings.cloudDesk.remove }).click()
    called('removeDeskWake')[0]!.then!.done!(undefined)
    expect(shown.querySelector('.cloud-desk-status')).toBeNull()
  })

  it('asks to connect the cloud service first when no agent connection exists', () => {
    const { shown, called } = shownWith([credential('cred_web000000000', { kind: 'human' })])
    called('loadDeskWake')[0]!.then!.done!(null)
    expect(textOf(shown)).toContain(strings.cloudDesk.noAgent)
    expect((getByRole(shown, 'button', { name: strings.cloudDesk.save }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})
