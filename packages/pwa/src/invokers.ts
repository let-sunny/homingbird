/**
 * Runs `command`/`commandfor` invoker buttons where the browser does not yet: opening and closing a
 * dialog, and showing, hiding or toggling a popover.
 */
export const supportInvokerCommands = (root: Document): void => {
  if ('commandForElement' in root.createElement('button')) return
  root.addEventListener('click', (event) => {
    const invoker = (event.target as Element | null)?.closest?.('button[commandfor]')
    const target = invoker && root.getElementById(invoker.getAttribute('commandfor') ?? '')
    if (!invoker || !target) return
    perform(invoker.getAttribute('command') ?? '', target)
  })
}

const perform = (command: string, target: HTMLElement): void => {
  if (target.localName === 'dialog') {
    const dialog = target as HTMLDialogElement
    if (command === 'show-modal' && !dialog.open) dialog.showModal()
    if (command === 'close' && dialog.open) dialog.close()
    return
  }
  if (command === 'toggle-popover') target.togglePopover()
  if (command === 'show-popover') target.showPopover()
  if (command === 'hide-popover') target.hidePopover()
}
