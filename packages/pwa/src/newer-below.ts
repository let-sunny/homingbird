/** What the thread knows when it decides whether to point at something new below the view. */
export interface BelowView {
  /** Item keys in the order they are shown, oldest first. */
  readonly order: ReadonlyArray<string>
  /** Items the person has not had in view since they arrived or changed. */
  readonly unseen: ReadonlySet<string>
  /** Items in view now. */
  readonly inView: ReadonlySet<string>
  readonly atBottom: boolean
}

/**
 * Whether to show "Newer notes below": only for something the person has not seen that sits below
 * what is in view. Being scrolled up over notes already read is not a reason.
 */
export const showsNewerBelow = (view: BelowView): boolean => {
  if (view.atBottom || view.unseen.size === 0) return false
  const lastInView = view.order.reduce((last, key, index) => (view.inView.has(key) ? index : last), -1)
  return view.order.some((key, index) => index > lastInView && view.unseen.has(key))
}

/** The items that are new or changed since the last draw, by their rendered signature. */
export const changedItems = (
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] => [...after].filter(([key, signature]) => before.get(key) !== signature).map(([key]) => key)

/** What stays unseen after a draw: everything changed while the person was scrolled up joins it. */
export const unseenAfterDraw = (
  unseen: ReadonlySet<string>,
  changed: ReadonlyArray<string>,
  isPinnedToBottom: boolean,
): Set<string> => (isPinnedToBottom ? new Set() : new Set([...unseen, ...changed]))
