import { type AsRead, UNKNOWN } from '@homingbird/protocol'
import { strings } from './strings.ts'

export interface ContactModeChoice {
  readonly value: '' | 'open' | 'contacts'
  readonly label: string
  readonly selected: boolean
  readonly disabled: boolean
}

/** The modes an administrator chooses from; one this version does not know is shown as unknown, never as a known one. */
export const contactModeChoices = (
  mode: AsRead.Settings['contactMode'],
): ReadonlyArray<ContactModeChoice> => [
  ...(mode === UNKNOWN
    ? [{ value: '' as const, label: strings.contactModeUnknown, selected: true, disabled: true }]
    : []),
  { value: 'open', label: strings.contactModeOpen, selected: mode === 'open', disabled: false },
  { value: 'contacts', label: strings.contactModeContacts, selected: mode === 'contacts', disabled: false },
]

/** The mode to save from the chosen value, or null until a mode this version knows is chosen. */
export const contactModeToSave = (value: string): 'open' | 'contacts' | null =>
  value === 'open' || value === 'contacts' ? value : null
