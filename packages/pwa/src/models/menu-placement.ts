/**
 * Where a menu goes so that all of it stays on screen: below its anchor, or above it when there is no
 * room below; from the anchor's start for a pointer, or ending at its end for a button.
 */
export const menuPlacement = (input: PlacementInput): Point => {
  const { anchor, menu, viewport, align } = input
  const wanted = align === 'start' ? anchor.left : anchor.right - menu.width
  const below = anchor.bottom + GAP
  const above = anchor.top - GAP - menu.height
  const fitsBelow = below + menu.height <= viewport.height - MARGIN
  return {
    x: clamp(wanted, MARGIN, viewport.width - MARGIN - menu.width),
    y: clamp(fitsBelow || above < MARGIN ? below : above, MARGIN, viewport.height - MARGIN - menu.height),
  }
}

/** A rectangle with no size at a point, for a menu opened where the person pressed. */
export const pointAnchor = (point: Point): Rect => ({
  left: point.x,
  right: point.x,
  top: point.y,
  bottom: point.y,
})

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Rect {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

export interface PlacementInput {
  readonly anchor: Rect
  readonly menu: { readonly width: number; readonly height: number }
  readonly viewport: { readonly width: number; readonly height: number }
  readonly align: 'start' | 'end'
}

/** Kept clear of the screen's edges, in CSS pixels. */
const MARGIN = 8

/** Between the anchor and the menu, in CSS pixels. */
const GAP = 4

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, high))
