import type { AsRead } from '@homingbird/protocol'
import { type Child, h } from '@homingbird/ui'
import { type NewMenuItem, newMenuModel } from '../models/new-menu.ts'
import { strings } from '../strings.ts'
import { channelCreateForm } from './channels.ts'
import type { ViewContext } from './context.ts'
import { debateCreateForm } from './debates.ts'
import { opensDialog } from './dialog.ts'
import { actionMenu } from './menu.ts'

/**
 * The New button at the head of the list and its menu: a message opens the new-message screen, a
 * channel or a debate room the same form its own page opens.
 */
export const newMenu = (context: ViewContext, me: AsRead.Me): Child => {
  const model = newMenuModel(context.state.serverInfo.get())
  const parts = actionMenu(context, {
    id: model.id,
    label: model.label,
    trigger: model.trigger,
    triggerClass: 'new-menu-trigger',
    menuClass: 'new-menu',
    items: model.items.map((item) => menuItem(context, me, item)),
  })
  return [parts.trigger, parts.menu]
}

const menuItem = (context: ViewContext, me: AsRead.Me, item: NewMenuItem): HTMLElement =>
  h(
    'button',
    {
      type: 'button',
      class: `menu-item new-menu-${item.kind}`,
      ...(item.kind === 'message'
        ? { on: { click: () => context.page.go(item.href) } }
        : item.kind === 'channel'
          ? opensDialog(context, strings.createChannelTitle, (life) => channelCreateForm(context, life))
          : opensDialog(context, strings.debates.newRoom, (life) => debateCreateForm(context, life, me))),
    },
    h('span', { class: 'menu-item-label' }, item.label),
    h('small', { class: 'menu-item-hint' }, item.hint),
  )
