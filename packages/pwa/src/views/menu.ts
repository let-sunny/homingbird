import { type Child, h, later } from '@homingbird/ui'
import { type Point, type Rect, menuPlacement, pointAnchor } from '../models/menu-placement.ts'
import type { ViewContext } from './context.ts'

/**
 * A ⋯ button and the menu it opens, holding a row's or a note's other actions. The same menu opens on a
 * right-click, a long press on a touch screen, and the ContextMenu key or Shift+F10 inside whatever
 * `opensFrom` names; Escape or a choice closes it and gives the focus back to where it was.
 */
export const actionMenu = (context: MenuContext, spec: ActionMenu): MenuParts => {
  const trigger = h(
    'button',
    {
      type: 'button',
      class: `menu-trigger ${spec.triggerClass}`,
      popovertarget: spec.id,
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-label': spec.label,
      title: spec.label,
    },
    spec.trigger ?? '⋯',
  )
  const menu = h(
    'div',
    {
      id: spec.id,
      class: `menu action-menu ${spec.menuClass}`,
      popover: 'auto',
      role: 'menu',
      'aria-label': spec.label,
    },
    spec.items,
  )
  for (const item of menu.querySelectorAll('button')) {
    item.setAttribute('role', 'menuitem')
    item.setAttribute('tabindex', '-1')
  }
  trigger.style.setProperty('anchor-name', `--${spec.id}`)
  menu.style.setProperty('position-anchor', `--${spec.id}`)
  const control = menuControl(context, trigger, menu)
  return { trigger, menu, opensFrom: control.opensFrom }
}

export interface ActionMenu {
  readonly id: string
  /** What the ⋯ button and the menu are called: “More for Ana”. */
  readonly label: string
  readonly triggerClass: string
  /** The button's own words, where ⋯ would not say what it opens. */
  readonly trigger?: string
  readonly menuClass: string
  /** The menu's buttons, in order, each closing the menu when chosen, and any line that explains one. */
  readonly items: ReadonlyArray<Child>
}

export interface MenuParts {
  readonly trigger: HTMLButtonElement
  readonly menu: HTMLElement
  /** Lets a right-click, a long press or a menu key anywhere in `owner` open the menu too. */
  readonly opensFrom: (owner: HTMLElement) => void
}

/** What a menu needs of a view's context: the clock for a long press, the page and the document. */
export type MenuContext = Pick<ViewContext, 'clock' | 'page' | 'document'>

/** How long a finger rests on a row before its menu opens, in milliseconds. */
export const LONG_PRESS_MS = 500

/** Puts a menu at a point or under its button, where the browser cannot anchor it itself. */
export const placeMenu = (
  context: MenuContext,
  menu: HTMLElement,
  at: Rect | null,
  trigger: HTMLElement,
): void => {
  if (at === null && context.page.supportsAnchors()) {
    menu.style.removeProperty('--hb-menu-x')
    menu.style.removeProperty('--hb-menu-y')
    return
  }
  const box = menu.getBoundingClientRect()
  const root = context.document.root()
  const spot = menuPlacement({
    anchor: at ?? trigger.getBoundingClientRect(),
    menu: { width: box.width, height: box.height },
    viewport: { width: root.clientWidth, height: root.clientHeight },
    align: at === null ? 'end' : 'start',
  })
  menu.classList.add('is-at-point')
  menu.style.setProperty('--hb-menu-x', `${spot.x}px`)
  menu.style.setProperty('--hb-menu-y', `${spot.y}px`)
}

