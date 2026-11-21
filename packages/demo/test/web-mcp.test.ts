import { makeTestClock } from '@homingbird/kernel'
import type { Api } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { DEMO_TOOLS, demoReadsOf } from '../src/demo-tools.ts'
import { VISITOR_ID } from '../src/team.ts'
import {
  type ModelContext,
  type WebMcpTool,
  modelContextOf,
  offerDemoTools,
  webMcpToolOf,
} from '../src/web-mcp.ts'
import { createWorld } from '../src/world.ts'
import { NOW, demoApi } from './support/demo.ts'

describe('offerDemoTools', () => {
  it('registers every demo tool as read-only, with the signal that takes them back', () => {
    const { modelContext, registered } = recordingContext()
    const controller = new AbortController()
    expect(offerDemoTools(modelContext, DEMO_TOOLS, context(), controller.signal)).toBe(DEMO_TOOLS.length)
    expect(registered.map(({ tool }) => tool.name)).toEqual(DEMO_TOOLS.map((each) => each.name))
    for (const { tool, options } of registered) {
      expect(tool.annotations.readOnlyHint).toBe(true)
      expect(tool.inputSchema).toMatchObject({ type: 'object' })
      expect(options.signal).toBe(controller.signal)
    }
    expect(
      registered.find(({ tool }) => tool.name === 'read_conversation')?.tool.annotations.untrustedContentHint,
    ).toBe(true)
  })

  it('does nothing where the browser has no WebMCP', () => {
    expect(offerDemoTools(null, DEMO_TOOLS, context(), new AbortController().signal)).toBe(0)
  })

  it('keeps the page working when the browser refuses a tool, at once or later', () => {
    const throwing: ModelContext = {
      registerTool: () => {
        throw new DOMException('Tools are off.', 'NotAllowedError')
      },
    }
    const rejecting: ModelContext = {
      registerTool: () => Promise.reject(new DOMException('Tools are off.', 'NotAllowedError')),
    }
    const signal = new AbortController().signal
    expect(offerDemoTools(throwing, DEMO_TOOLS, context(), signal)).toBe(DEMO_TOOLS.length)
    expect(offerDemoTools(rejecting, DEMO_TOOLS, context(), signal)).toBe(DEMO_TOOLS.length)
  })
})

describe('modelContextOf', () => {
  const modelContext = { registerTool: () => undefined }

  it('finds the model context on the document, as the draft places it, or on the navigator', () => {
    expect(modelContextOf({ document: { modelContext } })).toBe(modelContext)
    expect(modelContextOf({ navigator: { modelContext } })).toBe(modelContext)
    expect(
      modelContextOf({ document: { modelContext }, navigator: { modelContext: { registerTool() {} } } }),
    ).toBe(modelContext)
  })

  it('finds none where nothing can register a tool', () => {
    expect(modelContextOf({})).toBeNull()
    expect(modelContextOf({ document: {}, navigator: {} })).toBeNull()
    expect(
      modelContextOf({
        document: { modelContext: { registerTool: 'no' } },
        navigator: { modelContext: null },
      }),
    ).toBeNull()
  })
})

describe('webMcpToolOf', () => {
  it('answers in the MCP text shape', async () => {
    const result = await toolNamed('about_this_demo').execute({})
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain('Homingbird')
  })

  it('treats a missing input as an empty one', async () => {
    expect((await toolNamed('list_conversations').execute(undefined)).isError).toBeUndefined()
  })

  it('refuses input that does not fit the tool’s schema, and says why', async () => {
    const result = await toolNamed('read_conversation').execute({ conversation: 42 })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('conversation')
  })

  it('passes on the demo’s refusal as an error answer', async () => {
    const result = await toolNamed('read_conversation').execute({ conversation: 'conv_nosuchroom00' })
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text' }] })
  })
})

const context = () => ({
  api: demoReadsOf(demoApi(VISITOR_ID, createWorld(makeTestClock(NOW))).api as Api),
  viewerId: VISITOR_ID,
  nonce: () => 'nonce0123456789abcdef',
})

const toolNamed = (name: string): WebMcpTool => {
  const found = DEMO_TOOLS.find((each) => each.name === name)
  if (found === undefined) throw new Error(`no tool named ${name}`)
  return webMcpToolOf(found, context())
}

const recordingContext = () => {
  const registered: Array<{ tool: WebMcpTool; options: { readonly signal: AbortSignal } }> = []
  const modelContext: ModelContext = {
    registerTool: (tool, options) => {
      registered.push({ tool, options })
      return Promise.resolve(undefined)
    },
  }
  return { modelContext, registered }
}
