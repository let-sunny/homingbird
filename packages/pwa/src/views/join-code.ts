import { type Child, type Lifetime, h, later, region, signal } from '@homingbird/ui'
import {
  type JoinCodeModel,
  type JoinCodeState,
  isJoinedAgentAwake,
  joinCodeModel,
  localExpiry,
} from '../models/join-code.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { hinted } from './hint.ts'
import { button } from './parts.ts'

/**
 * "Run on a server" on Connection, and in a channel agent's panel for its managers: a join code and the
 * one line that sets up a server with it, counting down until it expires, and asking the server now and
 * then whether it was used; once it was, the connection it made and whether that agent is awake, and
 * `connected` reloads whatever lists the connections. `agent` is the channel's agent the code is for;
 * null for the person's own.
 */
export const joinCodeSection = (
  context: ViewContext,
  life: Lifetime,
  agent: { readonly channel: string; readonly name: string } | null,
  connected: () => void = () => {},
): HTMLElement => {
  const state = signal<JoinCodeState>({ kind: 'idle' })
  const now = signal(context.clock.now())
  let cancelTick = (): void => {}
  let cancelWatch = (): void => {}
  life.add(() => cancelTick())
  life.add(() => cancelWatch())
  const isWaiting = (): boolean => {
    const current = state.get()
    return current.kind === 'made' && current.expiresAt > context.clock.now()
  }
  const tick = (): void => {
    now.set(context.clock.now())
    if (isWaiting()) cancelTick = later(context.clock, TICK_MS, tick)
  }
  const watch = (id: string): void => {
    cancelWatch = later(context.clock, WATCH_MS, () => {
      if (!isWaiting()) return
      context.actions.joinCodeStatus(id, {
        done: (status) => {
          if (!isWaiting()) return
          if (status.status === 'redeemed' && status.credential !== undefined) {
            cancelTick()
            state.set({ kind: 'connected', credential: status.credential })
            connected()
          } else watch(id)
        },
        failed: () => watch(id),
      })
    })
  }
  const create = (): void => {
    cancelTick()
    cancelWatch()
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
        watch(code.id)
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
    region(life, [state, now, context.state.directory, context.state.channels], () =>
      render(
        joinCodeModel({
          state: state.get(),
          now: now.get(),
          agent: agent?.name ?? null,
          awake: isAwake(context, agent?.channel ?? null),
        }),
        titleId,
        create,
        copy,
        (control) => hinted(context, 'joinCode', strings.hints.joinCode, control),
      ),
    ),
  )
}

const TICK_MS = 1_000

/** How often a waiting code asks the server whether it was used: soon enough to feel immediate. */
const WATCH_MS = 3_000

const isAwake = (context: ViewContext, channel: string | null): boolean => {
  const session = context.state.session.get()
  return isJoinedAgentAwake({
    channel,
    channels: context.state.channels.get(),
    directory: context.state.directory.get(),
    viewerId: session === null || session === 'loading' ? null : session.member.id,
  })
}

const render = (
  model: JoinCodeModel,
  titleId: string,
  create: () => void,
  copy: (command: string) => void,
  withHint: (control: HTMLElement) => Child,
): Child => {
  const title = h('h3', { id: titleId }, model.title)
  if (model.kind === 'offer')
    return [
      title,
      h('p', { class: 'hint' }, model.intro),
      withHint(
        button(model.button, create, {
          class: 'primary join-code-create',
          ...(model.busy && { disabled: true }),
        }),
      ),
      model.problem !== null && h('p', { class: 'hint', role: 'alert' }, model.problem),
    ]
  if (model.kind === 'expired')
    return [title, h('p', { role: 'status' }, model.text), button(model.button, create, { class: 'primary' })]
  if (model.kind === 'connected')
    return [
      title,
      h('p', { class: 'join-code-connected', role: 'status' }, model.text, ' ', model.awake),
      button(model.button, create, { class: 'join-code-another' }),
    ]
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
