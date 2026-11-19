import type { PlaceName, RoutePoint } from '@homingbird/protocol'

export interface RouteNode {
  readonly place: PlaceName
  readonly x: number
  readonly y: number
  readonly strength: number
  readonly width: number
  readonly taught: boolean
  readonly chances: number
  readonly point: RoutePoint
}

/**
 * Lays the places around the person, each joined by a line that grows with what was taught there and
 * how it held up. Edits and discards never thin a line; they are counted as chances to teach.
 */
export const routeLayout = (points: ReadonlyArray<RoutePoint>, size: number): RouteNode[] => {
  const centre = size / 2
  const radius = size * RADIUS_SHARE
  return points.map((point, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(1, points.length)
    const strength = point.principles + point.heldUp
    return {
      place: point.place,
      x: round(centre + radius * Math.cos(angle)),
      y: round(centre + radius * Math.sin(angle)),
      strength,
      width: lineWidth(strength),
      taught: point.principles > 0,
      chances: Math.min(point.chances, MAX_MARKERS),
      point,
    }
  })
}

/** A line's width: thin until something is taught, then growing slowly with each principle and success. */
export const lineWidth = (strength: number): number =>
  strength <= 0 ? MIN_WIDTH : Math.min(MAX_WIDTH, MIN_WIDTH + 1 + Math.log2(1 + strength))

export const MAX_MARKERS = 5

const RADIUS_SHARE = 0.36
const MIN_WIDTH = 1
const MAX_WIDTH = 8

const round = (value: number): number => Math.round(value * 10) / 10
