import { Task as T } from '@homingbird/kernel'
import { seedTopics } from './domain/topics.ts'
import type { AppEnv } from './environment.ts'
import { type UnknownDatabase, migrate } from './sql/schema.ts'

export const prepareDatabase: T.Task<void, UnknownDatabase, AppEnv> = T.gen(function* () {
  yield* migrate
  yield* seedTopics
})
