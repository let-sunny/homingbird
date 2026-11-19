import { describe, expect, it } from 'vitest'
import { routeMapModel } from '../../src/models/route-map.ts'
import { strings } from '../../src/strings.ts'
import { taught } from '../support/fixtures.ts'

describe('routeMapModel', () => {
  it('shows nothing while principles load or after they failed', () => {
    expect(routeMapModel(null)).toBeNull()
    expect(routeMapModel('failed')).toBeNull()
  })

  it('invites teaching while there is no route yet', () => {
    expect(routeMapModel(taught())).toEqual({
      kind: 'empty',
      title: strings.teach.empty,
      hint: strings.teach.emptyHint,
      debate: null,
    })
  })

  it('places a point per place, with a legend and a table, and the credits debate results gave', () => {
    const model = routeMapModel(
      taught({
        routes: [
          { place: null, drafted: 4, principles: 2, heldUp: 1, chances: 1 },
          { place: 'billing', drafted: 1, principles: 0, heldUp: 0, chances: 0 },
        ],
        debateCredits: ['conclusion', 'unknown' as never],
      }),
    )!
    if (model.kind !== 'map') throw new Error('expected a map')
    expect(model.nodes.map((node) => node.label)).toEqual([strings.trust.directMessages, '#billing'])
    expect(model.legend[0]).toEqual({
      key: 'direct',
      name: strings.trust.directMessages,
      counts: [
        strings.routes.principleCount({ count: 2 }),
        strings.routes.heldUpCount({ count: 1 }),
        strings.routes.draftedCount({ count: 4 }),
      ],
      chances: strings.routes.chances({ count: 1 }),
    })
    expect(model.legend[1]!.chances).toBeNull()
    expect(model.table.rows).toEqual([
      [strings.trust.directMessages, '4', '2', '1', '1'],
      ['#billing', '1', '0', '0', '0'],
    ])
    expect(model.debate).toEqual({
      title: strings.routes.debateRooms,
      intro: strings.routes.debateIntro,
      credits: [strings.teach.achievements.debate_conclusion],
    })
  })
})
