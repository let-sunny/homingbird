import type { EngineInterface, Register } from 'claude-code'

import { CHARACTER_TOOLS, characterPromptFor, checkCharacter, previewCharacter } from './character'
import { run } from './command-line'
import {
  beginSignIn,
  claimDesk,
  knownServer,
  makeDesk,
  openDesk,
  personText,
  refresh,
  resumeDesk,
  signOut,
  useServer,
} from './desk'
import { directoryIn } from './drafting'
import { teachingInterviewPrompt } from './drafting-prompts.mjs'
import { answered, forked, host, hostOr, inBackground, rescued } from './effects'
import { forbiddenReason } from './guard'
import { PROJECT_READER, READER_TYPE, askProject, askSession, deliverHelperFacts } from './helpers'
import { optionally } from './host-support'
import { T } from './kernel.mjs'
import { PANE, renderPane } from './pane'
import { looksLikeAddress } from './server-address'
import { HELPER_TOOLS, NOTE_TOOLS, TOOL_PREFIX, hostEnvOf, wireNameOf } from './tools'

export const register: Register = (on, options) => {
  const desk = makeDesk(options)

  on('session.start', ($, e, next) =>
    answered(
      T.gen(function* () {
        yield* host(() =>
          $.command.register({
            name: 'homingbird',
            description:
              'Make this session your Homingbird desk; /homingbird character makes your profile character; /homingbird teach teaches your agent in a short chat',
          }),
        )
        const registered = yield* rescued(
          T.gen(function* () {
            for (const tool of NOTE_TOOLS) yield* host(() => $.tool.register(tool.spec))
            yield* host(() => $.tool.register(CHARACTER_TOOLS.check))
            yield* host(() => $.tool.register(CHARACTER_TOOLS.preview))
            yield* host(() => $.tool.register(HELPER_TOOLS.askProject))
            yield* host(() => $.tool.register(HELPER_TOOLS.askSession))
            yield* host(() => $.agent.register(PROJECT_READER))
            return true
          }),
          () => false,
        )
        if (!registered) desk.hostTooOld = true
        const started = yield* host(() => next(e))
        yield* forked(resumeDesk($, desk))
        return started
      }),
    ),
  )

  on('command.run', { command: 'homingbird' }, ($, e) =>
    answered(
      T.gen(function* () {
        const [word = '', ...rest] = e.args.trim().split(/\s+/)
        if (word === 'teach') {
          const started = (yield* personText($)).teachStarted
          const prompt = teachingInterviewPrompt(rest.join(' ').trim())
          $.clock.after(0, () => inBackground(host(() => $.prompt.submit({ text: prompt }))))
          return { text: started }
        }
        if (word === 'character') {
          const started = (yield* personText($)).characterStarted
          const prompt = characterPromptFor(rest.join(' ').trim())
          $.clock.after(0, () => inBackground(host(() => $.prompt.submit({ text: prompt }))))
          return { text: started }
        }
        const opened = yield* host(() => $.ui.open({ id: PANE, title: 'Homingbird', focus: true }))
        yield* forked(looksLikeAddress(word) ? useServer($, desk, word) : openDesk($, desk))
        return { text: opened.isPlaced ? OPENED : `${OPENED} ${opened.reason}` }
      }),
    ),
  )

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) =>
    answered(
      renderPane($, e, {
        server: () => desk.server,
        signIn: (server) => inBackground(beginSignIn($, desk, server)),
        useServer: (typed) => inBackground(useServer($, desk, typed)),
        becomeDesk: () =>
          inBackground(
            T.gen(function* () {
              if ((yield* refresh($, desk)) !== null) yield* claimDesk($, desk)
            }),
          ),
        signOut: () => inBackground(signOut($, desk)),
        isHostTooOld: () => desk.hostTooOld,
      }),
    ),
  )

  on('tool.call', ($, e, next) =>
    answered(
      T.gen(function* () {
        const reason = forbiddenReason(String(e.tool), e) ?? (yield* resolvedPathReason($, e))
        return reason === null ? yield* host(() => next(e)) : { deny: reason }
      }),
    ),
  ).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'homingbird: its guard failed, so the call was refused.' },
  )

  const known = [
    optionally(() => {
      on('agent.spawn', { subagentType: READER_TYPE }, ($, e, next) => {
        const cwd = directoryIn(e.prompt)
        return cwd === null
          ? { deny: 'homingbird: the project helper is started by the ask_project tool.' }
          : next({ ...e, cwd })
      }).catch(($, e, next) =>
        next.called ? next(e) : { deny: 'homingbird: the project helper could not start.' },
      )
    }),
    optionally(() => {
      on('turn.complete', ($, e, next) => {
        if (e.agentId !== undefined) inBackground(deliverHelperFacts($, desk, e.agentId, e.answer))
        return next(e)
      })
    }),
    optionally(() => {
      on('tool.run', { tool: /^mcp__homingbird__/ }, ($, e) =>
        answered(
          T.gen(function* () {
            const input = e as unknown as Readonly<Record<string, unknown>>
            if (e.tool === wireNameOf(HELPER_TOOLS.askProject.name)) return yield* askProject($, input, desk)
            if (e.tool === wireNameOf(HELPER_TOOLS.askSession.name)) return yield* askSession($, input, desk)
            if (e.tool === wireNameOf(CHARACTER_TOOLS.check.name)) return { result: checkCharacter(input) }
            if (e.tool === wireNameOf(CHARACTER_TOOLS.preview.name)) {
              const server = (yield* knownServer($)) || desk.server
              return { result: previewCharacter(input, server) }
            }
            const tool = NOTE_TOOLS.find((one) => wireNameOf(one.spec.name) === String(e.tool))
            if (tool === undefined)
              return { result: `homingbird: there is no tool ${String(e.tool)}.`, isError: true } as const
            const ran = yield* run($, desk, tool.argumentsFor(input), yield* hostEnvOf($))
            if (ran.kind === 'ok') return { result: ran.text }
            return { result: ran.kind === 'signed-out' ? SIGNED_OUT : ran.message, isError: true } as const
          }),
        ),
      ).catch(() => ({ result: 'homingbird: the tool failed before it could answer.', isError: true }))
    }),
  ]
  if (known.includes(false)) desk.hostTooOld = true
}

function resolvedPathReason($: EngineInterface, e: { readonly tool: unknown }): T.Task<string | null> {
  if (String(e.tool).startsWith(TOOL_PREFIX)) return T.succeed(null)
  const path = (e as { file_path?: unknown; path?: unknown }).file_path ?? (e as { path?: unknown }).path
  if (typeof path !== 'string' || path === '') return T.succeed(null)
  return T.map((stat: { readonly realPath?: string } | undefined) =>
    stat?.realPath === undefined ? null : forbiddenReason(String(e.tool), { path: stat.realPath }),
  )(hostOr(() => $.fs.stat(path, { resolve: true }), undefined))
}

const OPENED = 'Homingbird pane opened.'
const SIGNED_OUT =
  'Homingbird is not signed in. Ask the person to run /homingbird and sign in from the Homingbird pane.'
