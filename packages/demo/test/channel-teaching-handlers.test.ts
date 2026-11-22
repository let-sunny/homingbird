import { describe, expect, it } from 'vitest'
import { demoApi, refused, succeeded } from './support/demo.ts'

describe('teaching the agent of #billing', () => {
  it('starts with an instruction, a source and two principles its managers taught it', async () => {
    const { api } = demoApi()
    const taught = await succeeded(api['channels.agent.teaching.get']({ params: { slug: 'billing' } }))
    expect(taught.instruction).toContain('refund policy')
    expect(taught.sources).toEqual(['https://example.com/policies/refunds'])
    expect(taught.principles.map((principle) => [principle.topic, principle.kind])).toEqual([
      ['Refund window', 'answer'],
      ['Annual plans', 'rule'],
    ])
    expect(taught.principles[0]!.counts).toMatchObject({ applied: 9, sentAsWritten: 7 })
  })

  it('saves the instruction and adds, changes, orders and deletes a principle', async () => {
    const { api } = demoApi()
    const slug = { slug: 'billing' }
    const saved = await succeeded(
      api['channels.agent.teaching.set']({ params: slug, body: { instruction: ' Be brief. ', sources: [] } }),
    )
    expect(saved).toMatchObject({ instruction: 'Be brief.', sources: [] })
    const made = await succeeded(
      api['channels.agent.principles.create']({
        params: slug,
        body: { topic: 'Invoices', rule: 'link the invoice page', taughtFrom: 'discard' },
      }),
    )
    expect(made).toMatchObject({ topic: 'Invoices', origin: 'discard', position: 2, place: null })
    const changed = await succeeded(
      api['channels.agent.principles.update']({ params: { ...slug, id: made.id }, body: { enabled: false } }),
    )
    expect(changed.enabled).toBe(false)
    const ordered = await succeeded(
      api['channels.agent.principles.reorder']({
        params: slug,
        body: { ids: [made.id, ...saved.principles.map((principle) => principle.id)] },
      }),
    )
    expect(ordered.principles[0]!.id).toBe(made.id)
    await succeeded(api['channels.agent.principles.delete']({ params: { ...slug, id: made.id } }))
    expect(
      (await succeeded(api['channels.agent.teaching.get']({ params: slug }))).principles.map(
        (each) => each.topic,
      ),
    ).toEqual(['Refund window', 'Annual plans'])
    expect(
      await refused(api['channels.agent.principles.delete']({ params: { ...slug, id: made.id } })),
    ).toMatchObject({ _tag: 'NotFound' })
  })

  it('answers nothing for a channel the visitor does not manage, or one without an agent', async () => {
    const { api } = demoApi()
    expect(await refused(api['channels.agent.teaching.get']({ params: { slug: 'deploys' } }))).toMatchObject({
      _tag: 'NotFound',
    })
    expect(
      await refused(
        api['channels.agent.teaching.get']({ params: { slug: 'design-reviews-for-the-customer-portal' } }),
      ),
    ).toMatchObject({ _tag: 'NotFound' })
  })
})
