import { credentialDirectory } from './credentials.ts'
import type { CliEnv } from './environment.ts'
import type { ServiceManager, ServicePlace } from './service-definition.ts'
import { launchdAgent } from './service-launchd.ts'
import { runKeyService } from './service-run-key.ts'
import { systemdUserService } from './service-systemd.ts'

export const serviceManagerFor = (platform: string): ServiceManager | null =>
  platform === 'darwin'
    ? launchdAgent
    : platform === 'linux'
      ? systemdUserService
      : platform === 'win32'
        ? runKeyService
        : null

export const servicePlace = (env: Pick<CliEnv, 'variables' | 'homeDirectory' | 'userId'>): ServicePlace => ({
  homeDirectory: env.homeDirectory,
  configDirectory: credentialDirectory(env),
  systemdDirectory: `${env.variables.XDG_CONFIG_HOME || `${env.homeDirectory}/.config`}/systemd/user`,
  userId: env.userId,
  windowsUser: windowsUser(env.variables),
})

const windowsUser = (variables: Readonly<Record<string, string | undefined>>): string | null => {
  const name = variables.USERNAME?.trim()
  if (!name) return null
  const domain = variables.USERDOMAIN?.trim()
  return domain ? `${domain}\\${name}` : name
}
