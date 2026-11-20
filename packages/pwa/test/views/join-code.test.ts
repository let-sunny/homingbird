import { lifetime } from '@homingbird/ui'
import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { joinCodeSection } from '../../src/views/join-code.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'

usingFakeDom()

const madeFor = (now: number) => ({
  code: 'hbj_secret',
  serverUrl: 'https://hb.example.com',
  expiresAt: now + 600_000,
})
const COMMAND = 'homingbird setup --server https://hb.example.com --join hbj_secret --agent claude'

describe('joinCodeSection', () => {
  it('makes a code, shows the line to paste, copies it, and counts down until it offers a new one', async () => {
    const { context, called, clock, page } = testContext()
    const shown = mount(joinCodeSection(context, lifetime(), null))
    getByRole(shown, 'button', { name: strings.joinCode.create }).click()
    expect(called('createJoinCode')[0]!.args).toEqual([null])
    expect(getByRole(shown, 'button', { name: strings.joinCode.creating }).hasAttribute('disabled')).toBe(
      true,
    )
    called('createJoinCode')[0]!.then!.done!(madeFor(clock.now()))
    expect(shown.querySelector('pre')!.textContent).toBe(COMMAND)
    expect(textOf(shown)).toContain(strings.joinCode.expiresIn({ time: '10:00' }))

    getByRole(shown, 'button', { name: strings.joinCode.copy }).click()
    await Promise.resolve()
    expect(page.copied).toEqual([COMMAND])
    expect(getByRole(shown, 'button', { name: strings.joinCode.copied })).toBeTruthy()

    await clock.advance(61_000)
    expect(textOf(shown)).toContain(strings.joinCode.expiresIn({ time: '8:59' }))
    await clock.advance(540_000)
    expect(textOf(shown)).toContain(strings.joinCode.expired)
    expect(shown.querySelector('pre')).toBeNull()
    getByRole(shown, 'button', { name: strings.joinCode.again }).click()
    expect(called('createJoinCode')).toHaveLength(2)
  })

  it('makes a channel agent’s code for its channel, says when the browser would not copy, and when no code came', async () => {
    const { context, called, clock, page } = testContext()
    page.state.clipboard = false
    const shown = mount(joinCodeSection(context, lifetime(), { channel: 'payments-wiki', name: 'Wiki' }))
    expect(textOf(shown)).toContain(strings.joinCode.introAgent({ agent: 'Wiki' }))
    getByRole(shown, 'button', { name: strings.joinCode.create }).click()
    expect(called('createJoinCode')[0]!.args).toEqual(['payments-wiki'])
    called('createJoinCode')[0]!.then!.failed!({ _tag: 'Forbidden', message: 'no' } as never)
    expect(textOf(shown)).toContain(strings.joinCode.failed)
    getByRole(shown, 'button', { name: strings.joinCode.create }).click()
    called('createJoinCode')[1]!.then!.done!(madeFor(clock.now()))
    expect(textOf(shown)).toContain(strings.joinCode.explanationAgent({ agent: 'Wiki' }))
    getByRole(shown, 'button', { name: strings.joinCode.copy }).click()
    await Promise.resolve()
    expect(textOf(shown)).toContain(strings.joinCode.copyFailed)
  })

  it('stops counting once its page is gone', async () => {
    const { context, called, clock } = testContext()
    const life = lifetime()
    const shown = mount(joinCodeSection(context, life, null))
    getByRole(shown, 'button', { name: strings.joinCode.create }).click()
    called('createJoinCode')[0]!.then!.done!(madeFor(clock.now()))
    life.end()
    await clock.advance(5_000)
    expect(textOf(shown)).toContain(strings.joinCode.expiresIn({ time: '10:00' }))
  })
})
