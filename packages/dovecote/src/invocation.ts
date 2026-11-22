import { SERVER_VERSION } from './version.ts'

/**
 * What `dovecote <arguments>` asks for. Only no arguments, or `serve`, starts the server, so a mistyped
 * or newer command never starts a second one beside the running server.
 */
export const invocationOf = (args: ReadonlyArray<string>): Invocation => {
  const [first, ...rest] = args
  if (first === undefined || (first === 'serve' && rest.length === 0)) return { kind: 'serve' }
  if (HELP.has(first)) return { kind: 'print', text: DOVECOTE_USAGE, exitCode: 0 }
  if (first === '--version') return { kind: 'print', text: `dovecote ${SERVER_VERSION}`, exitCode: 0 }
  if (isCommandName(first)) return { kind: 'command', command: first, args: rest }
  return {
    kind: 'print',
    text: `${first === 'serve' ? '`dovecote serve` takes no arguments.' : `dovecote has no command "${first}".`}\n${DOVECOTE_USAGE}`,
    exitCode: 2,
  }
}

export type Invocation =
  | { readonly kind: 'serve' }
  | { readonly kind: 'command'; readonly command: CommandName; readonly args: ReadonlyArray<string> }
  | { readonly kind: 'print'; readonly text: string; readonly exitCode: number }

export const COMMAND_NAMES = ['audit', 'notes', 'members'] as const

export type CommandName = (typeof COMMAND_NAMES)[number]

export const DOVECOTE_USAGE = `Usage: dovecote [serve]          start the server
       dovecote audit verify
       dovecote audit export [--since YYYY-MM-DD] [--until YYYY-MM-DD]
       dovecote audit purge-legacy
       dovecote notes export <email>
       dovecote notes delete-drafts <email> [--yes]
       dovecote notes retention --dry-run [--days N]
       dovecote members verify-left <email>
       dovecote --help | --version
A command needs only HB_DATABASE_URL; members verify-left also reads HB_ADMIN_EMAILS.`

const isCommandName = (word: string): word is CommandName =>
  (COMMAND_NAMES as ReadonlyArray<string>).includes(word)

const HELP: ReadonlySet<string> = new Set(['--help', '-h', 'help'])
