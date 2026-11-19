import { Task as T } from '@homingbird/kernel'
import { authenticate } from '../src/domain/credentials.ts'
import type { Caller } from '../src/environment.ts'
import type { TestServer } from './harness.ts'

/** The caller a token signs in as, to call the domain and the handlers directly. */
export const callerFor = (server: Pick<TestServer, 'env'>, token: string): Promise<Caller> =>
  T.runPromise(authenticate(token), server.env)
