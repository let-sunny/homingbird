import { expect, test } from 'claude-code/testing'

import { forbiddenReason } from '../hooks/guard'
import { OVERVIEW, START, engineBeneath } from './world'

test('the model cannot read or change the credential files', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: OVERVIEW,
    links: { '/work/innocent.json': '/home/me/.config/homingbird/agent-credential.json' },
  })
  let reached = 0
  on('tool.call', () => {
    reached += 1
    return { result: {} }
  })
  await $.session.start(START)
  await seen.clock.settle()
  const refused = [
    await $.tool.call({ tool: 'Bash', command: 'cat ~/.config/homingbird/agent-credential.json' }),
    await $.tool.call({ tool: 'Bash', command: 'cat "$XDG_CONFIG_HOME/homingbird/agent-credential.json"' }),
    await $.tool.call({ tool: 'Read', file_path: '/home/me/.config/homingbird/agent-credential.json' }),
    await $.tool.call({
      tool: 'Edit',
      file_path: '/home/me/.config/homingbird/agent-credential.json',
      old_string: 'a',
      new_string: 'b',
    }),
    await $.tool.call({ tool: 'Read', file_path: '/work/innocent.json' }),
  ]
  for (const result of refused) expect(JSON.stringify(result)).toMatch(/credential files/)
  expect(reached).toBe(0)
})

test('ordinary work that merely mentions Homingbird goes through', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW })
  let reached = 0
  on('tool.call', () => {
    reached += 1
    return { result: {} }
  })
  await $.session.start(START)
  await seen.clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "homingbird: approve flow"' })
  await $.tool.call({ tool: 'Bash', command: 'homingbird inbox' })
  await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })
  expect(reached).toBe(3)
})

test('the reason names the files and leaves the plugin its own tools', () => {
  expect(forbiddenReason('mcp__homingbird__draft_note', { text: 'agent-credential.json' })).toBeNull()
  expect(
    forbiddenReason('Bash', { command: 'curl -X POST https://hb.example.com/api/v1/drafts/x/send' }),
  ).toBeNull()
  expect(forbiddenReason('Read', { file_path: '/x/.config/homingbird/y' })).toMatch(/credential files/)
  expect(forbiddenReason('Bash', undefined)).toBeNull()
})
