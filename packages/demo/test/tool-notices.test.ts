import { describe, expect, it } from 'vitest'
import { ABOUT_THIS_DEMO, DEMO_NOTICE, READ_ONLY } from '../src/tool-notices.ts'

describe('tool notices', () => {
  it('say that the data is made up and that a tool cannot approve or change anything', () => {
    expect(DEMO_NOTICE).toContain('made-up team')
    expect(DEMO_NOTICE).toContain('never a tool')
    expect(READ_ONLY).toContain('Made-up demo data')
    expect(ABOUT_THIS_DEMO).toContain('approving is a person’s click in the page')
  })
})
