import { describe, expect, it } from 'vitest'
import * as tasks from '../../src/tasks/cloud-desk.ts'
import { testApp } from '../support/app.ts'

const WAKE = { host: 'api.anthropic.com', headerNames: ['Authorization'] }

describe('cloud desk tasks', () => {
  it('reads, saves, tests and removes the person’s wake', async () => {
    const { run, routes, sent } = testApp({
      'me.deskWake.get': () => ({ wake: WAKE }),
      'me.deskWake.set': () => WAKE,
      'me.deskWake.test': () => ({ status: 200, outcome: 'sent' }),
    })
    expect(await run(tasks.loadDeskWake)).toMatchObject({ _tag: 'Ok', value: WAKE })
    const setup = {
      url: 'https://api.anthropic.com/x',
      headers: [],
      credentialId: 'cred_x' as never,
      enabled: true,
    }
    expect(await run(tasks.saveDeskWake(setup))).toMatchObject({ _tag: 'Ok', value: WAKE })
    expect(await run(tasks.testDeskWake)).toMatchObject({
      _tag: 'Ok',
      value: { status: 200, outcome: 'sent' },
    })
    await run(tasks.removeDeskWake)
    expect(routes()).toEqual(['me.deskWake.get', 'me.deskWake.set', 'me.deskWake.test', 'me.deskWake.remove'])
    expect(sent[1]!.request).toEqual({ body: setup })
    expect(sent[2]!.request).toEqual({ body: {} })
  })
})
