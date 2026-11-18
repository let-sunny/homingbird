import { Task as T } from '@homingbird/kernel'
import {
  type CharacterSpec,
  Invalid,
  type Member,
  type MemberId,
  type NotFound,
  characterProblems,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { memberById } from './members.ts'

/** Saves a person's character, checking the rules again whatever the client checked; stores what passed. */
export const saveCharacter = (
  id: MemberId,
  spec: CharacterSpec,
): T.Task<Member, Invalid | NotFound, AppEnv> =>
  T.gen(function* () {
    const problems = characterProblems(spec)
    if (problems.length > 0)
      return yield* T.fail(Invalid({ message: `This character cannot be used: ${problems.join('; ')}` }))
    yield* run(sql`UPDATE members SET character_spec = ${JSON.stringify(spec)} WHERE id = ${id}`)
    return yield* memberById(id)
  })

/** Back to the pigeon: a member with no saved character is shown as the pigeon everywhere. */
export const clearCharacter = (id: MemberId): T.Task<Member, NotFound, AppEnv> =>
  T.gen(function* () {
    yield* memberById(id)
    yield* run(sql`UPDATE members SET character_spec = NULL WHERE id = ${id}`)
    return yield* memberById(id)
  })
