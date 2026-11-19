import type { AgentReport, SessionBucketFigures } from '@homingbird/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { strings } from '../src/strings.ts'
import { freshSessionSuggestions, sessionSection } from '../src/views/session-health-view.ts'

interface FakeNode {
  readonly tag: string
  readonly attributes: Record<string, string>
  readonly dataset: Record<string, string>
  readonly childNodes: FakeNode[]
  readonly textContent: string
  appendChild: (child: FakeNode) => FakeNode
  setAttribute: (name: string, value: string) => void
  addEventListener: () => void
}

const fakeNode = (tag: string, text = ''): FakeNode => {
  const node: FakeNode = {
    tag,
    attributes: {},
    dataset: {},
    childNodes: [],
    get textContent() {
      return tag === '#text' ? text : node.childNodes.map((child) => child.textContent).join('')
    },
    appendChild: (child) => {
      node.childNodes.push(child)
      return child
    },
    setAttribute: (name, value) => {
      node.attributes[name] = value
    },
    addEventListener: () => undefined,
  }
  return node
}

const all = (node: FakeNode, tag: string): FakeNode[] => [
  ...(node.tag === tag ? [node] : []),
  ...node.childNodes.flatMap((child) => all(child, tag)),
]

const saved = { document: globalThis.document, Node: globalThis.Node }
beforeAll(() => {
  Object.assign(globalThis, {
    document: {
      createElement: (tag: string) => fakeNode(tag),
      createTextNode: (text: string) => fakeNode('#text', text),
    },
    Node: {
      [Symbol.hasInstance]: (value: unknown) =>
        typeof value === 'object' && value !== null && 'childNodes' in value,
    },
  })
})
afterAll(() => {
  Object.assign(globalThis, saved)
})

const bucket = (
  name: string,
  decided: number,
  edited: number | null,
  discarded: number | null,
): SessionBucketFigures => ({
  bucket: name,
  decided,
  edited,
  discarded,
})

const report = (byAge: SessionBucketFigures[], byContext: SessionBucketFigures[]): AgentReport =>
  ({ sessions: { days: 30, byAge, byContext, latest: [] } }) as unknown as AgentReport

describe('sessionSection', () => {
  it('shows nothing until some session-age bucket has a decided draft', () => {
    expect(sessionSection(report([bucket('hours', 0, null, null)], []))).toBeNull()
  })

  it('shows shares from the server’s counts, and too few where it gave none', () => {
    const section = sessionSection(
      report(
        [bucket('under_hour', 10, 2, 1), bucket('longer', 3, null, null)],
        [bucket('nearly_full', 10, 5, 0), bucket('unknown', 3, null, null)],
      ),
    ) as unknown as FakeNode
    const tables = all(section, 'table')
    expect(tables).toHaveLength(2)
    const rows = all(tables[0]!, 'tr')
      .slice(1)
      .map((row) => row.childNodes.map((cell) => cell.textContent))
    expect(rows).toEqual([
      [strings.trust.sessions.ages.under_hour, '10', '20%', '10%'],
      [strings.trust.sessions.ages.longer, '3', strings.trust.sessions.tooFew, strings.trust.sessions.tooFew],
    ])
    expect(section.textContent).toContain(strings.trust.sessions.contexts.nearly_full)
  })

  it('leaves out the context table when only unreported context use was decided', () => {
    const section = sessionSection(
      report(
        [bucket('hours', 2, null, null)],
        [bucket('under_half', 0, null, null), bucket('unknown', 2, null, null)],
      ),
    ) as unknown as FakeNode
    expect(all(section, 'table')).toHaveLength(1)
  })
})

describe('freshSessionSuggestions', () => {
  it('names each desk due for a fresh session, and shows nothing when none is', () => {
    expect(
      freshSessionSuggestions([{ agentName: 'Laptop', ageMinutes: 30, contextPercent: 10, at: 1 }]),
    ).toBeNull()
    const shown = freshSessionSuggestions([
      { agentName: 'Laptop', ageMinutes: 600, contextPercent: null, at: 1 },
      { agentName: 'Phone', ageMinutes: 10, contextPercent: 10, at: 1 },
    ]) as unknown as FakeNode
    expect(shown.childNodes.map((line) => line.textContent)).toEqual([
      strings.trust.sessions.freshSuggestion({ name: 'Laptop' }),
    ])
  })
})
