import { type Child, type Lifetime, h, later, region, signal } from '@homingbird/ui'
import { type JoinCodeModel, type JoinCodeState, joinCodeModel, localExpiry } from '../models/join-code.ts'
import type { ViewContext } from './context.ts'
import { button } from './parts.ts'

/**
 * "Run on a server" on Connection, and in a channel agent's panel for its managers: a join code and the
 * one line that sets up a server with it, counting down until it expires. `agent` is the channel's
 * agent the code is for; null for the person's own.
 */
export const joinCodeSection = (
  context: ViewContext,
  life: Lifetime,
  agent: { readonly channel: string; readonly name: string } | null,
): HTMLElement => {
  const state = signal<JoinCodeState>({ kind: 'idle' })
  const now = signal(context.clock.now())
  let cancelTick = (): void => {}
  life.add(() => cancelTick())
  const tick = (): void => {
    now.set(context.clock.now())
    const current = state.get()
    if (current.kind === 'made' && current.expiresAt > now.get())
      cancelTick = later(context.clock, TICK_MS, tick)
  }
  const create = (): void => {
    cancelTick()
    state.set({ kind: 'creating' })
    context.actions.createJoinCode(agent?.channel ?? null, {
      done: (code) => {
        state.set({
          kind: 'made',
          code,
          expiresAt: localExpiry(code, context.clock.now()),
          copied: 'not yet',
        })
        tick()
      },
      failed: () => state.set({ kind: 'failed' }),
    })
  }
  const copy = (command: string): void => {
    void context.page.copyText(command).then((isCopied) => {
      const current = state.get()
      if (current.kind === 'made') state.set({ ...current, copied: isCopied ? 'copied' : 'refused' })
    })
  }
  const titleId = `join-code-title-${context.random.id()}`
  return h(
    'section',
    { class: 'join-code', 'aria-labelledby': titleId },
    region(life, [state, now], () =>
      render(
        joinCodeModel({ state: state.get(), now: now.get(), agent: agent?.name ?? null }),
        titleId,
        create,
        copy,
      ),
    ),
  )
}

const TICK_MS = 1_000

const render = (
  model: JoinCodeModel,
  titleId: string,
  create: () => void,
  copy: (command: string) => void,
): Child => {
  const title = h('h3', { id: titleId }, model.title)
  if (model.kind === 'offer')
    return [
      title,
      h('p', { class: 'hint' }, model.intro),
      button(model.button, create, {
        class: 'primary join-code-create',
        ...(model.busy && { disabled: true }),
      }),
      model.problem !== null && h('p', { class: 'hint', role: 'alert' }, model.problem),
    ]
  if (model.kind === 'expired')
    return [title, h('p', { role: 'status' }, model.text), button(model.button, create, { class: 'primary' })]
  return [
    title,
    h('p', {}, model.explanation),
    h(
      'div',
      { class: 'join-command' },
      h('pre', {}, h('code', {}, model.command)),
      button(model.copy, () => copy(model.command), { class: 'join-code-copy' }),
    ),
    h('p', { class: 'hint join-code-countdown', role: 'timer' }, model.countdown),
    model.copyProblem !== null && h('p', { class: 'hint', role: 'status' }, model.copyProblem),
  ]
}
