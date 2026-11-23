import type { AsRead, MemberId } from '@homingbird/protocol'
import { h } from '@homingbird/ui'
import { schedulingRetryModel } from '../models/scheduling-retry.ts'
import { hrefFor } from '../routes.ts'
import type { ViewContext } from './context.ts'
import { section } from './debate-result.ts'

/** For whoever opened the room, once it has settled or ended: open it again, or in a wider window. */
export const schedulingRetryCard = (
  context: ViewContext,
  input: { readonly debate: AsRead.Debate; readonly viewerId: MemberId },
): HTMLElement | null => {
  const model = schedulingRetryModel({ ...input, now: context.clock.now() })
  if (model === null) return null
  return section(
    model.title,
    'scheduling-retry',
    h('p', { class: 'hint' }, model.hint),
    h(
      'div',
      { class: 'scheduling-retry-actions' },
      model.actions.map((action) =>
        h(
          'button',
          {
            type: 'button',
            class: `${action.emphasis === 'primary' ? 'primary ' : ''}scheduling-retry-${action.name}`,
            on: {
              click: () =>
                context.actions.retrySchedulingRoom(input.debate.id, action.window, {
                  done: (created) => context.page.go(hrefFor({ name: 'debate', id: created.id, tab: null })),
                }),
            },
          },
          action.label,
        ),
      ),
    ),
  )
}
