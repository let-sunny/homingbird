import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  PARENT_SESSION_VARIABLES,
  PERSON_CLAUDE_CODE_VARIABLES,
  agentEnvironment,
} from '../src/agent-environment.ts'
import { AGENT_TOKEN } from './support.ts'

describe('agentEnvironment', () => {
  it('drops Homingbird and Dovecote variables in any letter case, and anything holding a withheld secret', () => {
    expect(
      agentEnvironment(
        {
          PATH: '/usr/bin',
          LANG: 'C',
          UNSET: undefined,
          HOMINGBIRD_SERVER: 'https://hb.example.com',
          HOMINGBIRD_CREDENTIALS_FILE: '/run/secrets/homingbird.json',
          MOUNTED: '/run/secrets/homingbird.json',
          Homingbird_Anything: 'x',
          HB_DATABASE_URL: 'postgres://secret',
          COPIED: `token=${AGENT_TOKEN}`,
          HBX_KEEP: 'kept',
        },
        [AGENT_TOKEN, '', '/run/secrets/homingbird.json'],
      ),
    ).toEqual({ PATH: '/usr/bin', LANG: 'C', HBX_KEEP: 'kept' })
  })

  it('drops what marks a Claude Code or Codex session that started the runner, in any letter case', () => {
    expect(
      agentEnvironment(
        {
          PATH: '/usr/bin',
          CLAUDECODE: '1',
          CLAUDE_CODE_SESSION_ID: 'session',
          CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/socket',
          claude_code_messaging_token: 'token',
          Codex_Thread_Id: 'thread',
          CLAUDE_CONFIG_DIR: '/home/june/.claude',
          CODEX_HOME: '/home/june/.codex',
        },
        [],
      ),
    ).toEqual({ PATH: '/usr/bin', CLAUDE_CONFIG_DIR: '/home/june/.claude', CODEX_HOME: '/home/june/.codex' })
    for (const name of PARENT_SESSION_VARIABLES) expect(name).toBe(name.toUpperCase())
  })

  it('drops every CLAUDE_CODE_ variable but those a person sets, and keeps PATH, HOME and proxies', () => {
    const name = fc
      .stringMatching(/^[A-Z0-9_]{1,24}$/)
      .map((rest) => `CLAUDE_CODE_${rest}`)
      .filter((each) => !PERSON_CLAUDE_CODE_VARIABLES.has(each))
    fc.assert(
      fc.property(
        name,
        fc.constantFrom('CLAUDE_AGENT_SDK_X', 'CLAUDE_PREVIEW_Y', 'claude_code_simple'),
        (session, other) => {
          const kept = agentEnvironment(
            {
              [session]: 'x',
              [other]: 'y',
              PATH: '/usr/bin',
              HOME: '/home/june',
              HTTPS_PROXY: 'http://proxy:3128',
              CLAUDE_CODE_USE_BEDROCK: '1',
              CLAUDE_CONFIG_DIR: '/home/june/.claude',
            },
            [],
          )
          expect(kept).toEqual({
            PATH: '/usr/bin',
            HOME: '/home/june',
            HTTPS_PROXY: 'http://proxy:3128',
            CLAUDE_CODE_USE_BEDROCK: '1',
            CLAUDE_CONFIG_DIR: '/home/june/.claude',
          })
        },
      ),
    )
  })
})
