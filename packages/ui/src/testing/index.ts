export {
  type FakeDocument,
  type FakeDomOptions,
  type FakeElement,
  type FakeEvent,
  type FakeEventInit,
  type FakeNode,
  fakeDocument,
  fakeEvent,
  installFakeDom,
  isPopoverOpen,
  uninstallFakeDom,
} from './fake-dom.ts'
export { fire } from './fire.ts'
export {
  type NameOptions,
  accessibleName,
  allByRole,
  allByText,
  getByRole,
  getByTestId,
  getByText,
  queryByRole,
  queryByText,
  roleOf,
  textOf,
} from './queries.ts'
export { matchesSelector } from './selectors.ts'
