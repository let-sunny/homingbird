import { installFakeDom, uninstallFakeDom } from '@homingbird/ui/testing'
import { afterEach, beforeEach } from 'vitest'

/** Gives each test of the file a fresh fake document. */
export const usingFakeDom = (): void => {
  beforeEach(() => {
    installFakeDom()
  })
  afterEach(() => uninstallFakeDom())
}

/** Puts an element in the document, as the app shell would. */
export const mount = <E>(element: E): E => {
  document.body.append(element as unknown as Node)
  return element
}

/** Lets microtasks and launched callbacks run. */
export const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
