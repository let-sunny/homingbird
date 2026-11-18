import { describe, expect, it } from 'vitest'
import { agentEnvironment } from '../src/agent-environment.ts'
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
          Homingbird_Anything: 'x',
          HB_DATABASE_URL: 'postgres://secret',
          COPIED: `token=${AGENT_TOKEN}`,
          HBX_KEEP: 'kept',
        },
        [AGENT_TOKEN, ''],
      ),
    ).toEqual({ PATH: '/usr/bin', LANG: 'C', HBX_KEEP: 'kept' })
  })
})
