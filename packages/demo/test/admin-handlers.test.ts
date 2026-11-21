import { describe, expect, it } from 'vitest'
import { DEMO_REFUSAL } from '../src/handlers.ts'
import { demoApi, refused, succeeded } from './support/demo.ts'

describe('the administrator’s pages', () => {
  it('reads the settings, offering the features the demo answers', async () => {
    const { api } = demoApi()
    const settings = await succeeded(api['admin.settings.get']({}))
    expect(settings).toMatchObject({ contactMode: 'open', allowedDomains: ['example.com'] })
    expect(settings.features).toMatchObject({ channelAgents: true, cloudDesk: false })
  })

  it('lists the people, and each channel’s agent with its channel', async () => {
    const { api } = demoApi()
    const { members, agents } = await succeeded(api['admin.members.list']({}))
    expect(members.every((member) => member.kind === 'person')).toBe(true)
    expect(agents?.map((agent) => [agent.member.name, agent.channel])).toEqual([
      ['Billing helper', 'billing'],
    ])
  })

  it('reports the organization’s week and month in counts, and changes nothing', async () => {
    const { api } = demoApi()
    const insights = await succeeded(api['admin.insights']({}))
    expect(insights.periods.map((period) => period.days)).toEqual([7, 30])
    expect(insights.weeks).toHaveLength(8)
    expect(
      await refused(
        api['admin.members.update']({ params: { id: 'mem_demoana00000' }, body: { role: 'admin' } }),
      ),
    ).toEqual(DEMO_REFUSAL)
  })
})
