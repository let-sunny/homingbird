import { type Child, type Lifetime, type Properties, h, lifetime, replaceChildren } from '@homingbird/ui'
import { strings } from '../strings.ts'

export const DIALOG_ID = 'dialog'

export const dialogHost = (): HTMLDialogElement => h('dialog', { id: DIALOG_ID, class: 'dialog' })

export const opensDialog = (title: string, content: (life: Lifetime) => Child): Properties => ({
  commandfor: DIALOG_ID,
  command: 'show-modal',
  on: { click: () => fillDialog(title, content) },
})

export const showDialog = (title: string, content: (life: Lifetime) => Child): void => {
  fillDialog(title, content)
  if (!dialogElement().open) dialogElement().showModal()
}

export const closesDialog: Properties = { commandfor: DIALOG_ID, command: 'close' }

export const closeDialog = (): void => dialogElement().close()

const fillDialog = (title: string, content: (life: Lifetime) => Child): void => {
  const dialog = dialogElement()
  const life = lifetime()
  dialog.addEventListener('close', () => life.end(), { once: true })
  replaceChildren(
    dialog,
    h(
      'header',
      { class: 'dialog-head' },
      h('h2', {}, title),
      h('button', { type: 'button', class: 'icon', 'aria-label': strings.close, ...closesDialog }, '✕'),
    ),
    content(life),
  )
}

const dialogElement = (): HTMLDialogElement => document.getElementById(DIALOG_ID) as HTMLDialogElement
