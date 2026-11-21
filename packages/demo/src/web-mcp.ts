import { Schema as S, Task as T } from '@homingbird/kernel'
import { type DemoTool, type DemoToolContext, inputSchemaOf } from './demo-tools.ts'

/**
 * Offers the demo's tools to an agent in the browser through WebMCP, where the browser has it: the
 * draft names `document.modelContext`, earlier builds `navigator.modelContext`. Without either nothing
 * happens. Aborting `signal` takes the tools back.
 */
export const offerDemoTools = (
  modelContext: ModelContext | null,
  tools: ReadonlyArray<DemoTool<any>>,
  context: DemoToolContext,
  signal: AbortSignal,
): number => {
  if (modelContext === null) return 0
  for (const each of tools) {
    try {
      void Promise.resolve(modelContext.registerTool(webMcpToolOf(each, context), { signal })).catch(
        ignoreRefusal,
      )
    } catch {
      // A browser that turned WebMCP off refuses each tool; the page works the same without them.
    }
  }
  return tools.length
}

/** The browser's model context, from the draft's place or the earlier one, or null where there is none. */
export const modelContextOf = (host: {
  readonly document?: unknown
  readonly navigator?: unknown
}): ModelContext | null =>
  [host.document, host.navigator]
    .map((owner) => (owner as { modelContext?: unknown } | undefined)?.modelContext)
    .find(isModelContext) ?? null

/** What the demo needs of WebMCP's `ModelContext`. */
export interface ModelContext {
  readonly registerTool: (tool: WebMcpTool, options: { readonly signal: AbortSignal }) => unknown
}

/** A tool as WebMCP's `ModelContextTool` declares it. */
export interface WebMcpTool {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly inputSchema: S.JsonSchema
  readonly annotations: { readonly readOnlyHint: true; readonly untrustedContentHint: boolean }
  readonly execute: (input: unknown, options?: { readonly signal?: AbortSignal }) => Promise<ToolResult>
}

/** An answer in the MCP shape that browsers pass on to the agent. */
export interface ToolResult {
  readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>
  readonly isError?: true
}

export const webMcpToolOf = (each: DemoTool<any>, context: DemoToolContext): WebMcpTool => ({
  name: each.name,
  title: each.title,
  description: each.description,
  inputSchema: inputSchemaOf(each),
  annotations: { readOnlyHint: true, untrustedContentHint: each.quotesColleagues },
  execute: (input, options) => {
    const decoded = S.struct(each.input).decode(input ?? {})
    if (decoded._tag === 'Err') return Promise.resolve(refusal(S.formatIssues(decoded.error)))
    return T.run(each.run(decoded.value, context), undefined, options?.signal).then((exit) =>
      exit._tag === 'Ok'
        ? { content: [{ type: 'text', text: exit.value }] }
        : refusal(exit.error._tag === 'Fail' ? exit.error.error.message : 'The demo could not answer.'),
    )
  },
})

const isModelContext = (value: unknown): value is ModelContext =>
  typeof (value as { registerTool?: unknown } | null | undefined)?.registerTool === 'function'

const refusal = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true })

const ignoreRefusal = (): void => {}
