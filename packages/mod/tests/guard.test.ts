import { expect, test } from 'claude-code/testing'

import { forbiddenReason } from '../hooks/guard'
import { DRAFT, OVERVIEW, START, engineBeneath } from './world'

test('the model cannot approve or discard through a shell', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW })
  let reached = 0
  on('tool.call', () => {
    reached += 1
    return { result: {} }
  })
  await $.session.start(START)
  await seen.clock.settle()
  const commands = [
    `homingbird approve ${DRAFT.id}`,
    `homingbird --json discard ${DRAFT.id}`,
    `npx -y @homingbird/cli approve ${DRAFT.id} --body "sure"`,
    `node packages/cli/dist/homingbird.js approve ${DRAFT.id}`,
    `tsx packages/cli/src/main.ts discard ${DRAFT.id}`,
    `curl -X POST http://localhost:8080/api/v1/drafts/${DRAFT.id}/send`,
    'curl -X PUT http://localhost:8080/api/v1/blocks/mem_x',
    'curl http://localhost:8080/api/v1/credentials',
  ]
  for (const command of commands) {
    const result = await $.tool.call({ tool: 'Bash', command })
    expect(JSON.stringify(result)).toMatch(/only a person can approve or discard/)
  }
  expect(reached).toBe(0)
})

test('the model cannot read or change the credential files', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: OVERVIEW,
    links: { '/work/innocent.json': '/home/me/.config/homingbird/approval-credential.json' },
  })
  let reached = 0
  on('tool.call', () => {
    reached += 1
    return { result: {} }
  })
  await $.session.start(START)
  await seen.clock.settle()
  const refused = [
    await $.tool.call({ tool: 'Bash', command: 'cat ~/.config/homingbird/approval-credential.json' }),
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

test('the reason names the rule and leaves the mod its own tools', () => {
  expect(forbiddenReason('mcp__homingbird__draft_note', { text: 'homingbird approve x' })).toBeNull()
  expect(forbiddenReason('Bash', { command: 'homingbird approve x' })).toMatch(/only a person can approve/)
  expect(forbiddenReason('Read', { file_path: '/x/.config/homingbird/y' })).toMatch(/credential files/)
  expect(forbiddenReason('Bash', undefined)).toBeNull()
})
