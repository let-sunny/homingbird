export type TaskPhase = 'input_required' | 'working' | 'completed' | 'canceled'

export interface TaskView {
  readonly id: string
  readonly contextId: string
  readonly phase: TaskPhase
  readonly statusText: string
  readonly updatedAt: number
  readonly artifacts: ReadonlyArray<{ readonly id: string; readonly name: string; readonly text: string }>
  readonly metadata: Readonly<Record<string, unknown>>
}

export interface Dialect {
  readonly version: '1.0' | '0.3'
  readonly task: (view: TaskView) => Readonly<Record<string, unknown>>
  readonly sendResult: (view: TaskView) => Readonly<Record<string, unknown>>
}

export const CURRENT: Dialect = {
  version: '1.0',
  task: (view) => ({
    id: view.id,
    contextId: view.contextId,
    status: {
      state: CURRENT_STATES[view.phase],
      message: {
        messageId: `${view.id}-status`,
        role: 'ROLE_AGENT',
        parts: [{ text: view.statusText }],
        taskId: view.id,
        contextId: view.contextId,
      },
      timestamp: new Date(view.updatedAt).toISOString(),
    },
    artifacts: view.artifacts.map((artifact) => ({
      artifactId: artifact.id,
      name: artifact.name,
      parts: [{ text: artifact.text, mediaType: 'text/plain' }],
    })),
    history: [],
    metadata: view.metadata,
  }),
  sendResult: (view) => ({ task: CURRENT.task(view) }),
}

export const LEGACY: Dialect = {
  version: '0.3',
  task: (view) => ({
    kind: 'task',
    id: view.id,
    contextId: view.contextId,
    status: {
      state: LEGACY_STATES[view.phase],
      message: {
        kind: 'message',
        messageId: `${view.id}-status`,
        role: 'agent',
        parts: [{ kind: 'text', text: view.statusText }],
        taskId: view.id,
        contextId: view.contextId,
      },
      timestamp: new Date(view.updatedAt).toISOString(),
    },
    artifacts: view.artifacts.map((artifact) => ({
      artifactId: artifact.id,
      name: artifact.name,
      parts: [{ kind: 'text', text: artifact.text }],
    })),
    history: [],
    metadata: view.metadata,
  }),
  sendResult: (view) => LEGACY.task(view),
}

const CURRENT_STATES: Readonly<Record<TaskPhase, string>> = {
  input_required: 'TASK_STATE_INPUT_REQUIRED',
  working: 'TASK_STATE_WORKING',
  completed: 'TASK_STATE_COMPLETED',
  canceled: 'TASK_STATE_CANCELED',
}

const LEGACY_STATES: Readonly<Record<TaskPhase, string>> = {
  input_required: 'input-required',
  working: 'working',
  completed: 'completed',
  canceled: 'canceled',
}
