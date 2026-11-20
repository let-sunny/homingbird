import { describe, expect, it } from 'vitest'
import { agentSearchPath, withAgentInstallDirectories } from '../src/agent-install-directories.ts'

const WINDOWS = {
  Path: 'C:\\Windows\\System32;c:\\users\\june\\.local\\bin;',
  USERPROFILE: 'C:\\Users\\june',
  LOCALAPPDATA: 'C:\\Users\\june\\AppData\\Local',
}

describe('agentSearchPath', () => {
  it('adds, on Windows, the directories the agents’ installers use, once and whatever their letter case', () => {
    expect(agentSearchPath(WINDOWS, 'win32')).toBe(
      [
        'C:\\Windows\\System32',
        'c:\\users\\june\\.local\\bin',
        'C:\\Users\\june\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin',
        'C:\\Users\\june\\AppData\\Local\\agy\\bin',
        'C:\\Users\\june\\AppData\\Roaming\\npm',
      ].join(';'),
    )
  })

  it('takes the local and roaming folders from the profile when Windows does not name them', () => {
    expect(agentSearchPath({ PATH: 'C:\\bin', APPDATA: 'D:\\Roaming' }, 'win32')).toBe(
      'C:\\bin;D:\\Roaming\\npm',
    )
    expect(agentSearchPath({ PATH: 'C:\\bin' }, 'win32')).toBe('C:\\bin')
  })

  it('leaves PATH as it is elsewhere, and unset when it is unset', () => {
    expect(agentSearchPath({ PATH: '/usr/bin', USERPROFILE: '/home/june' }, 'linux')).toBe('/usr/bin')
    expect(agentSearchPath({ USERPROFILE: 'C:\\Users\\june' }, 'win32')).toBeUndefined()
  })
})

describe('withAgentInstallDirectories', () => {
  it('writes the longer PATH under the name Windows gave it', () => {
    const variables = withAgentInstallDirectories(WINDOWS, 'win32')
    expect(variables.Path).toContain('Codex\\bin')
    expect(variables).not.toHaveProperty('PATH')
    expect(withAgentInstallDirectories({ USERPROFILE: 'C:\\Users\\june' }, 'win32')).toEqual({
      USERPROFILE: 'C:\\Users\\june',
    })
    const elsewhere = { PATH: '/usr/bin' }
    expect(withAgentInstallDirectories(elsewhere, 'darwin')).toBe(elsewhere)
  })
})
