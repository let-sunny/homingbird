import {
  type AsRead,
  type CredentialId,
  DESK_WAKE_HEADERS_MAX,
  type DeskWakeSetup,
} from '@homingbird/protocol'
import { CLOUD_DESK_PRESETS, type CloudDeskPresetId } from '../cloud-desk-presets.ts'
import { strings } from '../strings.ts'
import { dateTimeText } from './time.ts'

/** Cloud desk: the saved wake in words, a form filled from the chosen preset, and the prompt to paste. */
export const cloudDeskModel = (input: CloudDeskInput): CloudDeskModel => {
  const wake = input.wake
  const preset = CLOUD_DESK_PRESETS.find((each) => each.id === input.preset)!
  const agents = (input.credentials ?? []).filter(
    (credential) => credential.kind === 'agent' && credential.revokedAt === null,
  )
  const headers: ReadonlyArray<CloudDeskModel['headers'][number]> = preset.headers
  return {
    loading: wake === undefined || input.credentials === null,
    status: wake === undefined || wake === null ? null : statusOf(wake),
    facts: wake === undefined || wake === null ? [] : factsOf(wake),
    presets: CLOUD_DESK_PRESETS.map((each) => ({
      value: each.id,
      label: PRESET_LABELS[each.id](),
      checked: each.id === preset.id,
    })),
    presetNote: PRESET_NOTES[preset.id](),
    urlPlaceholder: preset.urlPlaceholder,
    headers: Array.from(
      { length: DESK_WAKE_HEADERS_MAX },
      (_, index) => headers[index] ?? { name: '', value: '', placeholder: '' },
    ),
    agents: agents.map((credential) => ({
      value: credential.id,
      label: credential.name,
      selected: wake?.credentialId === credential.id,
    })),
    noAgent: agents.length === 0 ? strings.cloudDesk.noAgent : null,
    enabled: wake?.enabled ?? true,
    replaceHint: wake === undefined || wake === null ? null : strings.cloudDesk.replaceHint,
    isSaved: wake !== undefined && wake !== null,
    tested: input.tested === null ? null : testedText(input.tested),
  }
}

/** What the form holds, as the server takes it: header rows left empty are dropped, names and values trimmed. */
export const deskWakeSetupFrom = (form: CloudDeskForm): DeskWakeSetup => ({
  url: form.url.trim(),
  headers: form.headers
    .map((header) => ({ name: header.name.trim(), value: header.value.trim() }))
    .filter((header) => header.name !== '' || header.value !== ''),
  credentialId: form.credentialId as CredentialId,
  enabled: form.enabled,
})

export interface CloudDeskInput {
  /** Undefined while it loads, null when none is saved. */
  readonly wake: AsRead.DeskWake | null | undefined
  readonly credentials: ReadonlyArray<AsRead.Credential> | null
  readonly preset: CloudDeskPresetId
  readonly tested: AsRead.DeskWakeTest | null
}

export interface CloudDeskForm {
  readonly url: string
  readonly headers: ReadonlyArray<{ readonly name: string; readonly value: string }>
  readonly credentialId: string
  readonly enabled: boolean
}

export interface CloudDeskModel {
  readonly loading: boolean
  readonly status: { readonly text: string; readonly tone: 'is-ok' | 'is-waiting' | 'is-stopped' } | null
  readonly facts: ReadonlyArray<{ readonly term: string; readonly value: string }>
  readonly presets: ReadonlyArray<{
    readonly value: CloudDeskPresetId
    readonly label: string
    readonly checked: boolean
  }>
  readonly presetNote: string
  readonly urlPlaceholder: string
  readonly headers: ReadonlyArray<{
    readonly name: string
    readonly value: string
    readonly placeholder: string
  }>
  readonly agents: ReadonlyArray<{
    readonly value: string
    readonly label: string
    readonly selected: boolean
  }>
  readonly noAgent: string | null
  readonly enabled: boolean
  readonly replaceHint: string | null
  readonly isSaved: boolean
  readonly tested: string | null
}

const PRESET_LABELS: Readonly<Record<CloudDeskPresetId, () => string>> = {
  routine: () => strings.cloudDesk.routine,
  generic: () => strings.cloudDesk.generic,
}

const PRESET_NOTES: Readonly<Record<CloudDeskPresetId, () => string>> = {
  routine: () => strings.cloudDesk.routineNote,
  generic: () => strings.cloudDesk.genericNote,
}

const STATUS_TEXTS: Readonly<Record<AsRead.DeskWake['lastStatus'], () => string>> = {
  never: () => strings.cloudDesk.status.never,
  sent: () => strings.cloudDesk.status.sent,
  online: () => strings.cloudDesk.status.online,
  not_online: () => strings.cloudDesk.status.notOnline,
  refused: () => strings.cloudDesk.status.refused,
  rate_limited: () => strings.cloudDesk.status.rateLimited,
  unreachable: () => strings.cloudDesk.status.unreachable,
  unknown: () => strings.cloudDesk.status.unknown,
}

const STOPPED_TEXTS: Readonly<Record<NonNullable<AsRead.DeskWake['stoppedBecause']>, () => string>> = {
  refused: () => strings.cloudDesk.stopped.refused,
  failures: () => strings.cloudDesk.stopped.failures,
  credential_gone: () => strings.cloudDesk.stopped.credentialGone,
  unreadable: () => strings.cloudDesk.stopped.unreadable,
  unknown: () => strings.cloudDesk.stopped.unknown,
}

const WORKING: ReadonlyArray<AsRead.DeskWake['lastStatus']> = ['never', 'sent', 'online']

const statusOf = (wake: AsRead.DeskWake): NonNullable<CloudDeskModel['status']> => {
  if (wake.stoppedBecause !== null) return { text: STOPPED_TEXTS[wake.stoppedBecause](), tone: 'is-stopped' }
  if (!wake.enabled) return { text: strings.cloudDesk.status.paused, tone: 'is-waiting' }
  return {
    text: STATUS_TEXTS[wake.lastStatus](),
    tone: WORKING.includes(wake.lastStatus) ? 'is-ok' : 'is-waiting',
  }
}

const factsOf = (wake: AsRead.DeskWake): CloudDeskModel['facts'] => [
  { term: strings.cloudDesk.lastWake, value: dateTimeText(wake.lastWakeAt, strings.cloudDesk.never) },
  ...(wake.failures > 0 && wake.stoppedBecause === null
    ? [{ term: strings.cloudDesk.service, value: strings.cloudDesk.failures({ count: wake.failures }) }]
    : []),
]

const testedText = (tested: AsRead.DeskWakeTest): string => {
  const status = String(tested.status)
  if (tested.outcome === 'sent')
    return tested.status === 0 ? strings.cloudDesk.tested.timedOut : strings.cloudDesk.tested.sent({ status })
  if (tested.outcome === 'refused') return strings.cloudDesk.tested.refused({ status })
  if (tested.outcome === 'rate_limited') return strings.cloudDesk.tested.rateLimited({ status })
  if (tested.outcome === 'unreachable') return strings.cloudDesk.tested.unreachable({ status })
  return strings.cloudDesk.tested.unknown
}
