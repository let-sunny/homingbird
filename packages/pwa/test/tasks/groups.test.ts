import { NotFound } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import * as tasks from '../../src/tasks/groups.ts'
import { open } from '../../src/tasks/resources.ts'
import { fail, testApp } from '../support/app.ts'
import { BEN, CY, TEAM, channel, entry, group, serverInfo } from '../support/fixtures.ts'

const answers = {
  'groups.list': () => ({ groups: [group(TEAM, { memberIds: [BEN] })] }),
  'groups.rename': () => group(TEAM),
  'groups.members.set': () => group(TEAM),
  'admin.groups.create': () => group(TEAM, { name: 'Finance' }),
  'channels.list': () => ({ channels: [channel('billing')], hasMore: false, cursor: null }),
  'directory.list': () => ({ entries: [entry(BEN, 'Ben'), entry(CY, 'Cy')] }),
}

describe('group tasks', () => {
  it('keeps every group the person may see', async () => {
    const { run, state } = testApp(answers)
    await run(open('groups'))
    expect(state.groups.get()).toEqual([group(TEAM, { memberIds: [BEN] })])
    expect(state.groups.load.get().loaded).toBe(true)
  })

  it('asks for no group while the organization has groups off, or the server has none', async () => {
    const off = testApp(answers)
    off.state.serverInfo.set(serverInfo())
    await off.run(open('groups'))
    expect(off.routes()).toEqual([])
    expect(off.state.groups.load.get().loaded).toBe(true)
    const missing = testApp({ 'groups.list': () => fail(NotFound({ message: 'Not found' })) })
    await missing.run(open('groups'))
    expect(missing.state.groups.get()).toEqual([])
    expect(missing.state.groups.load.get().loaded).toBe(true)
  })

  it('renames, sets the members, and deletes a group, then reloads the groups and channels', async () => {
    const { run, sent } = testApp(answers)
    await run(tasks.renameGroup(TEAM, 'Finance'))
    await run(tasks.setGroupMembers(TEAM, [BEN, CY]))
    await run(tasks.deleteGroup(TEAM))
    expect(sent.filter((one) => !one.route.endsWith('.list'))).toEqual([
      { route: 'groups.rename', request: { params: { id: TEAM }, body: { name: 'Finance' } } },
      { route: 'groups.members.set', request: { params: { id: TEAM }, body: { memberIds: [BEN, CY] } } },
      { route: 'admin.groups.delete', request: { params: { id: TEAM } } },
    ])
    expect(sent.filter((one) => one.route === 'groups.list')).toHaveLength(3)
    expect(sent.filter((one) => one.route === 'channels.list')).toHaveLength(3)
  })

  it('creates a team with its name, and returns it', async () => {
    const { run, sent } = testApp(answers)
    expect(await run(tasks.createGroup('Finance'))).toEqual({
      _tag: 'Ok',
      value: group(TEAM, { name: 'Finance' }),
    })
    expect(sent.filter((one) => one.route === 'admin.groups.create').map((one) => one.request)).toEqual([
      { body: { name: 'Finance' } },
    ])
  })

  it('lists who is in a group as the server filters the people list', async () => {
    const { run, sent } = testApp(answers)
    expect(await run(tasks.listPeopleInGroup(TEAM))).toEqual({ _tag: 'Ok', value: [BEN, CY] })
    expect(sent[0]).toEqual({ route: 'directory.list', request: { query: { group: TEAM } } })
  })

  it('reads a chosen file in the browser, and says when it cannot', async () => {
    const { run, routes } = testApp(answers)
    expect(await run(tasks.readImportFile(new Blob(['ana@example.com'])))).toEqual({
      _tag: 'Ok',
      value: 'ana@example.com',
    })
    const unreadable = { text: () => Promise.reject(new Error('gone')) } as unknown as Blob
    expect(await run(tasks.readImportFile(unreadable))).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'Fail', error: { _tag: 'Invalid' } },
    })
    expect(routes()).toEqual([])
  })
})
