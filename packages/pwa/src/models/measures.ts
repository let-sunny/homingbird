import { type AsRead, MEASURES } from '@homingbird/protocol'
import { featureOn } from '../features.ts'
import { strings } from '../strings.ts'

/** "What is measured", for every member: what each person sees about themself and what administrators see. */
export const measuresModel = (info: AsRead.ServerInfo | null): MeasuresModel => {
  const sections = [
    featureOn('agentFigures', info) && {
      id: 'measured-you',
      title: strings.measures.youTitle,
      privacy: strings.measures.youPrivacy,
      lines: MEASURES.flatMap((measure) =>
        measure.audience === 'you' ? [strings.measures.you[measure.key]] : [],
      ),
    },
    featureOn('channelAgents', info) && {
      id: 'measured-managers',
      title: strings.measures.managersTitle,
      privacy: strings.measures.managersPrivacy,
      lines: MEASURES.flatMap((measure) =>
        measure.audience === 'managers' ? [strings.measures.managers[measure.key]] : [],
      ),
    },
    featureOn('insights', info) && {
      id: 'measured-administrators',
      title: strings.measures.administratorsTitle,
      privacy: strings.measures.administratorsPrivacy,
      lines: MEASURES.flatMap((measure) =>
        measure.audience === 'administrators' ? [strings.measures.administrators[measure.key]] : [],
      ),
    },
  ].filter((shown) => shown !== false)
  return {
    title: strings.measures.pageTitle,
    intro: strings.measures.pageIntro,
    sections,
    nothing: sections.length === 0 ? strings.measures.nothing : null,
  }
}

export interface MeasuresModel {
  readonly title: string
  readonly intro: string
  readonly sections: ReadonlyArray<MeasuresSection>
  readonly nothing: string | null
}

export interface MeasuresSection {
  readonly id: string
  readonly title: string
  readonly privacy: string
  readonly lines: ReadonlyArray<string>
}
