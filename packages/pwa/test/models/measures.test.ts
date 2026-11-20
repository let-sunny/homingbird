import { describe, expect, it } from 'vitest'
import { measuresModel } from '../../src/models/measures.ts'
import { strings } from '../../src/strings.ts'
import { everything, serverInfo } from '../support/fixtures.ts'

describe('measuresModel', () => {
  it('lists what a person sees about themself, what a channel’s managers see and what administrators see, each with who sees it', () => {
    const model = measuresModel(everything())
    expect(model.title).toBe(strings.measures.pageTitle)
    expect(model.nothing).toBeNull()
    expect(model.sections.map((section) => [section.id, section.title, section.privacy])).toEqual([
      ['measured-you', strings.measures.youTitle, strings.measures.youPrivacy],
      ['measured-managers', strings.measures.managersTitle, strings.measures.managersPrivacy],
      [
        'measured-administrators',
        strings.measures.administratorsTitle,
        strings.measures.administratorsPrivacy,
      ],
    ])
    expect(model.sections[0]!.lines).toEqual(Object.values(strings.measures.you))
    expect(model.sections[1]!.lines).toEqual(Object.values(strings.measures.managers))
    expect(model.sections[2]!.lines).toEqual(Object.values(strings.measures.administrators))
  })

  it('leaves out what a server does not measure, and says when it measures nothing', () => {
    expect(measuresModel(serverInfo({ insights: true })).sections.map((section) => section.id)).toEqual([
      'measured-administrators',
    ])
    const nothing = measuresModel(serverInfo())
    expect(nothing.sections).toEqual([])
    expect(nothing.nothing).toBe(strings.measures.nothing)
  })

  it('follows the defaults before the server has said what it offers', () => {
    expect(measuresModel(null).sections).toHaveLength(2)
  })
})
