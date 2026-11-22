import { lifetime } from '@homingbird/ui'
import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { joinCodeSection } from '../../src/views/join-code.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { entry, me } from '../support/fixtures.ts'

usingFakeDom()

const madeFor = (now: number) => ({
  code: 'hbj_secret',
  id: 'join_1',
  serverUrl: 'https://hb.example.com',
  expiresAt: now + 600_000,
})
const COMMAND = ' homingbird setup --server https://hb.example.com --join hbj_secret --agent claude'

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

  it('counts down from ten minutes even when this browser’s clock is far from the server’s', () => {
    const { context, called } = testContext()
    const shown = mount(joinCodeSection(context, lifetime(), null))
    getByRole(shown, 'button', { name: strings.joinCode.create }).click()
    called('createJoinCode')[0]!.then!.done!({
      code: 'hbj_secret',
      id: 'join_1',
      serverUrl: 'https://hb.example.com',
      expiresAt: context.clock.now() - 3_600_000,
      expiresInSeconds: 600,
    })
    expect(textOf(shown)).toContain(strings.joinCode.expiresIn({ time: '10:00' }))
  })

  it('names each section by its own title, so two on one page stay apart', () => {
    const { context } = testContext()
    let ids = 0
    const numbered = { ...context, random: { ...context.random, id: () => `id-${++ids}` } }
    const first = joinCodeSection(numbered, lifetime(), null)
    const second = joinCodeSection(numbered, lifetime(), { channel: 'payments-wiki', name: 'Wiki' })
    expect(first.getAttribute('aria-labelledby')).not.toBe(second.getAttribute('aria-labelledby'))
    expect(first.querySelector('h3')!.id).toBe(first.getAttribute('aria-labelledby'))
  })

  it('asks the server whether the code was used, then names the connection, says it is awake and reloads', async () => {
    const { context, called, clock } = testContext()
    context.state.session.set(me())
    let reloaded = 0
    const shown = mount(joinCodeSection(context, lifetime(), null, () => void reloaded++))
    getByRole(shown, 'button', { name: strings.joinCode.create }).click()
    called('createJoinCode')[0]!.then!.done!(madeFor(clock.now()))
    expect(called('joinCodeStatus')).toEqual([])
    await clock.advance(3_000)
    expect(called('joinCodeStatus')[0]!.args).toEqual(['join_1'])
    called('joinCodeStatus')[0]!.then!.done!({ status: 'waiting' })
    await clock.advance(3_000)
    called('joinCodeStatus')[1]!.then!.failed!({ _tag: 'Unavailable', message: 'no' } as never)
    await clock.advance(3_000)
    called('joinCodeStatus')[2]!.then!.done!({
      status: 'redeemed',
      credential: { id: 'cred_9', name: 'build-1' },
    })
    expect(reloaded).toBe(1)
    expect(shown.querySelector('pre')).toBeNull()
    const said = textOf(shown.querySelector('.join-code-connected')!)
    expect(said).toContain(strings.joinCode.connected({ name: 'build-1' }))
    expect(said).toContain(strings.joinCode.notAwakeYet)
    context.state.directory.set([
      entry(me().member.id, 'Ana', { presence: { humanOnline: true, agentOnline: true } }),
    ])
    expect(textOf(shown.querySelector('.join-code-connected')!)).toContain(strings.joinCode.awakeNow)
    await clock.advance(30_000)
    expect(called('joinCodeStatus')).toHaveLength(3)
    getByRole(shown, 'button', { name: strings.joinCode.another }).click()
    expect(called('createJoinCode')).toHaveLength(2)
  })

  it('stops asking once the code expired, and ignores an answer that comes after', async () => {
    const { context, called, clock } = testContext()
    const shown = mount(joinCodeSection(context, lifetime(), { channel: 'payments-wiki', name: 'Wiki' }))
    getByRole(shown, 'button', { name: strings.joinCode.create }).click()
    called('createJoinCode')[0]!.then!.done!({ ...madeFor(clock.now()), expiresInSeconds: 5 })
    await clock.advance(3_000)
    await clock.advance(2_000)
    called('joinCodeStatus')[0]!.then!.failed!({ _tag: 'Unavailable', message: 'no' } as never)
    await clock.advance(10_000)
    called('joinCodeStatus')[0]!.then!.done!({
      status: 'redeemed',
      credential: { id: 'cred_9', name: 'late' },
    })
    expect(textOf(shown)).toContain(strings.joinCode.expired)
    expect(called('joinCodeStatus')).toHaveLength(1)
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
