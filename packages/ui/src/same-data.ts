/**
 * Whether two plain values hold the same data: primitives by `Object.is`, arrays, maps and plain
 * objects by their contents, sets by membership. A view model built twice from unchanged state is the
 * same data, so a region that depends on it need not redraw.
 */
export const isSameData = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right))
    return Array.isArray(left) && Array.isArray(right) && isSameList(left, right)
  if (left instanceof Map || right instanceof Map)
    return left instanceof Map && right instanceof Map && isSameMap(left, right)
  if (left instanceof Set || right instanceof Set)
    return left instanceof Set && right instanceof Set && isSameSet(left, right)
  return isSameRecord(left as Record<string, unknown>, right as Record<string, unknown>)
}

const isSameList = (left: ReadonlyArray<unknown>, right: ReadonlyArray<unknown>): boolean =>
  left.length === right.length && left.every((value, index) => isSameData(value, right[index]))

const isSameMap = (left: ReadonlyMap<unknown, unknown>, right: ReadonlyMap<unknown, unknown>): boolean =>
  left.size === right.size &&
  [...left].every(([key, value]) => right.has(key) && isSameData(value, right.get(key)))

const isSameSet = (left: ReadonlySet<unknown>, right: ReadonlySet<unknown>): boolean =>
  left.size === right.size && [...left].every((value) => right.has(value))

const isSameRecord = (left: Record<string, unknown>, right: Record<string, unknown>): boolean => {
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && isSameData(left[key], right[key]))
  )
}
