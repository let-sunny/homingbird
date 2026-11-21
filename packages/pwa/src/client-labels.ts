import { strings } from './strings.ts'

/** A program's label as people read it: the ones Homingbird itself reports, in the person's language. */
export const clientLabel = (client: string): string => {
  if (client === WEB_CLIENT) return strings.clients.web
  if (client === CLI_CLIENT) return strings.clients.cli
  return client
}

const WEB_CLIENT = 'Web'
const CLI_CLIENT = 'Homingbird CLI'
