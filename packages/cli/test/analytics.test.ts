import { Task as T } from '@homingbird/kernel'
import type { ServerInfo } from '@homingbird/protocol'
import { ANALYTICS_AGENT_PRESETS } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { AGENT_PRESETS, agentCommand } from '../src/agent-presets.ts'
import { ANALYTICS_NOTICE, countUsage, isDoNotTrack, presetLabel, setAnalytics } from '../src/analytics.ts'
import { fakeApi, world } from './support.ts'

const ANALYTICS_FILE = '/home/june/.config/homingbird/analytics.json'

const info = (analytics: boolean): ServerInfo => ({
  name: 'dovecote',
  version: '0.1.4',
  contactMode: 'open',
  signInWith: 'Google',
  features: { analytics },
})

const counting = (offered: boolean) =>
  fakeApi({ 'server.info': () => info(offered), 'analytics.track': () => ({}) })

describe('anonymous usage counts from the command line', () => {
  it('send nothing and keep nothing while the server does not ask for them', async () => {
    const w = world()
    const fake = counting(false)
    await T.runPromise(countUsage(fake.api, 'desk_started', { agentPreset: 'claude' }), w.env)
    expect(fake.calls.map((call) => call.name)).toEqual(['server.info'])
    expect(w.files.has(ANALYTICS_FILE)).toBe(false)
  })

  it('say so once, then send an event under one anonymous id kept on this computer', async () => {
    const w = world()
    const fake = counting(true)
    await T.runPromise(countUsage(fake.api, 'desk_started', { agentPreset: 'claude' }), w.env)
    await T.runPromise(countUsage(fake.api, 'sign_in_completed', { client: 'cli' }), w.env)
    expect(w.problems).toEqual([ANALYTICS_NOTICE])
    const sent = fake.calls
      .filter((call) => call.name === 'analytics.track')
      .map((call) => (call.request as any).body.events[0])
    expect(sent.map((event) => [event.event, event.properties])).toEqual([
      ['desk_started', { agentPreset: 'claude' }],
      ['sign_in_completed', { client: 'cli' }],
    ])
    expect(sent[0].anonymousId).toBe(sent[1].anonymousId)
    expect(JSON.parse(w.files.get(ANALYTICS_FILE)!)).toEqual({
      anonymousId: sent[0].anonymousId,
      enabled: true,
      noticeShown: true,
    })
  })

  it('stop with homingbird analytics off, and start again with on', async () => {
    const w = world({ stubs: { 'server.info': () => info(true), 'analytics.track': () => ({}) } })
    expect(await w.run('analytics', 'off', '--json')).toBe(0)
    expect(w.json()).toEqual({ enabled: false, doNotTrack: false })
    expect(await w.run('run', '--agent', 'claude', '--log-level', 'nonsense')).toBe(2)
    const fake = counting(true)
    await T.runPromise(countUsage(fake.api, 'desk_started', { agentPreset: 'claude' }), w.env)
    expect(fake.calls).toEqual([])
    expect(await w.run('analytics', 'status')).toBe(0)
    expect(w.lines.at(-1)).toBe('Anonymous usage counts are off on this computer.')
    expect(await w.run('analytics', 'on')).toBe(0)
    expect(w.lines.at(-1)).toMatch(/^Anonymous usage counts are on/)
    expect(await w.run('analytics', 'maybe')).toBe(2)
  })

  it('stop with DO_NOT_TRACK, whatever was chosen', async () => {
    const w = world({ variables: { DO_NOT_TRACK: '1' } })
    const fake = counting(true)
    await T.runPromise(countUsage(fake.api, 'desk_started', { agentPreset: 'claude' }), w.env)
    expect(fake.calls).toEqual([])
    expect(await w.run('analytics', 'status')).toBe(0)
    expect(w.lines.at(-1)).toBe('Anonymous usage counts are off: DO_NOT_TRACK is set.')
    expect([
      isDoNotTrack({}),
      isDoNotTrack({ DO_NOT_TRACK: '0' }),
      isDoNotTrack({ DO_NOT_TRACK: 'true' }),
    ]).toEqual([false, false, true])
  })

  it('never fail the command they count', async () => {
    const w = world()
    const broken = fakeApi({})
    await T.runPromise(countUsage(broken.api, 'desk_started', { agentPreset: 'claude' }), w.env)
    expect(w.problems).toEqual([])
  })

  it('name a desk’s agent by its preset only, never by its command', () => {
    expect(presetLabel(agentCommand('claude', 'linux'))).toBe('claude')
    expect(presetLabel(agentCommand('claude', 'win32'))).toBe('claude')
    expect(presetLabel('claude -p')).toBe('custom')
    expect(presetLabel('codex')).toBe('codex')
    expect(presetLabel('/home/june/bin/my-agent --secret x')).toBe('custom')
  })

  it('stay off, without failing the command, when their file cannot be read or written', async () => {
    const unreadable = world()
    const broken = {
      ...unreadable.env,
      files: { ...unreadable.env.files, read: () => T.die(new Error('EACCES')) },
    }
    const fake = counting(true)
    await T.runPromise(countUsage(fake.api, 'desk_started', { agentPreset: 'claude' }), broken)
    expect(fake.calls).toEqual([])
    const unwritable = world()
    const readOnly = {
      ...unwritable.env,
      files: { ...unwritable.env.files, writePrivate: () => T.die(new Error('EROFS')) },
    }
    const second = counting(true)
    await T.runPromise(countUsage(second.api, 'desk_started', { agentPreset: 'claude' }), readOnly)
    expect(second.calls.map((call) => call.name)).toEqual(['server.info'])
    expect(unwritable.problems).toEqual([])
    expect(await T.runPromise(setAnalytics('on'), readOnly)).toEqual({ enabled: false, doNotTrack: false })
    unreadable.files.set(ANALYTICS_FILE, 'not json')
    const third = counting(true)
    await T.runPromise(countUsage(third.api, 'desk_started', { agentPreset: 'claude' }), unreadable.env)
    expect(third.calls).toEqual([])
  })

  it('know every preset the runner has by name', () => {
    for (const preset of AGENT_PRESETS) expect(ANALYTICS_AGENT_PRESETS).toContain(preset.name)
  })
})
