/**
 * The person's variables with the directories where the agents' own Windows installers put their
 * programs added to the end of PATH. A Run key starts the service at logon, when PATH may not hold
 * them yet. Nothing changes on other systems.
 */
export const withAgentInstallDirectories = (
  variables: Readonly<Record<string, string | undefined>>,
  platform: string,
): Readonly<Record<string, string | undefined>> => {
  if (platform !== 'win32') return variables
  const name = Object.keys(variables).find((each) => each.toUpperCase() === 'PATH')
  return name === undefined ? variables : { ...variables, [name]: agentSearchPath(variables, platform) }
}

/** PATH as the runner searches it for an agent's program: on Windows, with the installers' directories; undefined when unset. */
export const agentSearchPath = (
  variables: Readonly<Record<string, string | undefined>>,
  platform: string,
): string | undefined => {
  const name = Object.keys(variables).find((each) => each.toUpperCase() === 'PATH')
  const path = name === undefined ? undefined : variables[name]
  if (platform !== 'win32' || path === undefined) return path
  const listed = path.split(';').filter((directory) => directory !== '')
  const added = installDirectories(variables).filter(
    (directory) => !listed.some((each) => each.toLowerCase() === directory.toLowerCase()),
  )
  return [...listed, ...added].join(';')
}

const installDirectories = (variables: Readonly<Record<string, string | undefined>>): string[] => {
  const profile = variables.USERPROFILE
  const local = variables.LOCALAPPDATA ?? (profile === undefined ? undefined : `${profile}\\AppData\\Local`)
  const roaming = variables.APPDATA ?? (profile === undefined ? undefined : `${profile}\\AppData\\Roaming`)
  return [
    ...(profile === undefined ? [] : [`${profile}\\.local\\bin`]),
    ...(local === undefined ? [] : [`${local}\\Programs\\OpenAI\\Codex\\bin`, `${local}\\agy\\bin`]),
    ...(roaming === undefined ? [] : [`${roaming}\\npm`]),
  ]
}
