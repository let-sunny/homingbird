import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { renderThreadHead } from '../../src/views/thread-head.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { channel } from '../support/fixtures.ts'

usingFakeDom()

const host = (child: ReturnType<typeof renderThreadHead>) => {
  const element = document.createElement('div')
  document.body.append(element)
  for (const part of child as unknown[]) if (part !== false && part !== null) element.append(part as Node)
  return element
}

describe('renderThreadHead', () => {
  it('waits, then names the person with their profile and presence', () => {
    const { context } = testContext()
    expect(
      getByRole(host(renderThreadHead(context, { kind: 'loading', title: strings.loading })), 'heading')
        .textContent,
    ).toBe(strings.loading)
    const shown = host(
      renderThreadHead(context, {
        kind: 'people',
        title: 'Ben',
        profile: 'Billing',
        presence: { humanOnline: true, agentOnline: false },
      }),
    )
    expect(textOf(shown)).toContain('Billing')
    expect(textOf(shown)).toContain(strings.humanOnline)
    expect(
      textOf(
        host(renderThreadHead(context, { kind: 'people', title: 'Team', profile: null, presence: null })),
      ),
    ).not.toContain('Billing')
  })

  it('shows a channel with its counts and controls, and an archived room as archived', () => {
    const { context } = testContext()
    const shown = host(
      renderThreadHead(context, {
        kind: 'channel',
        title: '#billing',
        archived: false,
        channel: channel('billing', { joined: true }),
      }),
    )
    expect(getByRole(shown, 'switch', { name: strings.answerHere })).toBeTruthy()
    const archived = host(
      renderThreadHead(context, { kind: 'channel', title: '#old', archived: true, channel: null }),
    )
    expect(textOf(archived)).toContain(strings.archived)
  })
})
