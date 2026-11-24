import type { ApiError } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import type { Load } from '../src/resource.ts'
import { strings } from '../src/strings.ts'
import { workspaceRefusalText, workspaceStep } from '../src/workspace-step.ts'

const at = (step: Load['step'], error: ApiError | null = null): Load => ({ loaded: false, step, error })
const READ: Load = { loaded: true, step: 'idle', error: null }

describe('workspaceStep', () => {
  it('is loaded once every list was read, whatever a later background request does', () => {
    expect(workspaceStep([READ, READ])).toBe('loaded')
    expect(workspaceStep([READ, { ...READ, step: 'failed' }, { ...READ, step: 'loading' }])).toBe('loaded')
  })

  it('is the worst step of those that were never read', () => {
    expect(workspaceStep([READ, at('idle')])).toBe('loading')
    expect(workspaceStep([at('loading'), at('slow')])).toBe('slow')
    expect(workspaceStep([at('long'), at('slow'), READ])).toBe('long')
    expect(workspaceStep([at('long'), at('failed'), at('slow')])).toBe('failed')
  })
})

describe('workspaceRefusalText', () => {
  it('says a refusal, and nothing of a server that is away or of a list that is shown', () => {
    const refusal: ApiError = { _tag: 'Forbidden', message: 'No contacts for you.' }
    const away: ApiError = { _tag: 'Unavailable', message: 'down' }
    expect(workspaceRefusalText([READ, at('failed', away), at('failed', refusal)])).toBe(refusal.message)
    expect(workspaceRefusalText([at('failed', away), at('failed'), at('loading', refusal)])).toBe('')
    expect(workspaceRefusalText([{ ...READ, step: 'failed', error: refusal }])).toBe('')
    expect(workspaceRefusalText([at('failed', { _tag: 'NotFound', message: '' })])).toBe(
      strings.errors.NotFound,
    )
  })
})
