import { type Child, type Properties, h, replaceChildren } from '@homingbird/ui'
import { strings } from '../strings.ts'

export const DIALOG_ID = 'dialog'

export const dialogHost = (): HTMLDialogElement => h('dialog', { id: DIALOG_ID, class: 'dialog' })

export const opensDialog = (title: string, content: () => Child): Properties => ({
  commandfor: DIALOG_ID,
  command: 'show-modal',
  on: {
    click: () =>
      replaceChildren(
        dialogElement(),
        h(
          'header',
          { class: 'dialog-head' },
          h('h2', {}, title),
          h('button', { type: 'button', class: 'icon', 'aria-label': strings.close, ...closesDialog }, '✕'),
        ),
        content(),
      ),
  },
})

export const closesDialog: Properties = { commandfor: DIALOG_ID, command: 'close' }

export const closeDialog = (): void => dialogElement().close()

const dialogElement = (): HTMLDialogElement => document.getElementById(DIALOG_ID) as HTMLDialogElement
