import { NOTE_BODY_MAX } from '@homingbird/protocol'
import { escapeSlackText } from './slack-web-api.ts'

/** A Slack message as a note body: its markup as plain text, cut to a note's length with a marker. */
export const plainFromSlack = (
  text: string,
  names: ReadonlyMap<string, string>,
  appUserId: string,
): string => {
  const plain = text
    .replaceAll(`<@${appUserId}>`, '')
    .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_, user: string) => `@${names.get(user) ?? 'someone'}`)
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, (_, name: string) => `#${name}`)
    .replace(/<#[A-Z0-9]+>/g, '#channel')
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, (_, name: string) => `@${name}`)
    .replace(/<!subteam\^[A-Z0-9]+(?:\|([^>]*))?>/g, (_, name: string | undefined) => name ?? '@group')
    .replace(/<!date\^[^|>]*\|([^>]*)>/g, (_, fallback: string) => fallback)
    .replace(/<((?:https?|mailto):[^|>]+)\|([^>]*)>/g, (_, url: string, label: string) =>
      label === url ? url : `${label} (${url})`,
    )
    .replace(/<((?:https?|mailto):[^>]+)>/g, (_, url: string) => url)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
  return plain.length <= NOTE_BODY_MAX ? plain : `${plain.slice(0, NOTE_BODY_MAX - CUT.length)}${CUT}`
}

export const mentionedUsers = (text: string, appUserId: string): string[] =>
  [...new Set([...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((match) => match[1]!))]
    .filter((user) => user !== appUserId)
    .slice(0, MENTIONS_NAMED)

/** Escaped, a posted note cannot mention anyone, ping a channel or disguise a link. */
export const slackPostOf = (provenance: string, body: string): string =>
  `${escapeSlackText(provenance)}\n${escapeSlackText(body)}`

export const DELETED_IN_SLACK = 'Deleted in Slack.'

const CUT = '\n[Cut: the message was longer than a note.]'
const MENTIONS_NAMED = 5
