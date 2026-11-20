import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { firstErrorLine, isManagedMcpRefusal } from '../src/agent-errors.ts'

const REFUSAL = 'Error: You cannot use --strict-mcp-config when an enterprise MCP config is present'

describe('isManagedMcpRefusal', () => {
  it('knows Claude Code’s refusal of --strict-mcp-config under a managed MCP configuration', () => {
    expect(isManagedMcpRefusal({ exitCode: 1, output: '', errors: `${REFUSAL}\n` })).toBe(true)
    expect(isManagedMcpRefusal({ exitCode: 1, output: REFUSAL.toUpperCase() })).toBe(true)
  })

  it('takes nothing else for it: another failure, or the sentence from a run that succeeded', () => {
    expect(isManagedMcpRefusal({ exitCode: 1, output: '', errors: 'Error: invalid --mcp-config' })).toBe(
      false,
    )
    expect(isManagedMcpRefusal({ exitCode: 0, output: REFUSAL, errors: REFUSAL })).toBe(false)
    expect(isManagedMcpRefusal({ exitCode: 1, output: '', errors: 'cannot use --strict-mcp-config' })).toBe(
      false,
    )
  })
})

describe('firstErrorLine', () => {
  it('gives the first line written, trimmed', () => {
    expect(firstErrorLine({ exitCode: 1, output: '', errors: '\n  Error: no session  \nsecond\n' }, [])).toBe(
      'Error: no session',
    )
    expect(firstErrorLine({ exitCode: 1, output: 'printed' }, [])).toBeNull()
    expect(firstErrorLine({ exitCode: 1, output: '', errors: ' \n\n' }, [])).toBeNull()
  })

  it('withholds every secret, drops control and bidi characters and keeps to 160 characters', () => {
    const line = firstErrorLine(
      {
        exitCode: 1,
        output: '',
        errors: `token hba_secret in /home/june/creds.json‮\u0007 ${'x'.repeat(300)}`,
      },
      ['hba_secret', '/home/june/creds.json', ''],
    )!
    expect(line.startsWith('token [withheld] in [withheld] x')).toBe(true)
    expect(line).toHaveLength(160)
    expect(line.endsWith('…')).toBe(true)
  })

  it('never returns a secret it was given, nor more than one line', () => {
    fc.assert(
      fc.property(fc.string(), fc.string({ minLength: 8 }), (text, secret) => {
        const line = firstErrorLine({ exitCode: 1, output: '', errors: `${text}${secret}${text}` }, [secret])
        expect(line ?? '').not.toContain('\n')
        expect((line ?? '').length).toBeLessThanOrEqual(160)
      }),
    )
  })
})
