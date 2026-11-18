import { Task as T } from '@homingbird/kernel'
import { seedTopics } from './domain/topics.ts'
import type { AppEnv } from './environment.ts'
import { migrate } from './sql/schema.ts'

export const prepareDatabase: T.Task<void, never, AppEnv> = T.gen(function* () {
  yield* migrate
  yield* seedTopics
})
