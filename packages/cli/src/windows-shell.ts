/**
 * cmd.exe running one command line as Node's own shell option would, with delayed expansion switched
 * off, so that a `!` in it stays as written whatever the computer's default. A `%NAME%` is still
 * replaced by that variable, which no switch of cmd.exe prevents. It needs `windowsVerbatimArguments`.
 */
export const cmdCommand = (systemRoot: string, command: string): [string, string[]] => [
  `${systemRoot}\\System32\\cmd.exe`,
  ['/d', '/v:off', '/s', '/c', `"${command}"`],
]
