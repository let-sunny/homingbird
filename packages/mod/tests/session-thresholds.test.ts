import { expect, test } from 'claude-code/testing'

import { FRESH_SESSION_AFTER_MINUTES, FRESH_SESSION_AT_CONTEXT_PERCENT } from '../hooks/session-thresholds'

test('the pane suggests a fresh session after eight hours or at 80% of the context', () => {
  expect(FRESH_SESSION_AFTER_MINUTES).toBe(480)
  expect(FRESH_SESSION_AT_CONTEXT_PERCENT).toBe(80)
})
