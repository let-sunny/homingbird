import type { AsRead } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { figuresModel } from '../models/agent-figures.ts'
import { draftsBehindModel } from '../models/drafts-behind.ts'
import { type MyAgentModel, myAgentModel } from '../models/my-agent.ts'
import { yourWeekModel } from '../models/your-week.ts'
import type { AgentSection } from '../routes.ts'
import { strings } from '../strings.ts'
import { periodChoice, renderFigures } from './agent-figures.ts'
import { answersLikeYouSection } from './answers-like-you.ts'
import { connectionSection } from './connection.ts'
import type { ViewContext } from './context.ts'
import { renderDraftsBehind } from './drafts-behind.ts'
import { hinted } from './hint.ts'
import { pageData } from './page-data.ts'
import { page } from './parts.ts'
import { previewSettingsSection } from './preview-settings.ts'
import { interviewSection } from './teaching-interview.ts'
import { taughtSection } from './teaching.ts'
import { renderYourWeek } from './your-week.ts'

/**
 * "My agent": connection, teaching, how it is doing and who sees its drafts early, one tab at a time,
 * each tab its own address.
 */
export const agentTrustView = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
  section: AgentSection | null,
): HTMLElement => {
  const model = myAgentModel(context.state.serverInfo.get(), section)
  if (model.loadsReport) context.actions.refreshAgentReport()
  const view = renderMyAgent(context, model, (shown) => sectionContent(context, life, me, shown))
  if (model.focusesHeading) {
    const id = headingId(model.shown.section)
    context.page.nextFrame(() => view.ownerDocument.getElementById(id)?.focus({ preventScroll: true }))
  }
  return view
}

const renderMyAgent = (
  context: ViewContext,
  model: MyAgentModel,
  content: (section: AgentSection) => ReadonlyArray<Child>,
): HTMLElement =>
  page(
    model.title,
    h(
      'nav',
      { class: 'subtabs my-agent-tabs', 'aria-label': strings.trust.tabsLabel },
      model.tabs.map((tab) => {
        const link = h('a', { href: tab.href, 'aria-current': tab.current && 'page' }, tab.label)
        return tab.section === 'previews'
          ? hinted(context, 'draftPreviews', strings.hints.draftPreviews, link)
          : link
      }),
    ),
    h(
      'section',
      {
        class: `my-agent-section is-${model.shown.section}`,
        'aria-labelledby': headingId(model.shown.section),
      },
      h('h2', { id: headingId(model.shown.section), tabindex: '-1' }, model.shown.title),
      h('p', { class: 'section-hint' }, model.shown.hint),
      ...content(model.shown.section),
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
      return [interviewSection(context, life), taughtSection(context, life)]
    case 'previews':
      return [previewSettingsSection(context, life, me)]
    case 'doing': {
      const days = signal(7)
      const { state } = context
      const { wait } = pageData(state, state.agentReport)
      return [
        region(life, [context.state.agentReport], () =>
          renderYourWeek(yourWeekModel(context.state.agentReport.get())),
        ),
        answersLikeYouSection(context, life),
        periodChoice('trust-period', days),
        region(
          life,
          [context.state.agentReport, wait, days],
          () =>
            renderFigures(
              figuresModel(context.state.agentReport.get(), days.get(), wait.get()),
              renderDraftsBehind(context, draftsBehindModel(context.state.agentReport.get(), days.get())),
              context,
            ),
          {
            class: 'trust-page',
          },
        ),
      ]
    }
  }
}

const headingId = (section: AgentSection): string => `agent-${section}`
