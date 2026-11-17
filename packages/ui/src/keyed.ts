export type KeyedOperation<K> =
  | { readonly type: 'remove'; readonly key: K }
  | { readonly type: 'place'; readonly key: K; readonly before: K | null }

export function* keyedOperations<K>(
  previous: ReadonlyArray<K>,
  next: ReadonlyArray<K>,
): Generator<KeyedOperation<K>, void> {
  const wanted = new Set(next)
  const current = previous.filter((key) => {
    return wanted.has(key)
  })
  for (const key of previous) if (!wanted.has(key)) yield { type: 'remove', key }
  for (const [index, key] of next.entries()) {
    if (current[index] === key) continue
    const from = current.indexOf(key)
    if (from !== -1) current.splice(from, 1)
    const before = current[index] ?? null
    current.splice(index, 0, key)
    yield { type: 'place', key, before }
  }
}

export const applyKeyedOperations = <K>(
  previous: ReadonlyArray<K>,
  operations: Iterable<KeyedOperation<K>>,
): K[] => {
  const result = [...previous]
  for (const operation of operations) {
    const from = result.indexOf(operation.key)
    if (from !== -1) result.splice(from, 1)
    if (operation.type === 'remove') continue
    const at = operation.before === null ? result.length : result.indexOf(operation.before)
    result.splice(at, 0, operation.key)
  }
  return result
}
