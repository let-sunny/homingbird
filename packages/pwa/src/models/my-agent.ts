import type { AsRead } from '@homingbird/protocol'
import { featureOn } from '../features.ts'
import { AGENT_SECTIONS, type AgentSection, hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'

/** "My agent": its sections whose features are on, each reachable by its own address. */
export const myAgentModel = (info: AsRead.ServerInfo | null, current: AgentSection | null): MyAgentModel => {
  const teaching = featureOn('teaching', info)
  const figures = featureOn('agentFigures', info)
  const routes = teaching && featureOn('routeMap', info)
  const shown = AGENT_SECTIONS.filter(
    (section) =>
      section === 'connection' ||
      (section === 'teaching' && teaching) ||
      (section === 'doing' && figures) ||
      (section === 'routes' && routes),
  )
  return {
    title: strings.trust.pageTitle,
    navigation: shown.map((section) => ({
      section,
      href: hrefFor({ name: 'agent', section }),
      label: strings.trust.sections[section],
      current: section === current,
    })),
    sections: shown.map((section) => ({ section, title: strings.trust.sections[section] })),
    loadsFigures: figures,
    focus: current,
  }
}

export interface MyAgentModel {
  readonly title: string
  readonly navigation: ReadonlyArray<{
    readonly section: AgentSection
    readonly href: string
    readonly label: string
    readonly current: boolean
  }>
  readonly sections: ReadonlyArray<{ readonly section: AgentSection; readonly title: string }>
  readonly loadsFigures: boolean
  /** The section to scroll to and focus once the page is drawn. */
  readonly focus: AgentSection | null
}
