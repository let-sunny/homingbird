import { describe, expect, it } from 'vitest'
import { agentKindOf, agentNameOf } from '../src/agent-names.ts'
import { strings } from '../src/strings.ts'

describe('agentNameOf', () => {
  it('names a draft from the Claude Code plugin the Claude Code desk, without the host name', () => {
    const name = agentNameOf({ agentName: 'Homingbird CLI on ben-mac', agentClient: 'Claude Code 2.1.327' })
    expect(name).toBe(strings.agentNames.desk)
    expect(name).not.toContain('ben-mac')
  })

  it('names a draft from the runner by the computer it runs on', () => {
    expect(
      agentNameOf({ agentName: 'Homingbird CLI on build-1', agentClient: 'codex via homingbird run' }),
    ).toBe(strings.agentNames.runner({ host: 'build-1' }))
  })

  it('keeps the name a person gave the runner’s connection', () => {
    expect(agentNameOf({ agentName: 'Team server', agentClient: 'homingbird run' })).toBe(
      strings.agentNames.runner({ host: 'Team server' }),
    )
  })

  it('calls a runner without a connection name just the runner', () => {
    expect(agentNameOf({ agentName: null, agentClient: 'claude via homingbird run' })).toBe(
      strings.agentNames.runnerUnnamed,
    )
    expect(agentNameOf({ agentName: '  ', agentClient: 'claude via homingbird run' })).toBe(
      strings.agentNames.runnerUnnamed,
    )
  })

  it('names any other agent, or one that reported no program, by its connection', () => {
    const laptop = strings.agentNames.connection({ name: 'Laptop' })
    expect(laptop).toBe('on Laptop')
    expect(agentNameOf({ agentName: 'Laptop', agentClient: 'claude-code 2.1.327' })).toBe(laptop)
    expect(agentNameOf({ agentName: 'Laptop', agentClient: null })).toBe(laptop)
    expect(agentNameOf({ agentName: 'Laptop' })).toBe(laptop)
    expect(agentNameOf({ agentName: null, agentClient: null })).toBeNull()
  })
})

describe('agentKindOf', () => {
  it('reads the program labels the plugin and the runner report', () => {
    expect(agentKindOf('Claude Code')).toBe('desk')
    expect(agentKindOf('Claude Code 2.1.330')).toBe('desk')
    expect(agentKindOf('Claude Codex')).toBe('other')
    expect(agentKindOf('homingbird run')).toBe('runner')
    expect(agentKindOf('gemini via homingbird run')).toBe('runner')
    expect(agentKindOf('homingbird running')).toBe('other')
    expect(agentKindOf(null)).toBe('other')
  })
})
