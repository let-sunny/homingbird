import { Task as T } from '@homingbird/kernel'
import { deskPausePath, pauseDesk, resumeDesk } from '../desk-pause.ts'
import type { CliEnv } from '../environment.ts'
import type { CliFailure } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { calling, openSession } from '../session.ts'

/**
 * Pauses or resumes every runner on this computer for this person on this server: `homingbird run`,
 * the background service and `homingbird-mcp --run-agent`. A paused runner finishes the note in hand
 * and leaves the rest waiting. Doing it twice changes nothing.
 */
export const desk = (action: 'pause' | 'resume'): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const session = yield* openSession
    const { member } = yield* calling(session.api['me.get']({}))
    const server = session.credential.serverUrl
    const path = deskPausePath(env, server, member.id)
    const changed = yield* action === 'pause' ? pauseDesk(path) : resumeDesk(path)
    return outcome(
      { paused: action === 'pause', changed, server, member: { id: member.id, name: member.name } },
      action === 'pause'
        ? `${changed ? 'Paused' : 'Already paused:'} the desk for ${member.name} on ${server}. Runners on this computer leave arriving notes waiting until \`homingbird desk resume\`.`
        : `${changed ? 'Resumed' : 'Not paused:'} the desk for ${member.name} on ${server}. Runners on this computer answer arriving notes${changed ? ', starting with those that waited' : ''}.`,
    )
  })
