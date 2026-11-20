import { CURRENT, type Dialect, LEGACY } from './dialect.ts'

export type RequestedVersion =
  | { readonly kind: 'unstated' }
  | { readonly kind: 'supported'; readonly dialect: Dialect }
  | { readonly kind: 'unsupported'; readonly version: string }

export const requestedVersionOf = (header: string | undefined): RequestedVersion => {
  const version = header?.trim() ?? ''
  if (version === '') return { kind: 'unstated' }
  const dialect = SUPPORTED.find((one) => isSameMinor(version, one.version))
  return dialect === undefined ? { kind: 'unsupported', version } : { kind: 'supported', dialect }
}

export const SUPPORTED: ReadonlyArray<Dialect> = [CURRENT, LEGACY]

const isSameMinor = (requested: string, supported: string): boolean =>
  requested === supported ||
  (requested.startsWith(`${supported}.`) && /^\d+$/.test(requested.slice(supported.length + 1)))
