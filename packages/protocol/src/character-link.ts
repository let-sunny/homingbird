import { CHARACTER_BYTES_MAX, CharacterSpec } from './character.ts'

/**
 * The web-client link that opens a drafted character in the editor, for the person to review. Opening it
 * saves nothing: only the person's "Use this character" does. The spec travels in the hash, so it never
 * reaches a server log.
 */
export const characterLink = (webClientUrl: string, spec: CharacterSpec): string =>
  `${webClientUrl.replace(/\/+$/, '')}/#/${CHARACTER_ROUTE}/${encodeCharacter(spec)}`

export const CHARACTER_ROUTE = 'character'

/** Base64url of the spec's JSON, without padding. */
export const encodeCharacter = (spec: CharacterSpec): string => {
  let binary = ''
  for (const byte of new TextEncoder().encode(JSON.stringify(spec))) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Reads a character back from a link, or null for anything too long, malformed or not a character. */
export const decodeCharacter = (encoded: string): CharacterSpec | null => {
  if (encoded.length > CHARACTER_LINK_MAX || !BASE64URL.test(encoded)) return null
  const decoded = CharacterSpec.decode(jsonIn(encoded))
  return decoded._tag === 'Ok' ? decoded.value : null
}

/** The longest encoded character a link may carry: the size limit of a character, in base64url. */
export const CHARACTER_LINK_MAX = Math.ceil((CHARACTER_BYTES_MAX * 4) / 3)

const BASE64URL = /^[A-Za-z0-9_-]+$/

const jsonIn = (encoded: string): unknown => {
  try {
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    )
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
