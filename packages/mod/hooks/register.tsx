import type { EngineInterface, Register } from 'claude-code'

import { CHARACTER_TOOLS, characterPromptFor, checkCharacter, previewCharacter } from './character'
import { run } from './command-line'
import {
  beginSignIn,
  claimDesk,
  decide,
  inBackground,
  knownServer,
  makeDesk,
  openDesk,
  personText,
  refresh,
  resumeDesk,
  useServer,
} from './desk'
import { directoryIn } from './drafting'
import { forbiddenReason } from './guard'
import { PROJECT_READER, READER_TYPE, askProject, askSession, deliverHelperFacts } from './helpers'
import { PANE, renderPane } from './pane'
import { looksLikeAddress } from './server-address'
import { HELPER_TOOLS, NOTE_TOOLS, TOOL_PREFIX, wireNameOf } from './tools'

export const register: Register = (on, options) => {
  const desk = makeDesk(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'homingbird',
      description:
        'Make this session your Homingbird desk; /homingbird character makes your profile character',
    })
    for (const tool of NOTE_TOOLS) await $.tool.register(tool.spec)
    await $.tool.register(CHARACTER_TOOLS.check)
    await $.tool.register(CHARACTER_TOOLS.preview)
    await $.tool.register(HELPER_TOOLS.askProject)
    await $.tool.register(HELPER_TOOLS.askSession)
    await $.agent.register(PROJECT_READER)
    const started = await next(e)
    inBackground(resumeDesk($, desk))
    return started
  })

  on('command.run', { command: 'homingbird' }, async ($, e) => {
    const [word = '', ...rest] = e.args.trim().split(/\s+/)
    if (word === 'character') {
      const started = (await personText($)).characterStarted
      const prompt = characterPromptFor(rest.join(' ').trim())
      $.clock.after(0, () => inBackground($.prompt.submit({ text: prompt })))
      return { text: started }
    }
    const opened = await $.ui.open({ id: PANE, title: 'Homingbird', focus: true })
    inBackground(looksLikeAddress(word) ? useServer($, desk, word) : openDesk($, desk))
    return { text: opened.isPlaced ? OPENED : `${OPENED} ${opened.reason}` }
  })

  on('tool.call', async ($, e, next) => {
    const reason = forbiddenReason(String(e.tool), e) ?? (await resolvedPathReason($, e))
    return reason === null ? next(e) : { deny: reason }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'homingbird: its guard failed, so the call was refused.' },
  )

  on('agent.spawn', { subagentType: READER_TYPE }, ($, e, next) => {
    const cwd = directoryIn(e.prompt)
    return cwd === null
      ? { deny: 'homingbird: the project helper is started by the ask_project tool.' }
      : next({ ...e, cwd })
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'homingbird: the project helper could not start.' },
  )

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) inBackground(deliverHelperFacts($, desk, e.agentId, e.answer))
    return next(e)
  })

  on('tool.run', { tool: /^mcp__homingbird__/ }, async ($, e) => {
    const input = e as unknown as Readonly<Record<string, unknown>>
    if (e.tool === wireNameOf(HELPER_TOOLS.askProject.name)) return askProject($, input, desk)
    if (e.tool === wireNameOf(HELPER_TOOLS.askSession.name)) return askSession($, input, desk)
    if (e.tool === wireNameOf(CHARACTER_TOOLS.check.name)) return { result: checkCharacter(input) }
    if (e.tool === wireNameOf(CHARACTER_TOOLS.preview.name)) {
      const server = (await knownServer($)) || desk.server
      return { result: previewCharacter(input, server) }
    }
    const tool = NOTE_TOOLS.find((one) => wireNameOf(one.spec.name) === String(e.tool))
    if (tool === undefined)
      return { result: `homingbird: there is no tool ${String(e.tool)}.`, isError: true }
    const ran = await run($, options, tool.argumentsFor(input))
    if (ran.kind === 'ok') return { result: ran.text }
    return { result: ran.kind === 'signed-out' ? SIGNED_OUT : ran.message, isError: true }
  }).catch(() => ({ result: 'homingbird: the tool failed before it could answer.', isError: true }))

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) =>
    renderPane($, e, {
      server: () => desk.server,
      signIn: (server) => inBackground(beginSignIn($, desk, server)),
      useServer: (typed) => inBackground(useServer($, desk, typed)),
      becomeDesk: async () => {
        if ((await refresh($, desk)) !== null) await claimDesk($, desk)
      },
      approve: (draftId, editedBody) =>
        decide(
          $,
          desk,
          editedBody === null ? ['approve', draftId] : ['approve', draftId, '--body', editedBody],
        ),
      discard: (draftId) => decide($, desk, ['discard', draftId]),
    }),
  )
}

async function resolvedPathReason($: EngineInterface, e: { readonly tool: unknown }): Promise<string | null> {
  if (String(e.tool).startsWith(TOOL_PREFIX)) return null
  const path = (e as { file_path?: unknown; path?: unknown }).file_path ?? (e as { path?: unknown }).path
  if (typeof path !== 'string' || path === '') return null
  const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  return stat?.realPath === undefined ? null : forbiddenReason(String(e.tool), { path: stat.realPath })
}

const OPENED = 'Homingbird pane opened.'
const SIGNED_OUT =
  'Homingbird is not signed in. Ask the person to run /homingbird and sign in from the Homingbird pane.'
