import { describe, expect, it } from 'vitest'
import { contactModeChoices, contactModeToSave } from '../src/contact-mode.ts'
import { strings } from '../src/strings.ts'

describe('contactModeChoices', () => {
  it('offers the two modes and selects the saved one', () => {
    expect(contactModeChoices('contacts')).toEqual([
      { value: 'open', label: strings.contactModeOpen, selected: false, disabled: false },
      { value: 'contacts', label: strings.contactModeContacts, selected: true, disabled: false },
    ])
    expect(contactModeChoices('open').map((choice) => choice.selected)).toEqual([true, false])
  })

  it('shows a mode this version does not know as unknown, selects it, and offers it to no one', () => {
    expect(contactModeChoices('unknown')).toEqual([
      { value: '', label: strings.contactModeUnknown, selected: true, disabled: true },
      { value: 'open', label: strings.contactModeOpen, selected: false, disabled: false },
      { value: 'contacts', label: strings.contactModeContacts, selected: false, disabled: false },
    ])
  })
})

describe('contactModeToSave', () => {
  it('saves only a mode this version knows', () => {
    expect(contactModeToSave('open')).toBe('open')
    expect(contactModeToSave('contacts')).toBe('contacts')
    expect(contactModeToSave('')).toBeNull()
    expect(contactModeToSave('invite_only')).toBeNull()
  })
})
