import { expect, test } from 'claude-code/testing'

import { optionally } from '../hooks/host-support'

test('a hook an older host refuses is reported, and does not stop the rest from registering', () => {
  const registered: string[] = []
  const refuses = optionally(() => {
    throw new Error('"tool.run" is not an event')
  })
  const accepts = optionally(() => registered.push('ui.render'))
  expect(refuses).toBe(false)
  expect(accepts).toBe(true)
  expect(registered).toEqual(['ui.render'])
})
