import { describe, expect, it } from 'vitest'
import { resource } from '../../src/resource.ts'
import { createState } from '../../src/state.ts'
import { strings } from '../../src/strings.ts'
import { pageData, readPageData } from '../../src/views/page-data.ts'
import { setLoad, setWorkspace } from '../support/resource-load.ts'

const CHECKING = { kind: 'checking', text: strings.loading }

describe('pageData', () => {
  it('draws again only when the data changes, not for the same data read again', () => {
    const state = createState('')
    const held = resource<{ readonly words: string } | null>(null)
    const { shown } = pageData(state, held)
    let drawn = 0
    shown.subscribe(() => drawn++)
    held.set({ words: 'one' })
    held.set({ words: 'one' })
    expect(drawn).toBe(1)
    held.set({ words: 'two' })
    expect(drawn).toBe(2)
  })

  it('says what stands in place of the data until it is read, then tells a failure once', () => {
    const state = createState('')
    const held = resource<string | null>(null)
    const { wait } = pageData(state, held)
    expect(wait.get()).toEqual(CHECKING)
    setLoad(held, { step: 'failed' })
    expect(wait.get()).toMatchObject({ kind: 'failed', retry: strings.tryAgain })
    setWorkspace(state, 'failed')
    expect(wait.get()).toEqual({ kind: 'told-above' })
  })
})

describe('readPageData', () => {
  it('waits only until the data was read, however it is read again, since an answer of none is an answer', () => {
    const state = createState('')
    const held = resource<string | null>(null)
    const { wait } = readPageData(state, held)
    expect(wait.get()).toEqual(CHECKING)
    setLoad(held, { loaded: true })
    expect(wait.get()).toBeNull()
    setLoad(held, { loaded: true, step: 'failed' })
    expect(wait.get()).toBeNull()
    setLoad(held, { loaded: false, step: 'failed' })
    expect(wait.get()).toMatchObject({ kind: 'failed' })
  })
})
