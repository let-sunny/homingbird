import { expect, test } from 'claude-code/testing'

import { DEFAULT_COMMAND, commandOf, lastJsonLine } from '../hooks/command-line'

test('the configured command is split into words, with the published CLI as the default', () => {
  expect(commandOf({ command: ' node  /opt/homingbird.js ' })).toEqual(['node', '/opt/homingbird.js'])
  expect(commandOf({ command: '' })).toEqual(DEFAULT_COMMAND.split(' '))
  expect(commandOf({})).toEqual(['npx', '-y', '@homingbird/cli'])
})

test('only the last line of output is read as JSON', () => {
  expect(lastJsonLine('progress\n{"ok":true}\n')).toEqual({ ok: true })
  expect(lastJsonLine('not json')).toBeNull()
})
