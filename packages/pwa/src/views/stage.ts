import type { AsRead, ConversationId } from '@homingbird/protocol'
import { type Child, type Lifetime, h } from '@homingbird/ui'
import { featureOn } from '../features.ts'
import type { Route } from '../routes.ts'
import { strings } from '../strings.ts'
import { profileView } from './account.ts'
import { activityView } from './activity.ts'
import { adminView } from './admin.ts'
import { agentTrustView } from './agent-trust.ts'
import { channelAgentView } from './channel-agent.ts'
import { channelView, channelsView } from './channels.ts'
import { characterEditorView } from './character-editor.ts'
import { consentView, deviceView } from './connect.ts'
import type { ViewContext } from './context.ts'
import { debateView } from './debate-room.ts'
import { debatesView } from './debates.ts'
import { groupPageView } from './group-page.ts'
import { homeView } from './home.ts'
import { measuresView } from './measures.ts'
import { emptyWithPip } from './parts.ts'
import { peopleView } from './people.ts'
import { searchView } from './search.ts'
import { threadView } from './thread-view.ts'

/** The page a route shows; a feature that is off, or a page the person may not see, shows as not found. */
export const stageFor = (context: ViewContext, life: Lifetime, me: AsRead.Me, current: Route): Child => {
  const on = (name: Parameters<typeof featureOn>[0]): boolean =>
    featureOn(name, context.state.serverInfo.get())
  switch (current.name) {
    case 'home':
      return homeView(context, life)
    case 'conversation':
      return threadView(
        context,
        life,
        me,
        current.id as ConversationId,
        current.draft,
        current.review ?? null,
      )
    case 'people':
      return peopleView(context, life, me)
    case 'group':
      return on('groups') ? groupPageView(context, life, me.member.id, current.id) : notFound()
    case 'channels':
      return channelsView(context, life)
    case 'channel':
      return channelView(context, life, current.slug)
    case 'channel-agent':
      return on('channelAgents')
        ? channelAgentView(
            context,
            life,
            current.slug,
            current.draft,
            current.teach === true ? 'teach' : 'answers',
          )
        : notFound()
    case 'debates':
      return on('debateRooms') ? debatesView(context, life, me) : notFound()
    case 'debate':
      return on('debateRooms') ? debateView(context, life, me, current.id, current.tab) : notFound()
    case 'activity':
      return activityView(context, life, me)
    case 'search':
      return searchView(context, life, me, current.query)
    case 'profile':
      return profileView(context, life, me)
    case 'agent':
      return agentTrustView(context, life, me, current.section)
    case 'measured':
      return measuresView(context)
    case 'character':
      return on('characters')
        ? characterEditorView(context, life, me, current.draft, current.from)
        : notFound()
    case 'device':
      return deviceView(context, life, current.code)
    case 'consent':
      return consentView(context, life, current.id)
    case 'admin':
      return me.member.role === 'admin' ? adminView(context, life, me, current.section) : notFound()
    case 'admin-group':
      return me.member.role === 'admin' ? adminView(context, life, me, 'groups', current.id) : notFound()
    case 'invite':
      return emptyWithPip(
        'sign-in',
        strings.invites.alreadyIn,
        h('a', { class: 'button', href: '#/' }, strings.backHome),
      )
    case 'invite-refused':
      return emptyWithPip(
        'failed',
        strings.invites.refused,
        h('a', { class: 'button', href: '#/' }, strings.backHome),
      )
    case 'signed-out':
    case 'unknown':
      return notFound()
  }
}

/** The page for an address that leads nowhere the person may go. */
const notFound = (): HTMLElement =>
  emptyWithPip('failed', strings.notFound, h('a', { class: 'button', href: '#/' }, strings.backHome))
