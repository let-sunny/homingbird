import { describe, expect, it } from 'vitest'
import { cmdCommand } from '../src/windows-shell.ts'

describe('cmdCommand', () => {
  it('runs one command line through cmd.exe with delayed expansion off', () => {
    expect(cmdCommand('C:\\Windows', 'codex mcp list')).toEqual([
      'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/v:off', '/s', '/c', '"codex mcp list"'],
    ])
  })
})
