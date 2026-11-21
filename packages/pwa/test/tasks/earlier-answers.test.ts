import { describe, expect, it } from 'vitest'
import {
  EARLIER_ANSWERS_PAUSE_MS,
  findEarlierAnswers,
  markAnsweredFromHistory,
} from '../../src/tasks/earlier-answers.ts'
import { fail, settle, testApp } from '../support/app.ts'
import { ROOM, note, serverInfo } from '../support/fixtures.ts'

const answer = { question: note('q1'), answer: note('a1'), channel: 'wiki' }

const lookUp = async (app: ReturnType<typeof testApp>, isStillAsked = () => true) => {
  const running = app.run(findEarlierAnswers('release calendar', ROOM, isStillAsked))
  await settle()
  await app.clock.advance(EARLIER_ANSWERS_PAUSE_MS)
  return running
}

describe('earlier answers tasks', () => {
  it('looks up earlier answers once the person pauses', async () => {
    const app = testApp({ 'answers.earlier': () => ({ answers: [answer] }) })
    const exit = await lookUp(app)
    expect(exit).toEqual({ _tag: 'Ok', value: [answer] })
    expect(app.sent.map((one) => one.request)).toEqual([
      { body: { question: 'release calendar', conversationId: ROOM } },
    ])
  })

  it('asks nothing for a question typed on, or while the feature is off', async () => {
    const typedOn = testApp({ 'answers.earlier': () => ({ answers: [answer] }) })
    expect(await lookUp(typedOn, () => false)).toEqual({ _tag: 'Ok', value: [] })
    expect(typedOn.routes()).toEqual([])
    const off = testApp({ 'answers.earlier': () => ({ answers: [answer] }) })
    off.state.serverInfo.set(serverInfo({ earlierAnswers: false }))
    expect(await lookUp(off)).toEqual({ _tag: 'Ok', value: [] })
    expect(off.routes()).toEqual([])
  })

  it('finds nothing, and reports nothing, when the lookup fails', async () => {
    const app = testApp({ 'answers.earlier': () => fail({ _tag: 'Unavailable', message: 'down' }) })
    expect(await lookUp(app)).toEqual({ _tag: 'Ok', value: [] })
  })

  it('records that an earlier answer answered the question written here', async () => {
    const app = testApp({ 'answers.used': () => ({}) })
    await app.run(markAnsweredFromHistory('a1' as never, ROOM))
    expect(app.sent.map((one) => [one.route, one.request])).toEqual([
      ['answers.used', { params: { id: 'a1' }, body: { conversationId: ROOM } }],
    ])
  })
})
