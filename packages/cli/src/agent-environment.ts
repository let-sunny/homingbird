export const agentEnvironment = (
  variables: Readonly<Record<string, string | undefined>>,
  secrets: ReadonlyArray<string>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(variables).flatMap(([name, value]) =>
      value === undefined || isWithheld(name, value, secrets) ? [] : [[name, value]],
    ),
  )

const WITHHELD_NAME = /^(?:HOMINGBIRD|HB)_/i

const isWithheld = (name: string, value: string, secrets: ReadonlyArray<string>): boolean =>
  WITHHELD_NAME.test(name) || secrets.some((secret) => secret !== '' && value.includes(secret))
