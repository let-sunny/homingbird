import type { AsRead } from '@homingbird/protocol'
import { featureOn } from '../features.ts'
import { AGENT_SECTIONS, type AgentSection, hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'

/**
 * "My agent": a tab for each section whose feature is on, and the one shown, which is the section asked
 * for or, when none was asked for or it is off, the first.
 */
export const myAgentModel = (info: AsRead.ServerInfo | null, asked: AgentSection | null): MyAgentModel => {
  const available = availableSections(info)
  const shown = asked !== null && available.includes(asked) ? asked : FIRST_SECTION
  return {
    title: strings.trust.pageTitle,
    tabs: available.map((section) => ({
      section,
      href: hrefFor({ name: 'agent', section }),
      label: strings.trust.sections[section],
      current: section === shown,
    })),
    shown: { section: shown, title: strings.trust.sections[shown], hint: strings.trust.sectionHints[shown] },
    loadsReport: featureOn('agentFigures', info) && SECTIONS_READING_THE_REPORT.includes(shown),
    focusesHeading: asked !== null,
  }
}

export interface MyAgentModel {
  readonly title: string
  readonly tabs: ReadonlyArray<{
    readonly section: AgentSection
    readonly href: string
    readonly label: string
    readonly current: boolean
  }>
  readonly shown: {
    readonly section: AgentSection
    readonly title: string
    /** One line under the heading that says what the section is for. */
    readonly hint: string
  }
  /** How it is doing draws the report, and Connection suggests a fresh session from it. */
  readonly loadsReport: boolean
  /** Whether the shown section's heading takes focus once drawn, as it does after choosing a tab. */
  readonly focusesHeading: boolean
}

const availableSections = (info: AsRead.ServerInfo | null): ReadonlyArray<AgentSection> => {
  const teaching = featureOn('teaching', info)
  const figures = featureOn('agentFigures', info)
  const previews = featureOn('draftPreviews', info)
  return AGENT_SECTIONS.filter(
    (section) =>
      section === FIRST_SECTION ||
      (section === 'teaching' && teaching) ||
      (section === 'doing' && figures) ||
      (section === 'previews' && previews),
  )
}

const FIRST_SECTION: AgentSection = 'connection'

const SECTIONS_READING_THE_REPORT: ReadonlyArray<AgentSection> = ['connection', 'doing']
