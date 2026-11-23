/** Times as Intl writes them differ in which spaces they use between versions; compare them with plain ones. */
export const plainSpaces = <T extends string | ReadonlyArray<unknown> | null>(text: T): T =>
  (Array.isArray(text)
    ? text.map(plainSpaces)
    : typeof text === 'string'
      ? text.replace(/[  ]/g, ' ')
      : text) as T
