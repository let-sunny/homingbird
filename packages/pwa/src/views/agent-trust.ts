import type { AsRead } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { figuresModel } from '../models/agent-figures.ts'
import { type MyAgentModel, myAgentModel } from '../models/my-agent.ts'
import type { AgentSection } from '../routes.ts'
import { strings } from '../strings.ts'
import { periodChoice, renderFigures } from './agent-figures.ts'
import { connectionSection } from './connection.ts'
import type { ViewContext } from './context.ts'
import { page } from './parts.ts'
import { routeMapSection } from './route-map-view.ts'
import { taughtSection } from './teaching.ts'

/**
 * "My agent": one page in four headed sections, connection, teaching, how it is doing and the route
 * map, each reachable by its own address.
 */
export const agentTrustView = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
  section: AgentSection | null,
): HTMLElement => {
  const model = myAgentModel(context.state.serverInfo.get(), section)
  if (model.loadsFigures) context.actions.refreshAgentReport()
  const view = renderMyAgent(model, (shown) => sectionContent(context, life, me, shown))
  if (model.focus !== null) {
    const focus = model.focus
    context.page.nextFrame(() => {
      const heading = view.ownerDocument.getElementById(`agent-${focus}`)
      heading?.scrollIntoView({ block: 'start' })
      heading?.focus({ preventScroll: true })
    })
  }
  return view
}

const renderMyAgent = (
  model: MyAgentModel,
  content: (section: AgentSection) => ReadonlyArray<Child>,
): HTMLElement =>
  page(
    model.title,
    h(
      'nav',
      { class: 'my-agent-nav', 'aria-label': strings.trust.onThisPage },
      h(
        'ol',
        {},
        model.navigation.map((link) =>
          h('li', {}, h('a', { href: link.href, 'aria-current': link.current && 'location' }, link.label)),
        ),
      ),
    ),
    model.sections.map(({ section, title }) =>
      h(
        'section',
        { class: `my-agent-section is-${section}`, 'aria-labelledby': `agent-${section}` },
        h('h2', { id: `agent-${section}`, tabindex: '-1' }, title),
        ...content(section),
      ),
    ),
  )

const sectionContent = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
  section: AgentSection,
): ReadonlyArray<Child> => {
  switch (section) {
    case 'connection':
      return [connectionSection(context, life, me)]
    case 'teaching':
      return [taughtSection(context, life)]
    case 'routes':
      return [routeMapSection(context, life)]
    case 'doing': {
      const days = signal(7)
      return [
        h('p', { class: 'trust-intro' }, strings.trust.intro),
        periodChoice('trust-period', days),
        region(
          life,
          [context.state.agentReport, days],
          () => renderFigures(figuresModel(context.state.agentReport.get(), days.get())),
          {
            class: 'trust-page',
          },
        ),
      ]
    }
  }
}
