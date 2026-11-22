import { type Child, type Lifetime, type Properties, h, lifetime, replaceChildren } from '@homingbird/ui'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'

export const DIALOG_ID = 'dialog'

export const dialogHost = (): HTMLDialogElement => h('dialog', { id: DIALOG_ID, class: 'dialog' })

export const opensDialog = (
  context: DialogContext,
  title: string,
  content: (life: Lifetime) => Child,
): Properties => ({
  commandfor: DIALOG_ID,
  command: 'show-modal',
  on: { click: () => fillDialog(context, title, content) },
})

export const showDialog = (
  context: DialogContext,
  title: string,
  content: (life: Lifetime) => Child,
): void => {
  fillDialog(context, title, content)
  if (!dialogElement(context).open) dialogElement(context).showModal()
}

export const closesDialog: Properties = { commandfor: DIALOG_ID, command: 'close' }

export const closeDialog = (context: DialogContext): void => dialogElement(context).close()

/** Cmd or Ctrl with Enter submits the form a dialog's text is typed in; Enter alone starts a new line. */
export const submitOnModifierEnter = (event: Event): void => {
  const key = event as KeyboardEvent
  if (key.key !== 'Enter' || !(key.metaKey || key.ctrlKey) || key.isComposing) return
  key.preventDefault()
  ;(key.target as Element | null)?.closest('form')?.requestSubmit()
}

type DialogContext = Pick<ViewContext, 'document'>

const fillDialog = (context: DialogContext, title: string, content: (life: Lifetime) => Child): void => {
  const dialog = dialogElement(context)
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

const dialogElement = (context: DialogContext): HTMLDialogElement =>
  context.document.byId(DIALOG_ID) as HTMLDialogElement
