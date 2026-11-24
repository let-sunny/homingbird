/**
 * Runs `change`, which replaces what `host` shows, and leaves the page where it was.
 *
 * Removing the focused element makes the browser blur it and lay the page out at once, while the old
 * content is gone and the new is not yet in: every container that scrolls around the host shrinks to
 * what is left and loses its place. So the scroll of each one is put back, and the focus moves to the
 * control that stands where the focused one stood, held at the same place on screen, with the caret where
 * it was in a text that stayed the same. An element with a `data-key` is followed by its key, so a row that
 * moved keeps the focus on its own control.
 */
export const keepingPlace = (host: Element, change: () => void): void => {
  const focused = host.ownerDocument.activeElement
  if (focused === null || focused === host || !host.contains(focused)) {
    change()
    return
  }
  const path = pathTo(host, focused)
  const scrolled = scrollPositions(host)
  const top = focused.getBoundingClientRect().top
  const caret = caretIn(focused)
  change()
  for (const place of scrolled) {
    place.element.scrollTop = place.top
    place.element.scrollLeft = place.left
  }
  const counterpart = nodeAt(host, path)
  if (!isCounterpart(counterpart, focused)) return
  counterpart.focus({ preventScroll: true })
  if (caret !== null && caret.text === (counterpart as HTMLTextAreaElement).value)
    Object.assign(counterpart, { selectionStart: caret.start, selectionEnd: caret.end })
  scrollAncestorsBy(counterpart, counterpart.getBoundingClientRect().top - top)
}

/** Runs `change`, such as folding the text above a control, and scrolls so the control stays where it was on screen. */
export const holdingStill = (control: Element, change: () => void): void => {
  const top = control.getBoundingClientRect().top
  change()
  scrollAncestorsBy(control, control.getBoundingClientRect().top - top)
}

interface PathStep {
  readonly key: string | null
  readonly index: number
}

interface ScrollPlace {
  readonly element: Element
  readonly top: number
  readonly left: number
}

/** Each ancestor of the host, nearest first, with where it is scrolled to. */
const scrollPositions = (host: Element): ScrollPlace[] => {
  const places: ScrollPlace[] = []
  for (let element = host.parentElement; element !== null; element = element.parentElement)
    places.push({ element, top: element.scrollTop, left: element.scrollLeft })
  return places
}

/**
 * Scrolls the element's ancestors, nearest first, by the distance in all: an ancestor that does not
 * scroll, or reaches its end, leaves the rest to the next one.
 */
const scrollAncestorsBy = (element: Element, distance: number): void => {
  let remaining = distance
  for (
    let ancestor = element.parentElement;
    ancestor !== null && remaining !== 0;
    ancestor = ancestor.parentElement
  ) {
    const before = ancestor.scrollTop
    ancestor.scrollTop = before + remaining
    remaining -= ancestor.scrollTop - before
  }
}

/** The steps from the host down to the node: each child's key where it has one, else its index. */
const pathTo = (host: Element, node: Element): PathStep[] => {
  const path: PathStep[] = []
  for (let current = node; current !== host; current = current.parentElement!)
    path.unshift({
      key: current.getAttribute('data-key'),
      index: Array.prototype.indexOf.call(current.parentElement!.childNodes, current),
    })
  return path
}

const nodeAt = (host: Element, path: ReadonlyArray<PathStep>): Node | null =>
  path.reduce<Node | null>((node, step) => (node === null ? null : childAt(node, step)), host)

const childAt = (parent: Node, step: PathStep): Node | null =>
  step.key === null
    ? (parent.childNodes[step.index] ?? null)
    : (Array.prototype.find.call(
        parent.childNodes,
        (child: Node) => child.nodeType === 1 && (child as Element).getAttribute('data-key') === step.key,
      ) ?? null)

/** Where the caret is in a multi-line text; an input keeps none for some of its types. */
const caretIn = (focused: Element): Caret | null => {
  if (focused.localName !== 'textarea') return null
  const { value, selectionStart, selectionEnd } = focused as HTMLTextAreaElement
  return { text: value, start: selectionStart, end: selectionEnd }
}

interface Caret {
  readonly text: string
  readonly start: number
  readonly end: number
}

/** The same kind of control, so focus never lands on something else that took its place. */
const isCounterpart = (node: Node | null, focused: Element): node is HTMLElement =>
  node !== null &&
  node.nodeType === 1 &&
  (node as Element).localName === focused.localName &&
  (node as Element).className === focused.className
