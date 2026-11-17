import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CURRENT, LEGACY, type TaskPhase, type TaskView } from '../src/dialect.ts'

const PHASES: ReadonlyArray<TaskPhase> = ['input_required', 'working', 'completed', 'canceled']

const view = (overrides: Partial<TaskView> = {}): TaskView => ({
  id: 'note_aaaaaaaaaaaa',
  contextId: 'conv_bbbbbbbbbbbb',
  phase: 'working',
  statusText: 'Approved and sent. Delivered.',
  updatedAt: 1_700_000_000_000,
  artifacts: [{ id: 'note_cccccccccccc', name: 'Reply from Ben', text: 'wrapped reply' }],
  metadata: { noteStatus: 'sent' },
  ...overrides,
})

describe('the current dialect (A2A 1.0)', () => {
  it('names states with the TASK_STATE_ enumeration', () => {
    expect(PHASES.map((phase) => (CURRENT.task(view({ phase })).status as any).state)).toEqual([
      'TASK_STATE_INPUT_REQUIRED',
      'TASK_STATE_WORKING',
      'TASK_STATE_COMPLETED',
      'TASK_STATE_CANCELED',
    ])
  })

  it('renders a task with an agent status message, a timestamp and text artifacts', () => {
    expect(CURRENT.task(view())).toEqual({
      id: 'note_aaaaaaaaaaaa',
      contextId: 'conv_bbbbbbbbbbbb',
      status: {
        state: 'TASK_STATE_WORKING',
        message: {
          messageId: 'note_aaaaaaaaaaaa-status',
          role: 'ROLE_AGENT',
          parts: [{ text: 'Approved and sent. Delivered.' }],
          taskId: 'note_aaaaaaaaaaaa',
          contextId: 'conv_bbbbbbbbbbbb',
        },
        timestamp: '2023-11-14T22:13:20.000Z',
      },
      artifacts: [
        {
          artifactId: 'note_cccccccccccc',
          name: 'Reply from Ben',
          parts: [{ text: 'wrapped reply', mediaType: 'text/plain' }],
        },
      ],
      history: [],
      metadata: { noteStatus: 'sent' },
    })
  })

  it('wraps the result of a send in a task field', () => {
    expect(CURRENT.sendResult(view())).toEqual({ task: CURRENT.task(view()) })
    expect(CURRENT.version).toBe('1.0')
  })
})

describe('the legacy dialect (A2A 0.3)', () => {
  it('names states in kebab case', () => {
    expect(PHASES.map((phase) => (LEGACY.task(view({ phase })).status as any).state)).toEqual([
      'input-required',
      'working',
      'completed',
      'canceled',
    ])
  })

  it('tags the task, its message and its parts with kind', () => {
    const task = LEGACY.task(view()) as any
    expect(task.kind).toBe('task')
    expect(task.status.message).toMatchObject({ kind: 'message', role: 'agent' })
    expect(task.status.message.parts).toEqual([{ kind: 'text', text: 'Approved and sent. Delivered.' }])
    expect(task.artifacts[0].parts).toEqual([{ kind: 'text', text: 'wrapped reply' }])
  })

  it('returns the task itself from a send', () => {
    expect(LEGACY.sendResult(view())).toEqual(LEGACY.task(view()))
    expect(LEGACY.version).toBe('0.3')
  })
})

describe('both dialects', () => {
  it('carry the same identity, text and artifacts for any view', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.string({ minLength: 1 }),
          contextId: fc.string({ minLength: 1 }),
          phase: fc.constantFrom(...PHASES),
          statusText: fc.string(),
          updatedAt: fc.integer({ min: 0, max: 4_000_000_000_000 }),
          artifacts: fc.array(fc.record({ id: fc.string(), name: fc.string(), text: fc.string() }), { maxLength: 3 }),
          metadata: fc.constant({}),
        }),
        (generated) => {
          const [current, legacy] = [CURRENT.task(generated) as any, LEGACY.task(generated) as any]
          for (const task of [current, legacy]) {
            expect(task.id).toBe(generated.id)
            expect(task.contextId).toBe(generated.contextId)
            expect(task.status.message.parts[0].text).toBe(generated.statusText)
            expect(task.artifacts.map((artifact: any) => artifact.parts[0].text)).toEqual(
              generated.artifacts.map((artifact) => artifact.text),
            )
          }
          expect(current.status.timestamp).toBe(legacy.status.timestamp)
        },
      ),
    )
  })
})
