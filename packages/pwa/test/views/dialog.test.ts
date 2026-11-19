import { getByRole } from '@homingbird/ui/testing'
import { describe, expect, it, vi } from 'vitest'
import { browserDocument } from '../../src/page-document.ts'
import { strings } from '../../src/strings.ts'
import {
  DIALOG_ID,
  closeDialog,
  closesDialog,
  dialogHost,
  opensDialog,
  showDialog,
} from '../../src/views/dialog.ts'
import { mount, usingFakeDom } from '../support/dom.ts'

usingFakeDom()

const context = { document: browserDocument(() => document) }

describe('the dialog', () => {
  it('opens from a button with its title and content, and ends the content’s lifetime when it closes', () => {
    const dialog = mount(dialogHost())
    const ended = vi.fn()
    const opener = mount(Object.assign(document.createElement('button'), { type: 'button' }))
    const properties = opensDialog(context, 'Rename', (life) => {
      life.add(ended)
      return 'content'
    })
    opener.setAttribute('commandfor', String(properties.commandfor))
    opener.setAttribute('command', String(properties.command))
    opener.addEventListener('click', (properties.on as { click: () => void }).click)
    opener.click()
    expect(dialog.open).toBe(true)
    expect(getByRole(dialog, 'heading', { name: 'Rename' })).toBeTruthy()
    getByRole(dialog, 'button', { name: strings.close }).click()
    expect(dialog.open).toBe(false)
    expect(ended).toHaveBeenCalled()
    expect(closesDialog).toEqual({ commandfor: DIALOG_ID, command: 'close' })
  })

  it('shows itself when asked, and closes when told', () => {
    const dialog = mount(dialogHost())
    showDialog(context, 'Hello', () => 'there')
    showDialog(context, 'Again', () => 'here')
    expect(dialog.open).toBe(true)
    expect(dialog.textContent).toContain('here')
    closeDialog(context)
    expect(dialog.open).toBe(false)
  })
})
