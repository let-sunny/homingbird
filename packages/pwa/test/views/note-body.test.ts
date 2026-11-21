import { getByRole } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { noteBody } from '../../src/views/note-body.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'

usingFakeDom()

describe('noteBody', () => {
  it('shows code as code and copies a block on a click, saying whether the browser let it', async () => {
    const { context, page } = testContext()
    const body = mount(noteBody(context, 'Run `pnpm test`, then:\n```sh\npnpm build\n```'))
    expect(body.className).toBe('note-body')
    expect(body.querySelector('code')?.textContent).toBe('pnpm test')
    expect(body.querySelector('.code-block pre code')?.textContent).toBe('pnpm build')
    getByRole(body, 'button', { name: strings.copyCode }).click()
    await Promise.resolve()
    expect(page.copied).toEqual(['pnpm build'])
    expect(context.state.notice.get()).toEqual({ kind: 'info', text: strings.codeCopied })
    page.state.clipboard = false
    getByRole(body, 'button', { name: strings.copyCode }).click()
    await Promise.resolve()
    expect(context.state.notice.get()).toEqual({ kind: 'error', text: strings.noteNotCopied })
  })

  it('takes the class of the place it is shown in', () => {
    const { context } = testContext()
    expect(noteBody(context, 'plain', 'review-body').className).toBe('review-body')
  })
})
