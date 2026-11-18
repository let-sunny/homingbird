export const supportInvokerCommands = (root: Document): void => {
  if ('commandForElement' in HTMLButtonElement.prototype) return
  root.addEventListener('click', (event) => {
    const invoker = (event.target as Element | null)?.closest?.('button[commandfor]')
    const target = invoker && root.getElementById(invoker.getAttribute('commandfor') ?? '')
    if (!invoker || !target) return
    perform(invoker.getAttribute('command') ?? '', target)
  })
}

const perform = (command: string, target: HTMLElement): void => {
  if (target instanceof HTMLDialogElement) {
    if (command === 'show-modal' && !target.open) target.showModal()
    if (command === 'close' && target.open) target.close()
    return
  }
  if (command === 'toggle-popover') target.togglePopover()
  if (command === 'show-popover') target.showPopover()
  if (command === 'hide-popover') target.hidePopover()
}