const menuControl = (
  context: MenuContext,
  trigger: HTMLButtonElement,
  menu: HTMLElement,
): { readonly opensFrom: (owner: HTMLElement) => void } => {
  let owner: HTMLElement = trigger
  let returnTo: HTMLElement = trigger
  let stopListening = (): void => {}
  const isOpen = (): boolean => menu.matches(':popover-open')
  const items = (): HTMLElement[] =>
    [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
      (item) => !(item as HTMLButtonElement).disabled,
    )
  const close = (): void => {
    if (isOpen()) menu.hidePopover()
  }
  const giveFocusBack = (): void => {
    const focused = context.document.focused()
    if (focused === null || menu.contains(focused) || focused.localName === 'body') returnTo.focus()
  }
  const open = (at: Point | null, byTouch = false): void => {
    if (!menu.isConnected || isOpen()) return
    const focused = context.document.focused()
    returnTo = focused !== null && owner.contains(focused) ? (focused as HTMLElement) : owner
    menu.classList.toggle('is-at-point', at !== null)
    menu.setAttribute('popover', byTouch ? 'manual' : 'auto')
    menu.showPopover()
    placeMenu(context, menu, at === null ? null : pointAnchor(at), trigger)
  }
  trigger.addEventListener('click', () => {
    returnTo = trigger
    if (isOpen()) return
    menu.classList.remove('is-at-point')
    menu.setAttribute('popover', 'auto')
  })
  menu.addEventListener('toggle', (event) => {
    const opened = (event as ToggleEvent).newState === 'open'
    trigger.setAttribute('aria-expanded', String(opened))
    stopListening()
    stopListening = (): void => {}
    if (!opened) return
    if (!menu.classList.contains('is-at-point')) placeMenu(context, menu, null, trigger)
    items()[0]?.focus()
    stopListening = context.document.listen(
      'pointerdown',
      (press) => {
        const target = press.target as Node | null
        if (menu.contains(target) || trigger.contains(target)) return
        if ((press as PointerEvent).pointerType === 'touch') swallowTheTap(context)
        close()
      },
      { capture: true },
    )
  })
  menu.addEventListener('keydown', (event) => {
    const step = STEPS.get(event.key)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      giveFocusBack()
    } else if (event.key === 'Tab') close()
    else if (step !== undefined) {
      event.preventDefault()
      const all = items()
      const at = all.indexOf(context.document.focused() as HTMLElement)
      all[step(at, all.length)]?.focus()
    }
  })
  menu.addEventListener('click', (event) => {
    const chosen = (event.target as Element).closest<HTMLButtonElement>('[role="menuitem"]')
    if (chosen === null || chosen.disabled) return
    close()
    giveFocusBack()
  })
  const opensFrom = (element: HTMLElement): void => {
    owner = element
    owner.dataset.menuOwner = menu.id
    const press = longPress(context, owner, menu, open)
    owner.addEventListener('contextmenu', (event) => {
      if (menu.contains(event.target as Node) || isOpen()) return void event.preventDefault()
      if ((event.target as Element).closest(KEEPS_BROWSER_MENU) !== null) return
      event.preventDefault()
      open({ x: event.clientX, y: event.clientY }, press.isTouching())
    })
    owner.addEventListener('keydown', (event) => {
      if (menu.contains(event.target as Node)) return
      if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
      event.preventDefault()
      open(null)
    })
  }
  return { opensFrom }
}

/**
 * A finger that rests on the owner without moving opens the menu where it rests; the click that
 * follows the lift is swallowed, so the press does not also follow a link or pick a note. The menu
 * opens as a manual popover: an automatic one would be dismissed by the lift of that same finger.
 */
const longPress = (
  context: MenuContext,
  owner: HTMLElement,
  menu: HTMLElement,
  open: (at: Point, byTouch: boolean) => void,
): { readonly isTouching: () => boolean } => {
  let cancel = (): void => {}
  let start: Point | null = null
  let touching = false
  let pressed = false
  owner.addEventListener('pointerdown', (event) => {
    cancel()
    pressed = false
    touching = event.pointerType === 'touch'
    if (!touching || menu.contains(event.target as Node)) return
    const at = { x: event.clientX, y: event.clientY }
    start = at
    cancel = later(context.clock, LONG_PRESS_MS, () => {
      pressed = true
      open(at, true)
    })
  })
  owner.addEventListener('pointermove', (event) => {
    if (start === null) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) stop()
  })
  const stop = (): void => {
    cancel()
    start = null
  }
  for (const kind of ['pointerup', 'pointercancel'] as const)
    owner.addEventListener(kind, () => {
      stop()
      touching = false
    })
  owner.addEventListener(
    'click',
    (event) => {
      if (!pressed) return
      pressed = false
      event.preventDefault()
      event.stopPropagation()
    },
    { capture: true },
  )
  return { isTouching: () => touching }
}

/**
 * On a touch screen the menu is a sheet over a dimmed page, and a tap on the dimmed part only closes
 * it: the click that tap would make is swallowed, so it does not also press what was under the finger.
 * The next press ends the wait, in case the finger scrolled and no click came.
 */
const swallowTheTap = (context: MenuContext): void => {
  const stop = (): void => {
    stopClick()
    stopNextPress()
  }
  const stopClick = context.document.listen(
    'click',
    (click) => {
      click.preventDefault()
      click.stopPropagation()
      stop()
    },
    { capture: true },
  )
  const stopNextPress = context.document.listen('pointerdown', stop, { capture: true })
}

/** A link that leaves the app, or a field, keeps the browser's own menu: copying a link, pasting. */
const KEEPS_BROWSER_MENU = 'a[target="_blank"], input, textarea, select'

/** A finger that moves this far is scrolling, not pressing, in CSS pixels. */
const MOVE_TOLERANCE_PX = 10

const STEPS: ReadonlyMap<string, (at: number, count: number) => number> = new Map([
  ['ArrowDown', (at: number, count: number) => (at + 1) % count],
  ['ArrowUp', (at: number, count: number) => (at <= 0 ? count - 1 : at - 1)],
  ['Home', () => 0],
  ['End', (_: number, count: number) => count - 1],
])
