import { expect, test } from 'claude-code/testing'

import { autoDraftOf } from '../hooks/drafting'

test('the drafting mode is read safely', () => {
  expect(autoDraftOf('quiet')).toBe('quiet')
  expect(autoDraftOf('off')).toBe('off')
  expect(autoDraftOf(undefined)).toBe('turn')
  expect(autoDraftOf('anything else')).toBe('turn')
})
