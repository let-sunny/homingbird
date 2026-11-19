import { describe, expect, it } from 'vitest'
import { serviceManagerFor, servicePlace } from '../src/service-managers.ts'

describe('the service manager of each platform', () => {
  it('is launchd on macOS, systemd on Linux, the Run key on Windows, and none elsewhere', () => {
    expect(serviceManagerFor('darwin')?.kind).toBe('launchd user agent')
    expect(serviceManagerFor('linux')?.kind).toBe('systemd user service')
    expect(serviceManagerFor('win32')?.kind).toBe('Run key entry')
    expect(serviceManagerFor('freebsd')).toBeNull()
  })

  it('finds the person’s directories, honouring XDG_CONFIG_HOME, and the Windows user', () => {
    expect(servicePlace({ variables: {}, homeDirectory: '/home/june', userId: 1000 })).toEqual({
      homeDirectory: '/home/june',
      configDirectory: '/home/june/.config/homingbird',
      systemdDirectory: '/home/june/.config/systemd/user',
      userId: 1000,
      windowsUser: null,
    })
    expect(
      servicePlace({ variables: { XDG_CONFIG_HOME: '/xdg' }, homeDirectory: '/home/june', userId: 1000 }),
    ).toMatchObject({ configDirectory: '/xdg/homingbird', systemdDirectory: '/xdg/systemd/user' })
    const windowsUser = (variables: Record<string, string>) =>
      servicePlace({ variables, homeDirectory: 'C:\\Users\\june', userId: null }).windowsUser
    expect(windowsUser({ USERNAME: 'june', USERDOMAIN: 'EXAMPLE' })).toBe('EXAMPLE\\june')
    expect(windowsUser({ USERNAME: 'june' })).toBe('june')
    expect(windowsUser({ USERNAME: ' ' })).toBeNull()
  })
})
