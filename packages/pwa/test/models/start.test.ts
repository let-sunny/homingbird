import { describe, expect, it } from 'vitest'
import { USUAL_LOAD_SECONDS } from '../../src/load-timing.ts'
import {
  checkingWords,
  firstAnswersStep,
  offersRetry,
  pageWaitModels,
  startModel,
  workspaceLineModel,
} from '../../src/models/start.ts'
import { strings } from '../../src/strings.ts'

const start = (value: Parameters<typeof startModel>[0]['start'], retrying = false) =>
  startModel({ start: value, retrying, brandingName: 'Acme', refusal: 'Not allowed.' })

describe('firstAnswersStep', () => {
  it('is none once every list has come, and tells a failure before a long wait before a usual one', () => {
    const load = (step: 'idle' | 'loading' | 'slow' | 'long' | 'failed', loaded = false) => ({
      loaded,
      step,
      error: null,
    })
    expect(firstAnswersStep([load('failed', true), load('loading', true)])).toBeNull()
    expect(firstAnswersStep([load('idle'), load('slow')])).toBe('loading')
    expect(firstAnswersStep([load('loading'), load('long')])).toBe('long')
    expect(firstAnswersStep([load('long'), load('failed'), load('idle', true)])).toBe('failed')
  })
})

describe('pageWaitModels', () => {
  const load = (step: 'idle' | 'loading' | 'slow' | 'long' | 'failed', loaded = false) => ({
    loaded,
    step,
    error: null,
  })

  const waitOf = (...given: [ReturnType<typeof load>, 'loaded' | 'long' | 'failed', string]) =>
    pageWaitModels([given[0]], given[1], given[2])[0]

  it('says it is checking while the first answer is awaited, then the way to try again once it took too long or failed', () => {
    const checking = { kind: 'checking', text: strings.loading }
    expect(waitOf(load('idle'), 'loaded', strings.loading)).toEqual(checking)
    expect(waitOf(load('slow'), 'loaded', strings.loading)).toEqual(checking)
    expect(waitOf(load('long'), 'loaded', strings.loading)).toEqual({
      kind: 'long',
      text: strings.firstLoad.tooLong,
      retry: strings.tryAgain,
    })
    expect(waitOf(load('failed'), 'loaded', strings.loading)).toEqual({
      kind: 'failed',
      text: strings.loadFailed,
      retry: strings.tryAgain,
    })
  })

  it('leaves it to the line above the lists to say what it already says, so that a problem is told once', () => {
    for (const workspace of ['long', 'failed'] as const)
      expect(waitOf(load('failed'), workspace, strings.loading)).toEqual({ kind: 'told-above' })
  })

  it('does not wait for what has come, however its next request goes', () => {
    expect(waitOf(load('failed', true), 'loaded', strings.loading)).toBeNull()
  })

  it.each(['long', 'failed'] as const)(
    'tells of any part that is at %s once, in the place of the first that waits',
    (step) => {
      const parts = [load('idle', true), load('loading'), load(step), load(step)]
      for (const loads of [parts, [...parts].reverse(), [load(step), ...parts]]) {
        const waits = pageWaitModels(loads, 'loaded', strings.loading)
        expect(waits.filter(offersRetry)).toHaveLength(1)
        expect(waits.findIndex(offersRetry)).toBe(loads.findIndex((one) => !one.loaded))
        expect(waits.map((wait) => wait === null)).toEqual(loads.map((one) => one.loaded))
      }
    },
  )
})

describe('startModel', () => {
  it('shows plain loading, then what is usual, and says it is still trying only while repeating', () => {
    expect(start('loading')).toEqual({ kind: 'loading', text: strings.loading })
    expect(start('slow')).toEqual({
      kind: 'loading',
      text: strings.firstLoad.usually({ count: USUAL_LOAD_SECONDS }),
    })
    expect(start('slow', true)).toEqual({ kind: 'loading', text: strings.firstLoad.retrying })
    expect(start('loading', true)).toEqual({ kind: 'loading', text: strings.firstLoad.retrying })
  })

  it('offers to try again when it takes too long, once it has given up, and when the server refused', () => {
    expect(start('long')).toEqual({
      kind: 'retry',
      title: 'Acme',
      pip: 'connecting',
      text: strings.firstLoad.tooLong,
      retry: strings.tryAgain,
    })
    expect(start('failed')).toMatchObject({ kind: 'retry', pip: 'offline', text: strings.firstLoad.failed })
    expect(start('refused')).toMatchObject({ kind: 'retry', text: 'Not allowed.' })
  })
})

describe('workspaceLineModel', () => {
  it('says nothing while loading as usual or once loaded', () => {
    expect(workspaceLineModel('loading', '')).toBeNull()
    expect(workspaceLineModel('loaded', '')).toBeNull()
  })

  it('notes slowness quietly, then offers to try again, and names a refusal as what it was', () => {
    expect(workspaceLineModel('slow', '')).toEqual({
      text: strings.firstLoad.usually({ count: USUAL_LOAD_SECONDS }),
      retry: null,
    })
    expect(workspaceLineModel('long', '')).toEqual({
      text: strings.firstLoad.tooLong,
      retry: strings.tryAgain,
    })
    expect(workspaceLineModel('failed', '')).toEqual({
      text: strings.firstLoad.failed,
      retry: strings.tryAgain,
    })
    expect(workspaceLineModel('failed', 'No.')).toEqual({ text: 'No.', retry: strings.tryAgain })
  })
})

describe('checkingWords', () => {
  it('checks while the load goes on, and leaves the speaking to the line once it took too long or failed', () => {
    expect(checkingWords('loading', 'Checking…')).toBe('Checking…')
    expect(checkingWords('slow', 'Checking…')).toBe('Checking…')
    expect(checkingWords('long', 'Checking…')).toBeNull()
    expect(checkingWords('failed', 'Checking…')).toBeNull()
  })
})
