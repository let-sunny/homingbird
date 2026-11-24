import { type Lifetime, h, region } from '@homingbird/ui'
import { workspaceLineModel } from '../models/start.ts'
import type { ViewContext } from './context.ts'
import { button } from './parts.ts'

/** Above the lists while the workspace has not loaded in good time: how it is going, and a way to try again. */
export const workspaceLine = (context: ViewContext, life: Lifetime): HTMLElement =>
  region(
    life,
    [context.state.workspace, context.state.workspaceRefusal],
    () => {
      const line = workspaceLineModel(context.state.workspace.get(), context.state.workspaceRefusal.get())
      return (
        line !== null &&
        h(
          'p',
          { class: 'load-line', role: 'status' },
          h('span', {}, line.text),
          line.retry !== null && button(line.retry, () => context.actions.startAgain()),
        )
      )
    },
    { class: 'notice-slot' },
  )
