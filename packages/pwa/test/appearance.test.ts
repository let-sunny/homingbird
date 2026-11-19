import { describe, expect, it } from 'vitest'
import { applyAppearance, currentAppearance } from '../src/appearance.ts'
import { fakePage } from './support/context.ts'

describe('appearance', () => {
  it('follows the system until one is chosen, and remembers the one chosen', () => {
    const { page, local } = fakePage()
    expect(currentAppearance(page.storage)).toBe('auto')
    local.set('homingbird.appearance', 'sepia')
    expect(currentAppearance(page.storage)).toBe('auto')
    const root = { dataset: {} as Record<string, string> } as HTMLElement
    applyAppearance(root, page.storage, 'dark')
    expect(root.dataset.appearance).toBe('dark')
    expect(currentAppearance(page.storage)).toBe('dark')
  })
})
