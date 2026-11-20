import { describe, expect, it } from 'vitest'
import * as tasks from '../../src/tasks/admin.ts'
import { testApp } from '../support/app.ts'
import { ANA, member } from '../support/fixtures.ts'

describe('administration tasks', () => {
  it('loads and saves settings, lists and changes members, resets a character and loads insights', async () => {
    const { run, routes, state } = testApp({
      'admin.settings.get': () => ({ allowedDomains: [], contactMode: 'open' }),
      'server.info': () => ({
        name: 'dovecote',
        version: '0.3.1',
        contactMode: 'open',
        signInWith: 'dev',
        protocolVersion: 1,
        features: { cloudDesk: true },
      }),
      'admin.members.list': () => ({ members: [member(ANA, 'Ana')] }),
      'admin.members.resetCharacter': () => member(ANA, 'Ana'),
      'directory.list': () => ({ entries: [] }),
      'contacts.list': () => ({ contacts: [] }),
    })
    await run(tasks.loadSettings)
    await run(tasks.saveSettings({ allowedDomains: [], contactMode: 'open' }))
    expect(state.serverInfo.get()?.features).toEqual({ cloudDesk: true })
    expect(await run(tasks.listMembers)).toEqual({ _tag: 'Ok', value: [member(ANA, 'Ana')] })
    await run(tasks.updateMember(ANA, { role: 'admin' }))
    expect(await run(tasks.resetMemberCharacter(ANA))).toEqual({ _tag: 'Ok', value: member(ANA, 'Ana') })
    await run(tasks.loadInsights)
    expect(routes().filter((route) => route !== 'directory.list' && route !== 'contacts.list')).toEqual([
      'admin.settings.get',
      'admin.settings.put',
      'server.info',
      'admin.members.list',
      'admin.members.update',
      'admin.members.resetCharacter',
      'admin.insights',
    ])
  })
})
