import { type FakeElement, type FakeEventInit, fakeEvent } from './fake-dom.ts'

/** What a person does to an element, as the events a browser would dispatch for it. */
export const fire = {
  click: (element: unknown): void => asElement(element).click(),
  /** Types a whole value into a text control: the value changes, then `input` is dispatched. */
  type: (element: unknown, value: string): void => {
    const control = asElement(element)
    control.value = value
    control.dispatchEvent(fakeEvent('input'))
  },
  /** Commits a value, as leaving a changed control does: the value changes, then `input` and `change`. */
  change: (element: unknown, value: string): void => {
    const control = asElement(element)
    control.value = value
    control.dispatchEvent(fakeEvent('input'))
    control.dispatchEvent(fakeEvent('change'))
  },
  /** Chooses an option of a select by its value. */
  select: (element: unknown, value: string): void => {
    const select = asElement(element)
    select.value = value
    select.dispatchEvent(fakeEvent('input'))
    select.dispatchEvent(fakeEvent('change'))
  },
  key: (element: unknown, key: string, init: Omit<FakeEventInit, 'key'> = {}): boolean =>
    asElement(element).dispatchEvent(fakeEvent('keydown', { ...init, key })),
  submit: (form: unknown): boolean => asElement(form).dispatchEvent(fakeEvent('submit')),
  event: (element: unknown, type: string, init: FakeEventInit = {}): boolean =>
    asElement(element).dispatchEvent(fakeEvent(type, init)),
}

const asElement = (value: unknown): FakeElement => value as FakeElement
