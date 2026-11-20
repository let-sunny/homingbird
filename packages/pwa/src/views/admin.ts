import type { AsRead } from '@homingbird/protocol'
import { type Lifetime, h } from '@homingbird/ui'
import { adminModel } from '../models/admin.ts'
import type { AdminSection } from '../routes.ts'
import { adminChannelsSection } from './admin-channels.ts'
import { adminGroupsSection } from './admin-groups.ts'
import { adminMembersSection } from './admin-members.ts'
import { settingsSection } from './admin-settings.ts'
import type { ViewContext } from './context.ts'
import { insightsSection } from './insights.ts'
import { page } from './parts.ts'

/** Administration: settings, members, groups, channels and Insights where they are on, one tab at a time. */
export const adminView = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
  section: AdminSection,
): HTMLElement => {
  const model = adminModel(context.state.serverInfo.get(), section)
  return page(
    model.title,
    h(
      'nav',
      { class: 'subtabs' },
      model.tabs.map((tab) => h('a', { href: tab.href, 'aria-current': tab.current && 'page' }, tab.label)),
    ),
    SECTIONS[model.shown](context, life, me),
  )
}

const SECTIONS: Readonly<
  Record<AdminSection, (context: ViewContext, life: Lifetime, me: AsRead.Me) => HTMLElement>
> = {
  settings: (context, life) => settingsSection(context, life),
  members: adminMembersSection,
  groups: (context, life) => adminGroupsSection(context, life),
  channels: (context, life) => adminChannelsSection(context, life),
  insights: (context, life) => insightsSection(context, life),
}
