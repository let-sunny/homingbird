import type { AsRead } from '@homingbird/protocol'
import { type Lifetime, h } from '@homingbird/ui'
import { featureOn } from '../features.ts'
import { adminModel } from '../models/admin.ts'
import type { AdminSection } from '../routes.ts'
import { strings } from '../strings.ts'
import { adminChannelsSection } from './admin-channels.ts'
import { adminGroupEditor, adminGroupsSection } from './admin-groups.ts'
import { adminMembersSection } from './admin-members.ts'
import { settingsSection } from './admin-settings.ts'
import type { ViewContext } from './context.ts'
import { hinted } from './hint.ts'
import { insightsSection } from './insights.ts'
import { page } from './parts.ts'
import { adminSlackSection } from './slack.ts'

/** Administration: settings, members, groups, channels and Insights where they are on, one tab at a time. */
export const adminView = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
  section: AdminSection,
  groupId: string | null = null,
): HTMLElement => {
  const model = adminModel(context.state.serverInfo.get(), section)
  return page(
    model.title,
    h(
      'nav',
      { class: 'subtabs' },
      model.tabs.map((tab) => {
        const link = h('a', { href: tab.href, 'aria-current': tab.current && 'page' }, tab.label)
        return tab.section === 'insights' ? hinted(context, 'insights', strings.hints.insights, link) : link
      }),
    ),
    model.shown === 'groups' && groupId !== null
      ? adminGroupEditor(context, life, me.member.id, groupId)
      : SECTIONS[model.shown](context, life, me),
  )
}

const SECTIONS: Readonly<
  Record<AdminSection, (context: ViewContext, life: Lifetime, me: AsRead.Me) => HTMLElement>
> = {
  settings: (context, life) =>
    featureOn('slack', context.state.serverInfo.get())
      ? h(
          'div',
          { class: 'admin-settings-with-slack' },
          settingsSection(context, life),
          adminSlackSection(context, life),
        )
      : settingsSection(context, life),
  members: adminMembersSection,
  groups: (context, life) => adminGroupsSection(context, life),
  channels: (context, life) => adminChannelsSection(context, life),
  insights: (context, life) => insightsSection(context, life),
}
