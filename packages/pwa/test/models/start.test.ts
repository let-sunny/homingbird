import { describe, expect, it } from 'vitest'
import { startModel } from '../../src/models/start.ts'
import { strings } from '../../src/strings.ts'

describe('startModel', () => {
  it('shows plain loading, then says quietly that it is still trying', () => {
    expect(startModel('loading', 'Homingbird')).toEqual({ kind: 'loading', text: strings.loading })
    expect(startModel('slow', 'Homingbird')).toEqual({ kind: 'loading', text: strings.firstLoad.slow })
  })

  it('offers to try again once it has given up, under the organization’s name', () => {
    expect(startModel('failed', 'Acme')).toEqual({
      kind: 'failed',
      title: 'Acme',
      pip: 'offline',
      text: strings.firstLoad.failed,
      retry: strings.tryAgain,
    })
  })
})
